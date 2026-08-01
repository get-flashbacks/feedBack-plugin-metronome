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
    assert.deepEqual(stored, { enabled: true, volume: 0.75, flashEnabled: false, subdivision: 'none', countInEnabled: false });
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

// --- Fake DOM helpers for the UI-injection / count-in overlay tests below ---

function makeFakeElement(tag) {
    const el = {
        tagName: tag,
        id: '',
        className: '',
        textContent: '',
        title: '',
        children: [],
        style: {},
        dataset: {},
        parentNode: null,
        _listeners: {},
        classList: {
            _hidden: false,
            toggle(cls, force) { if (cls === 'hidden' || cls === 'met-hidden') this._hidden = force; },
            add() {},
            remove() {},
        },
        appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
        insertBefore(child, ref) { el.children.push(child); child.parentNode = el; return child; },
        removeChild(child) { el.children = el.children.filter((c) => c !== child); child.parentNode = null; return child; },
        remove() { if (el.parentNode) el.parentNode.removeChild(el); el._detached = true; },
        addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { if (el._listeners[type]) el._listeners[type] = el._listeners[type].filter((f) => f !== fn); },
        querySelector() { return null; },
    };
    return el;
}

function makeFakeDocument() {
    const created = [];
    const body = makeFakeElement('body');
    created.push(body);
    return {
        body,
        createElement(tag) { const el = makeFakeElement(tag); created.push(el); return el; },
        createTextNode(text) { return { nodeType: 3, textContent: text }; },
        getElementById(id) { return created.find((e) => e.id === id && !e._detached) || null; },
    };
}

// --- Issue #9: subdivision clicks ---

test('subdivision setting persists via localStorage across a round trip', () => {
    const mod = freshPlugin();
    mod._metSettings.subdivision = 'triplet';
    mod._metSaveSettings();
    const stored = JSON.parse(global.localStorage.getItem('slopsmithMetronomeSettings'));
    assert.equal(stored.subdivision, 'triplet');
});

test('migration guard fills in subdivision/countInEnabled on settings objects missing them', () => {
    global.window = {};
    global.document = { getElementById: () => null };
    global.localStorage = {
        _store: { slopsmithMetronomeSettings: JSON.stringify({ enabled: true, volume: 0.5, flashEnabled: false }) },
        getItem(k) { return this._store[k] ?? null; },
        setItem(k, v) { this._store[k] = v; },
        clear() { this._store = {}; },
    };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    assert.equal(mod._metSettings.subdivision, 'none');
    assert.equal(mod._metSettings.countInEnabled, false);

    // Simulate an in-memory reused settings object (script re-eval on the
    // same page) that predates the subdivision/countInEnabled fields.
    delete mod._metSettings.subdivision;
    delete mod._metSettings.countInEnabled;
    delete require.cache[require.resolve(file)];
    const mod2 = require(file);
    assert.equal(mod2._metSettings.subdivision, 'none');
    assert.equal(mod2._metSettings.countInEnabled, false);
});

test('_metClick(type) uses distinct frequency/gain for high/mid/low', () => {
    const mod = freshPlugin();
    mod._metSettings.volume = 1;
    const freqs = [];
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() {}, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    // Capture osc.frequency.value assignments by wrapping createOscillator.
    const origAudioContext = global.window.AudioContext;
    global.window.AudioContext = function () {
        const ctx = origAudioContext();
        return Object.assign(ctx, {
            createOscillator() {
                const osc = { connect() {}, frequency: {}, type: '', start() {}, stop() {} };
                freqs.push(osc);
                return osc;
            },
        });
    };
    mod._metClick('high');
    mod._metClick('mid');
    mod._metClick('low');
    assert.equal(freqs[0].frequency.value, 1500);
    assert.equal(freqs[1].frequency.value, 1000);
    assert.equal(freqs[2].frequency.value, 660);
});

test('subdivision (eighth) fires exactly one low click between two beats, once per slot', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.subdivision = 'eighth';
    let clicks = 0;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() { clicks++; }, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    const beats = [{ time: 0, measure: 0 }, { time: 1.0, measure: -1 }];
    // Beat 0 fires (1 click), then the eighth-note subdivision at t=0.5 fires (2nd click).
    global.highway = makeHighway(beats, 0);
    mod._metTick();
    assert.equal(clicks, 1);
    global.highway = makeHighway(beats, 0.5);
    mod._metTick();
    assert.equal(clicks, 2);
    assert.equal(mod._metState.lastSubdivInBeat, 0);
    // Ticking again at the same subdivision slot must not re-fire.
    global.highway = makeHighway(beats, 0.51);
    mod._metTick();
    assert.equal(clicks, 2);
});

test('subdivision (triplet) fires two low clicks per beat interval', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.subdivision = 'triplet';
    let clicks = 0;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() { clicks++; }, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    const beats = [{ time: 0, measure: 0 }, { time: 0.9, measure: -1 }];
    global.highway = makeHighway(beats, 0);
    mod._metTick(); // beat 0
    global.highway = makeHighway(beats, 0.3); // ~1/3
    mod._metTick();
    global.highway = makeHighway(beats, 0.6); // ~2/3
    mod._metTick();
    assert.equal(clicks, 3); // beat + 2 subdivisions
});

test('subdivision mode "none" never fires a subdivision click', () => {
    const mod = freshPlugin();
    mod._metSettings.enabled = true;
    mod._metSettings.subdivision = 'none';
    let clicks = 0;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() { clicks++; }, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    const beats = [{ time: 0, measure: 0 }, { time: 1.0, measure: -1 }];
    global.highway = makeHighway(beats, 0);
    mod._metTick();
    global.highway = makeHighway(beats, 0.5);
    mod._metTick();
    assert.equal(clicks, 1); // only the beat-0 click, no subdivision
});

// --- Issue #10: visual count-in overlay ---

test('count-in overlay shows 4..1 and clears once playback reaches beat 0', () => {
    const mod = freshPlugin();
    global.document = makeFakeDocument();
    mod._metSettings.enabled = true;
    mod._metSettings.countInEnabled = true;
    global.window.AudioContext = function () {
        return {
            createOscillator: () => ({ connect() {}, frequency: {}, type: '', start() {}, stop() {} }),
            createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
            currentTime: 0,
        };
    };
    const beats = [{ time: 4.0, measure: 0 }, { time: 5.0, measure: -1 }];
    global.highway = makeHighway(beats, 0.01);
    mod._metTick();
    let overlay = global.document.getElementById('met-count-in-overlay');
    assert.ok(overlay);
    assert.equal(overlay.dataset.count, '4');

    global.highway = makeHighway(beats, 3.5);
    mod._metTick();
    overlay = global.document.getElementById('met-count-in-overlay');
    assert.equal(overlay.dataset.count, '1');

    // Once playback reaches beat 0, the overlay must be cleared.
    global.highway = makeHighway(beats, 4.0);
    mod._metTick();
    overlay = global.document.getElementById('met-count-in-overlay');
    assert.equal(overlay, null);
});

test('count-in overlay never appears when disabled or with fewer than 2 beats', () => {
    const mod = freshPlugin();
    global.document = makeFakeDocument();
    mod._metSettings.enabled = true;
    mod._metSettings.countInEnabled = false;
    global.highway = makeHighway([{ time: 4.0, measure: 0 }, { time: 5.0, measure: -1 }], 0);
    mod._metTick();
    assert.equal(global.document.getElementById('met-count-in-overlay'), null);

    mod._metSettings.countInEnabled = true;
    global.highway = makeHighway([{ time: 4.0, measure: 0 }], 0); // only 1 beat
    mod._metTick();
    assert.equal(global.document.getElementById('met-count-in-overlay'), null);
});

test('_metClearCountIn removes the overlay element from the DOM', () => {
    const mod = freshPlugin();
    global.document = makeFakeDocument();
    mod._metUpdateCountIn(3, 0.5);
    assert.ok(global.document.getElementById('met-count-in-overlay'));
    mod._metClearCountIn();
    assert.equal(global.document.getElementById('met-count-in-overlay'), null);
});

// --- Issue #11: v3 host UI slot mounting ---

test('_metInjectButton mounts into window.feedBack.ui.playerControlSlot() in v3', () => {
    global.window = {};
    global.document = makeFakeDocument();
    global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, clear() { this._store = {}; } };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);

    const slot = makeFakeElement('div');
    global.window.feedBack = { uiVersion: 'v3', ui: { playerControlSlot: () => slot } };
    const legacyControls = makeFakeElement('div');
    legacyControls.id = 'player-controls';
    // Register the legacy container too, to prove v3 mounting bypasses it.
    const baseGetElementById = global.document.getElementById.bind(global.document);
    global.document.getElementById = (id) => (id === 'player-controls' ? legacyControls : baseGetElementById(id));

    mod._metInjectButton();
    assert.equal(legacyControls.children.length, 0);
    assert.ok(slot.children.some((c) => c.id === 'btn-metronome'));
});

test('_metInjectButton falls back to legacy #player-controls when playerControlSlot() throws', () => {
    global.window = {};
    global.document = makeFakeDocument();
    global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, clear() { this._store = {}; } };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);

    const legacyControls = makeFakeElement('div');
    legacyControls.id = 'player-controls';
    const doc = global.document;
    const baseGetElementById = doc.getElementById.bind(doc);
    doc.getElementById = (id) => (id === 'player-controls' ? legacyControls : baseGetElementById(id));
    global.window.feedBack = { uiVersion: 'v3', ui: { playerControlSlot: () => { throw new Error('boom'); } } };

    mod._metInjectButton();
    assert.ok(legacyControls.children.some((c) => c.id === 'btn-metronome'));
});

test('_metInjectButton keeps legacy behavior unchanged when window.feedBack is absent', () => {
    global.window = {};
    global.document = makeFakeDocument();
    global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, clear() { this._store = {}; } };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);

    const legacyControls = makeFakeElement('div');
    legacyControls.id = 'player-controls';
    global.document.getElementById = (id) => (id === 'player-controls' ? legacyControls : null);

    mod._metInjectButton();
    assert.ok(legacyControls.children.some((c) => c.id === 'btn-metronome'));
});

// --- Issues #3/#6: tick-interval start/stop helpers used by the navigation hook ---

test('_metStartTickInterval/_metStopTickInterval toggle the stored interval id', () => {
    const mod = freshPlugin();
    global.highway = undefined;
    assert.equal(global.window.slopsmithMetronomeTickIntervalId, undefined);
    mod._metStartTickInterval();
    assert.ok(global.window.slopsmithMetronomeTickIntervalId);
    mod._metStopTickInterval();
    assert.equal(global.window.slopsmithMetronomeTickIntervalId, null);
});

test('_metInstallVisibilityHooks installs the visibility listener only once', () => {
    const mod = freshPlugin();
    const listeners = [];
    global.document = {
        hidden: false,
        addEventListener(type, fn) { listeners.push({ type, fn }); },
    };

    mod._metInstallVisibilityHooks();
    mod._metInstallVisibilityHooks();

    assert.equal(listeners.length, 1);
    assert.equal(listeners[0].type, 'visibilitychange');
});
