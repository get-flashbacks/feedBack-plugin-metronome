'use strict';
// Coverage for the beat-detection tick logic and toggle/flash state, since
// screen.js has no wrapping IIFE — the module.exports hook returns before
// the polling setInterval + playSong wrap so no live timer leaks into tests.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    global.document = { getElementById: () => null };
    global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, clear() { this._store = {}; } };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

function makeHighway(beats, time) {
    return { getBeats: () => beats, getTime: () => time };
}

test('_metGetHighway returns null when no global highway exists', () => {
    const mod = freshPlugin();
    assert.equal(mod._metGetHighway(), null);
});

test('_metTick is a no-op without a highway exposing getBeats/getTime', () => {
    const mod = freshPlugin();
    global.highway = {};
    mod._metSettings.enabled = true;
    assert.doesNotThrow(() => mod._metTick());
});

test('_metTick resets flashAlpha to 0 while disabled', () => {
    const mod = freshPlugin();
    global.highway = makeHighway([{ time: 0, measure: 0 }], 0);
    mod._metSettings.enabled = false;
    mod._metState.flashAlpha = 0.5;
    mod._metTick();
    assert.equal(mod._metState.flashAlpha, 0);
});

test('_metTick fires a click+flash exactly at a beat boundary', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.flashEnabled = true;
    global.highway = makeHighway([{ time: 1.0, measure: 0 }], 1.0);
    // Stub AudioContext so _metClick doesn't throw under Node.
    let started = false;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() { started = true; }, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    mod._metTick();
    assert.equal(started, true);
    assert.equal(mod._metState.lastBeatIdx, 0);
    assert.equal(mod._metState.flashAlpha, 0.35); // measure beat -> stronger flash
});

test('_metTick fades the flash without re-triggering on the same beat', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    global.highway = makeHighway([{ time: 0, measure: 0 }], 0.02);
    mod._metState.lastBeatIdx = 0; // already handled
    mod._metState.flashAlpha = 0.2;
    mod._metTick();
    assert.ok(mod._metState.flashAlpha < 0.2); // decayed by 0.85 factor
    assert.ok(mod._metState.flashAlpha > 0);
});

test('_metTick skips beats more than 50ms in the past without re-clicking', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    global.highway = makeHighway([{ time: 0, measure: 0 }], 0.5); // way past the beat
    let clicked = false;
    global.window.AudioContext = function () {
        return { createOscillator: () => ({ connect() {}, frequency: {}, start() { clicked = true; }, stop() {} }),
                 createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
                 currentTime: 0 };
    };
    mod._metTick();
    assert.equal(clicked, false);
    assert.equal(mod._metState.lastBeatIdx, 0); // still marks it seen so it isn't retried
});

test('_metTick uses a non-measure flash strength for a regular beat', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.flashEnabled = true;
    global.highway = makeHighway([{ time: 1.0, measure: -1 }], 1.0);
    global.window.AudioContext = function () {
        return { createOscillator: () => ({ connect() {}, frequency: {}, start() {}, stop() {} }),
                 createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
                 currentTime: 0 };
    };
    mod._metTick();
    assert.equal(mod._metState.flashAlpha, 0.15);
});

test('_metToggle flips enabled and resets lastBeatIdx', () => {
    const mod = freshPlugin();
    mod._metState.lastBeatIdx = 5;
    global.document = { getElementById: () => null }; // _metSyncUi is DOM-null-safe
    mod._metToggle();
    assert.equal(mod._metSettings.enabled, true);
    assert.equal(mod._metState.lastBeatIdx, -1);
    mod._metToggle();
    assert.equal(mod._metSettings.enabled, false);
});

test('_metSetVolume normalizes a 0-100 slider value to a 0-1 fraction', () => {
    const mod = freshPlugin();
    mod._metSetVolume(75);
    assert.equal(mod._metSettings.volume, 0.75);
});

test('_metClick bails before touching the oscillator when volume is 0', () => {
    const mod = freshPlugin();
    mod._metSettings.volume = 0;
    let oscCreated = false;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => { oscCreated = true; return { connect() {}, start() {}, stop() {} }; },
            createGain: () => ({ connect() {}, gain: {} }),
            currentTime: 0,
        };
    };
    mod._metClick(true);
    assert.equal(oscCreated, false);
});

test('_metSaveSettings persists settings to localStorage', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.volume = 0.75;
    mod._metSettings.flashEnabled = false;
    mod._metSaveSettings();
    const stored = JSON.parse(global.localStorage.getItem('slopsmithMetronomeSettings'));
    assert.deepEqual(stored, { enabled: true, volume: 0.75, flashEnabled: false });
});

test('Settings are loaded from localStorage on init if present', () => {
    global.window = {};
    global.document = { getElementById: () => null };
    global.localStorage = {
        _store: { 'slopsmithMetronomeSettings': JSON.stringify({ enabled: true, volume: 0.5, flashEnabled: false }) },
        getItem(k) { return this._store[k] ?? null; },
        setItem(k, v) { this._store[k] = v; },
        clear() { this._store = {}; },
    };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    assert.equal(mod._metSettings.enabled, true);
    assert.equal(mod._metSettings.volume, 0.5);
    assert.equal(mod._metSettings.flashEnabled, false);
});

test('Settings revert to defaults if localStorage is corrupted', () => {
    global.window = {};
    global.document = { getElementById: () => null };
    global.localStorage = {
        _store: { 'slopsmithMetronomeSettings': 'not valid json' },
        getItem(k) { return this._store[k] ?? null; },
        setItem(k, v) { this._store[k] = v; },
        clear() { this._store = {}; },
    };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    assert.equal(mod._metSettings.enabled, false);
    assert.equal(mod._metSettings.volume, 0.4);
    assert.equal(mod._metSettings.flashEnabled, true);
});

test('_metToggle saves settings to localStorage', () => {
    const mod = freshPlugin();
    global.document = { getElementById: () => null };
    mod._metToggle();
    const stored = JSON.parse(global.localStorage.getItem('slopsmithMetronomeSettings'));
    assert.equal(stored.enabled, true);
});

test('_metSetVolume saves settings to localStorage', () => {
    const mod = freshPlugin();
    mod._metSetVolume(60);
    const stored = JSON.parse(global.localStorage.getItem('slopsmithMetronomeSettings'));
    assert.equal(stored.volume, 0.6);
});
