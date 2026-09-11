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
    // Real class-token set, kept in sync with `className` both ways (like
    // a real browser's classList/className) rather than a one-off
    // `_hidden` boolean — so tests exercise the same `classList.contains`
    // read path production code uses.
    let classNameStr = '';
    const tokens = () => classNameStr.split(/\s+/).filter(Boolean);
    const el = {
        tagName: tag,
        id: '',
        get className() { return classNameStr; },
        set className(v) { classNameStr = v || ''; },
        textContent: '',
        title: '',
        children: [],
        style: {},
        dataset: {},
        parentNode: null,
        _listeners: {},
        classList: {
            contains(cls) { return tokens().includes(cls); },
            add(cls) { if (!tokens().includes(cls)) classNameStr = (classNameStr + ' ' + cls).trim(); },
            remove(cls) { classNameStr = tokens().filter((t) => t !== cls).join(' '); },
            toggle(cls, force) {
                const has = tokens().includes(cls);
                const want = force === undefined ? !has : force;
                if (want) this.add(cls); else this.remove(cls);
                return want;
            },
        },
        appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
        insertBefore(child, ref) { el.children.push(child); child.parentNode = el; return child; },
        removeChild(child) { el.children = el.children.filter((c) => c !== child); child.parentNode = null; return child; },
        remove() {
            if (el.parentNode) el.parentNode.removeChild(el);
            // Real getElementById can never find a node whose subtree was
            // removed, including its descendants — mark the whole subtree
            // detached, not just the removed root, so the fake's flat
            // getElementById lookup (below) matches that.
            (function markDetached(node) {
                node._detached = true;
                if (Array.isArray(node.children)) node.children.forEach(markDetached);
            })(el);
        },
        addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { if (el._listeners[type]) el._listeners[type] = el._listeners[type].filter((f) => f !== fn); },
        querySelector() { return null; },
        setAttribute(name, value) { el[name] = value; },
        getAttribute(name) { return name in el ? el[name] : null; },
        focus() {},
        contains(node) { return el.children.includes(node) || el.children.some((c) => typeof c.contains === 'function' && c.contains(node)); },
    };
    return el;
}

function makeFakeDocument() {
    const created = [];
    const body = makeFakeElement('body');
    created.push(body);
    const listeners = {};
    return {
        body,
        createElement(tag) { const el = makeFakeElement(tag); created.push(el); return el; },
        createTextNode(text) { return { nodeType: 3, textContent: text }; },
        getElementById(id) { return created.find((e) => e.id === id && !e._detached) || null; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
        // Test helper (not part of the real Document API): fire a fake
        // event at every listener registered for `type`.
        _dispatch(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
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
    assert.ok(slot.children.some((c) => c.children && c.children.some((g) => g.id === 'btn-metronome')));
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
    assert.ok(legacyControls.children.some((c) => c.children && c.children.some((g) => g.id === 'btn-metronome')));
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
    assert.ok(legacyControls.children.some((c) => c.children && c.children.some((g) => g.id === 'btn-metronome')));
});

// --- Issue #12 pullfrog review follow-up: popover open/close, outside-click
// dismissal, and the enabled-check binding ---

function setupPopoverTest() {
    global.window = {};
    const doc = makeFakeDocument();
    global.document = doc;
    global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, clear() { this._store = {}; } };
    const controls = doc.createElement('div');
    controls.id = 'player-controls';
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    mod._metInjectButton();
    return {
        mod, doc,
        wrap: doc.getElementById('met-wrap'),
        btn: doc.getElementById('btn-metronome'),
        popover: doc.getElementById('met-popover'),
    };
}

test('clicking the icon button toggles the popover hidden <-> visible and syncs aria-expanded', () => {
    const { mod, btn, popover } = setupPopoverTest();
    assert.ok(popover.classList.contains('met-hidden'));
    assert.equal(btn['aria-expanded'], 'false');

    mod._metTogglePopover({ stopPropagation() {} });
    assert.ok(!popover.classList.contains('met-hidden'));
    assert.equal(btn['aria-expanded'], 'true');

    mod._metTogglePopover({ stopPropagation() {} });
    assert.ok(popover.classList.contains('met-hidden'));
    assert.equal(btn['aria-expanded'], 'false');
});

test('a click outside #met-wrap closes the open popover', () => {
    const { mod, doc, btn, popover } = setupPopoverTest();
    mod._metTogglePopover({ stopPropagation() {} });
    assert.ok(!popover.classList.contains('met-hidden'));

    const outsideEl = doc.createElement('div');
    doc._dispatch('click', { target: outsideEl });
    assert.ok(popover.classList.contains('met-hidden'));
    assert.equal(btn['aria-expanded'], 'false');
});

test('a click inside #met-wrap does not close the popover', () => {
    const { mod, doc, popover } = setupPopoverTest();
    mod._metTogglePopover({ stopPropagation() {} });
    assert.ok(!popover.classList.contains('met-hidden'));

    // A click on the popover itself (a descendant of #met-wrap) must not
    // be treated as "outside".
    doc._dispatch('click', { target: popover });
    assert.ok(!popover.classList.contains('met-hidden'));
});

test('Escape closes the popover and returns focus to the button', () => {
    const { mod, wrap, popover, btn } = setupPopoverTest();
    mod._metTogglePopover({ stopPropagation() {} });
    assert.ok(!popover.classList.contains('met-hidden'));

    let focused = false;
    btn.focus = () => { focused = true; };
    // The keydown listener lives on `wrap`, not `popover` — opening the
    // popover never moves focus into it, so a CodeRabbit review flagged
    // that an Escape fired immediately after open (while focus is still on
    // the settings button) would never reach a popover-scoped listener.
    // Dispatch from wrap, the shared ancestor, to match.
    wrap._listeners.keydown[0]({ key: 'Escape' });
    assert.ok(popover.classList.contains('met-hidden'));
    assert.ok(focused);
});

test('re-invoking _metInjectButton after an older two-button version left its DOM behind replaces it with the single consolidated button', () => {
    const { mod, doc, wrap } = setupPopoverTest();
    // Simulate a page that still has the pre-consolidation DOM: a classic
    // text toggle at id="btn-metronome" (no aria-haspopup) plus a separate
    // id="btn-metronome-settings" icon button and its popover.
    doc.getElementById('btn-metronome').remove();
    const oldToggle = doc.createElement('button');
    oldToggle.id = 'btn-metronome';
    oldToggle.className = 'met-btn';
    oldToggle.textContent = 'Metronome';
    wrap.appendChild(oldToggle);
    const oldSettingsBtn = doc.createElement('button');
    oldSettingsBtn.id = 'btn-metronome-settings';
    wrap.appendChild(oldSettingsBtn);

    mod._metInjectButton();

    const newBtn = doc.getElementById('btn-metronome');
    assert.ok(newBtn, 'consolidated button must exist after re-injection');
    assert.notEqual(newBtn, oldToggle, 'the stale classic toggle must be replaced, not reused');
    assert.equal(newBtn.getAttribute('aria-haspopup'), 'true', 'the rebuilt button must be the consolidated icon button');
    assert.equal(doc.getElementById('btn-metronome-settings'), null, 'the stale separate settings button id must be gone');
    // Exactly one #met-wrap must exist under the controls parent — no
    // duplicate left behind from the stale state.
    const controls = doc.getElementById('player-controls') || wrap.parentNode;
    const wraps = controls.children.filter((c) => c.id === 'met-wrap');
    assert.equal(wraps.length, 1, 'must not leave a duplicate #met-wrap behind');
});

test('toggling #met-enabled-check flips _metSettings.enabled', () => {
    const { mod, doc } = setupPopoverTest();
    const check = doc.getElementById('met-enabled-check');
    assert.equal(mod._metSettings.enabled, false);
    check.checked = true;
    check._listeners.change[0]();
    assert.equal(mod._metSettings.enabled, true);
});

// --- A single consolidated button replaces the separate classic toggle +
// icon pair (design feedback: two buttons for one feature was repetitive).

test('_metInjectButton creates exactly one consolidated button, not a separate toggle', () => {
    const { doc, btn } = setupPopoverTest();
    assert.ok(btn, '#btn-metronome consolidated button must exist');
    assert.equal(btn.getAttribute('aria-haspopup'), 'true');
    assert.equal(doc.getElementById('btn-metronome-settings'), null, 'no separate settings-button id should exist');
});

test('clicking the button opens the popover without touching _metSettings.enabled', () => {
    const { mod, btn, popover } = setupPopoverTest();
    assert.equal(mod._metSettings.enabled, false);
    btn.onclick({ stopPropagation() {} });
    assert.ok(!popover.classList.contains('met-hidden'));
    assert.equal(mod._metSettings.enabled, false);
});

test('_metSyncUi updates the button active class and title/aria-label to reflect enabled state', () => {
    const { mod, btn } = setupPopoverTest();
    assert.ok(!btn.className.includes('met-btn--active'));
    assert.equal(btn.title, 'Metronome settings (off)');

    mod._metToggle();

    assert.ok(btn.className.includes('met-btn--active'));
    assert.equal(btn.title, 'Metronome settings (on)');
    assert.equal(btn['aria-label'], 'Metronome settings (on)');
});

test('re-invoking _metInjectButton rewires onclick on the existing button rather than duplicating it', () => {
    const { mod, doc, btn } = setupPopoverTest();
    mod._metInjectButton();
    assert.equal(doc.getElementById('btn-metronome'), btn, 'must reuse the same button element');
});

test('re-injection rebuilds controls when the consolidated button has no popover', () => {
    const { mod, doc, wrap, btn } = setupPopoverTest();
    const oldPopover = doc.getElementById('met-popover');
    oldPopover.remove();

    mod._metInjectButton();

    const newBtn = doc.getElementById('btn-metronome');
    assert.ok(newBtn);
    assert.notEqual(newBtn, btn);
    assert.ok(doc.getElementById('met-popover'));
    assert.notEqual(doc.getElementById('met-wrap'), wrap);
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
