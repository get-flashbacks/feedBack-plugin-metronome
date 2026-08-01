// Metronome Overlay plugin
// Adds audible click and visual flash on beats, synced to the song's tempo.

(function () {
    'use strict';

let _metAudioCtx = null;
const MET_SETTINGS_KEY = 'slopsmithMetronomeSettings';
const DRAW_HOOK_RETRY_DELAY_MS = 1000;
const _metSettingsDefaults = { enabled: false, volume: 0.4, flashEnabled: true, subdivision: 'none', countInEnabled: false };
let _metSettingsParsed = null;
try { _metSettingsParsed = JSON.parse(localStorage.getItem(MET_SETTINGS_KEY) || 'null'); } catch (_e) {}
const _metSettings = window[MET_SETTINGS_KEY] || (window[MET_SETTINGS_KEY] =
    Object.assign({}, _metSettingsDefaults, _metSettingsParsed || {}));
function _metSaveSettings() {
    try { localStorage.setItem(MET_SETTINGS_KEY, JSON.stringify(_metSettings)); } catch (_e) {}
}
// Migration guard: ensure fields added after initial release exist on
// settings objects that were persisted (or already living in memory as
// window[MET_SETTINGS_KEY]) before those fields were introduced.
if (!_metSettings.subdivision) _metSettings.subdivision = _metSettingsDefaults.subdivision;
if (_metSettings.countInEnabled === undefined) _metSettings.countInEnabled = _metSettingsDefaults.countInEnabled;

function _metGetHostUi() {
    return window.feedBack || window.slopsmith || null;
}

const MET_STATE_KEY = 'slopsmithMetronomeState';
const _metState = window[MET_STATE_KEY] || (window[MET_STATE_KEY] = {
    lastBeatIdx: -1,
    flashAlpha: 0,
    lastSubdivInBeat: -1,
});
if (_metState.lastSubdivInBeat === undefined) _metState.lastSubdivInBeat = -1;

let _metNextDrawHookRetryAtMs = 0;

let _metCountInEl = null; // DOM overlay for count-in numbers

function _metUpdateCountIn(count, alpha) {
    if (!_metCountInEl) {
        const el = document.createElement('div');
        el.id = 'met-count-in-overlay';
        el.style.cssText =
            'position:fixed;inset:0;z-index:9999;pointer-events:none;' +
            'display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(el);
        _metCountInEl = el;
    }
    _metCountInEl.style.opacity = alpha.toFixed(3);
    if (_metCountInEl.dataset.count !== String(count)) {
        _metCountInEl.dataset.count = String(count);
        _metCountInEl.innerHTML =
            '<span style="font-size:120px;font-weight:900;color:#f59e0b;' +
            'text-shadow:0 2px 40px rgba(245,158,11,0.6);font-family:sans-serif;">' +
            count + '</span>';
    }
}

// Removes the count-in overlay from the DOM. Called on the countdown's
// natural end, on toggle-off, on every song change, AND (bug #3 fix) from
// the navigation hook below, so a count-in that's mid-countdown when the
// user leaves the player screen can't get stuck full-viewport.
function _metClearCountIn() {
    if (_metCountInEl) { _metCountInEl.remove(); _metCountInEl = null; }
}

// type: 'high' = downbeat, 'mid' = regular beat, 'low' = subdivision
function _metClick(type) {
    if (!_metAudioCtx) _metAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_metSettings.volume <= 0) return;
    const osc = _metAudioCtx.createOscillator();
    const gain = _metAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(_metAudioCtx.destination);
    const freq = type === 'high' ? 1500 : type === 'mid' ? 1000 : 660;
    const vol = (type === 'low' ? 0.4 : 1.0) * _metSettings.volume;
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(vol, _metAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _metAudioCtx.currentTime + 0.06);
    osc.start(_metAudioCtx.currentTime);
    osc.stop(_metAudioCtx.currentTime + 0.06);
}

function _metFlash(alpha) {
    if (_metSettings.flashEnabled) _metState.flashAlpha = alpha;
}

function _metBindVolumeSlider(slider) {
    if (typeof slider.oninput === 'function') {
        // Clear legacy property handler from earlier plugin versions.
        slider.oninput = null;
    }
    if (slider._metVolumeListener) {
        slider.removeEventListener('input', slider._metVolumeListener);
    }
    slider.value = Math.round(_metSettings.volume * 100);
    const volLabel = document.getElementById('met-vol-label');
    if (volLabel) volLabel.textContent = `${slider.value}%`;
    slider._metVolumeListener = function() { _metSetVolume(this.value); };
    slider.addEventListener('input', slider._metVolumeListener);
}

function _metBindFlashCheck(flashCheck) {
    if (typeof flashCheck.onchange === 'function') {
        // Clear legacy property/inline handler from earlier plugin versions.
        flashCheck.onchange = null;
    }
    if (flashCheck._metFlashListener) {
        flashCheck.removeEventListener('change', flashCheck._metFlashListener);
    }
    flashCheck.checked = _metSettings.flashEnabled;
    flashCheck._metFlashListener = function() { _metSettings.flashEnabled = this.checked; _metSaveSettings(); };
    flashCheck.addEventListener('change', flashCheck._metFlashListener);
}

function _metBindCountInCheck(check) {
    if (check._metCountInListener) check.removeEventListener('change', check._metCountInListener);
    check.checked = !!_metSettings.countInEnabled;
    check._metCountInListener = function() {
        _metSettings.countInEnabled = this.checked;
        _metSaveSettings();
        if (!this.checked) _metClearCountIn();
    };
    check.addEventListener('change', check._metCountInListener);
}

function _metBindSubdivSelect(sel) {
    if (sel._metSubdivListener) {
        sel.removeEventListener('change', sel._metSubdivListener);
    }
    sel.value = _metSettings.subdivision;
    sel._metSubdivListener = function() {
        _metSettings.subdivision = this.value;
        _metState.lastSubdivInBeat = -1;
        _metSaveSettings();
    };
    sel.addEventListener('change', sel._metSubdivListener);
}

// Inject toggle button into player controls
function _metInjectButton() {
    // v3: mount the metronome controls into the host's stable plugin-control
    // slot instead of anchoring to #btn-lyrics inside #player-controls (that
    // transport bar auto-hides in v3, making it an unreliable anchor).
    const hostUi = _metGetHostUi();
    const isV3 = !!(hostUi && hostUi.uiVersion === 'v3');
    let slot = null;
    if (isV3 && hostUi.ui && typeof hostUi.ui.playerControlSlot === 'function') {
        try {
            const _s = hostUi.ui.playerControlSlot();
            if (_s && typeof _s.appendChild === 'function' && typeof _s.insertBefore === 'function') slot = _s;
        } catch (_e) { /* host slot API failure -> fall back to legacy container */ }
    }
    const controls = slot || document.getElementById('player-controls');
    if (!controls) return;
    const existingBtn = document.getElementById('btn-metronome');
    if (existingBtn) {
        const existingSlider = document.getElementById('met-volume');
        const existingFlashCheck = document.getElementById('met-flash-check');
        const existingSubdivSel = document.getElementById('met-subdiv');
        const existingCountInCheck = document.getElementById('met-count-in-check');
        existingBtn.onclick = _metToggle;
        if (existingSlider) _metBindVolumeSlider(existingSlider);
        if (existingFlashCheck) _metBindFlashCheck(existingFlashCheck);
        if (existingSubdivSel) _metBindSubdivSelect(existingSubdivSel);
        if (existingCountInCheck) _metBindCountInCheck(existingCountInCheck);
        _metSyncUi();
        return;
    }

    const lyricsBtn = document.getElementById('btn-lyrics');
    // In the v3 slot we always append in order rather than anchoring to a
    // node that may not even be a child of the slot.
    const insertBefore = isV3 ? null : (lyricsBtn?.nextSibling || controls.querySelector('button:last-child'));
    const insert = (el) => {
        if (insertBefore && insertBefore.parentNode === controls) controls.insertBefore(el, insertBefore);
        else controls.appendChild(el);
    };

    const btn = document.createElement('button');
    btn.id = 'btn-metronome';
    btn.className = 'met-btn';
    btn.textContent = 'Metronome';
    btn.title = 'Toggle metronome click';
    btn.onclick = _metToggle;
    insert(btn);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'met-volume';
    slider.min = '0';
    slider.max = '100';
    slider.className = 'met-range met-hidden';
    _metBindVolumeSlider(slider);
    insert(slider);

    const label = document.createElement('span');
    label.id = 'met-vol-label';
    label.className = 'met-label met-hidden';
    label.textContent = `${Math.round(_metSettings.volume * 100)}%`;
    insert(label);

    const flashLabel = document.createElement('label');
    flashLabel.id = 'met-flash-label';
    flashLabel.className = 'met-toggle met-hidden';
    const flashCheck = document.createElement('input');
    flashCheck.type = 'checkbox';
    flashCheck.id = 'met-flash-check';
    flashCheck.className = 'met-checkbox';
    flashLabel.appendChild(flashCheck);
    flashLabel.appendChild(document.createTextNode(' Flash'));
    insert(flashLabel);
    _metBindFlashCheck(flashCheck);

    const subdivSel = document.createElement('select');
    subdivSel.id = 'met-subdiv';
    subdivSel.className = 'met-select met-hidden';
    subdivSel.title = 'Subdivision clicks';
    [['none', 'Beats only'], ['eighth', '8th notes'], ['triplet', 'Triplets']].forEach(([val, text]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = text;
        subdivSel.appendChild(opt);
    });
    insert(subdivSel);
    _metBindSubdivSelect(subdivSel);

    const countInLabel = document.createElement('label');
    countInLabel.id = 'met-count-in-label';
    countInLabel.className = 'met-toggle met-hidden';
    countInLabel.title = 'Show 4-3-2-1 countdown before the first beat';
    const countInCheck = document.createElement('input');
    countInCheck.type = 'checkbox';
    countInCheck.id = 'met-count-in-check';
    countInCheck.className = 'met-checkbox';
    countInLabel.appendChild(countInCheck);
    countInLabel.appendChild(document.createTextNode(' Count-in'));
    insert(countInLabel);
    _metBindCountInCheck(countInCheck);

    _metSyncUi();
}

function _metSyncUi() {
    const enabled = _metSettings.enabled;
    const btn = document.getElementById('btn-metronome');
    const slider = document.getElementById('met-volume');
    const label = document.getElementById('met-vol-label');
    const flashLabel = document.getElementById('met-flash-label');
    const subdivSel = document.getElementById('met-subdiv');
    const countInLabel = document.getElementById('met-count-in-label');
    if (btn) {
        btn.className = enabled ? 'met-btn met-btn--active' : 'met-btn';
        btn.textContent = enabled ? 'Metronome ✓' : 'Metronome';
    }
    if (slider) slider.classList.toggle('met-hidden', !enabled);
    if (label) label.classList.toggle('met-hidden', !enabled);
    if (flashLabel) flashLabel.classList.toggle('met-hidden', !enabled);
    if (subdivSel) subdivSel.classList.toggle('met-hidden', !enabled);
    if (countInLabel) countInLabel.classList.toggle('met-hidden', !enabled);
}

function _metToggle() {
    _metSettings.enabled = !_metSettings.enabled;
    if (_metSettings.enabled) {
        // Bug #4 fix: create (and resume) the AudioContext synchronously
        // inside this click-handler call stack, not lazily inside _metClick
        // when it's later invoked from the setInterval-driven tick. Browsers
        // only allow AudioContext playback to start unsuspended when created
        // (or resumed) from within a real user-gesture call stack.
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (typeof AudioCtor === 'function') {
            if (!_metAudioCtx) _metAudioCtx = new AudioCtor();
            if (_metAudioCtx && typeof _metAudioCtx.resume === 'function' && _metAudioCtx.state !== 'running') {
                try { _metAudioCtx.resume(); } catch (_e) {}
            }
        }
    } else {
        _metClearCountIn();
    }
    _metSaveSettings();
    _metSyncUi();
    _metState.lastBeatIdx = -1;
    _metState.lastSubdivInBeat = -1;
}

function _metSetVolume(v) {
    _metSettings.volume = v / 100;
    _metSaveSettings();
    const volLabel = document.getElementById('met-vol-label');
    if (volLabel) volLabel.textContent = v + '%';
}

const DRAW_HOOK_HIGHWAY_REF_KEY = 'slopsmithMetronomeDrawHookHighwayRef';

function _metGetHighway() {
    return typeof highway !== 'undefined' ? highway : null;
}

function _metEnsureDrawHookInstalled() {
    const currentHighway = _metGetHighway();
    if (
        !currentHighway ||
        typeof currentHighway.addDrawHook !== 'function' ||
        window[DRAW_HOOK_HIGHWAY_REF_KEY] === currentHighway
    ) {
        return;
    }

    currentHighway.addDrawHook(function(ctx, W, H) {
        if (_metState.flashAlpha < 0.005) return;

        // Flash across the play line area
        const y = H * 0.72;
        const h = H * 0.18;
        const grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, `rgba(255, 200, 60, 0)`);
        grad.addColorStop(0.5, `rgba(255, 200, 60, ${_metState.flashAlpha})`);
        grad.addColorStop(1, `rgba(255, 200, 60, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, W, h);

        // Fade
        _metState.flashAlpha *= 0.88;
    });
    window[DRAW_HOOK_HIGHWAY_REF_KEY] = currentHighway;
}

// Main tick — called from a polling loop
function _metTick() {
    const currentHighway = _metGetHighway();
    if (
        !currentHighway ||
        typeof currentHighway.getBeats !== 'function' ||
        typeof currentHighway.getTime !== 'function'
    ) {
        return;
    }
    if (!_metSettings.enabled) {
        _metState.flashAlpha = 0;
        return;
    }
    const beats = currentHighway.getBeats();
    const t = currentHighway.getTime();
    if (!beats || beats.length === 0) return;

    // Find the current beat (the most recent beat <= current time)
    let lo = 0, hi = beats.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time <= t) lo = mid + 1;
        else hi = mid;
    }
    const idx = lo - 1;

    // Reset subdivision state when we enter a new beat interval
    if (idx !== _metState.lastBeatIdx) {
        _metState.lastSubdivInBeat = -1;
    }

    if (idx < 0 || idx === _metState.lastBeatIdx) {
        // Fade out flash
        _metState.flashAlpha *= 0.85;
    } else {
        // Only trigger if we're close to the beat (within 50ms) to avoid
        // catching up on seeks
        const beatTime = beats[idx].time;
        if (Math.abs(t - beatTime) > 0.05) {
            _metState.lastBeatIdx = idx;
            _metState.flashAlpha *= 0.85;
        } else {
            _metState.lastBeatIdx = idx;
            const isMeasure = beats[idx].measure >= 0;
            _metClick(isMeasure ? 'high' : 'mid');
            _metFlash(isMeasure ? 0.35 : 0.15);
        }
    }

    // Check subdivisions within the current beat interval.
    // Subdivision times are interpolated between this beat and the next, so
    // they naturally follow any playback-speed change applied by the host.
    const subdivMode = _metSettings.subdivision || 'none';
    if (idx >= 0 && subdivMode !== 'none' && idx + 1 < beats.length) {
        const beatStart = beats[idx].time;
        const dt = beats[idx + 1].time - beatStart;
        const subdivTimes = subdivMode === 'eighth'
            ? [beatStart + dt * 0.5]
            : [beatStart + dt / 3, beatStart + dt * 2 / 3];

        for (let s = 0; s < subdivTimes.length; s++) {
            if (s <= _metState.lastSubdivInBeat) continue;
            if (t < subdivTimes[s]) break; // ordered ascending; nothing further is due yet
            _metState.lastSubdivInBeat = s;
            if (Math.abs(t - subdivTimes[s]) <= 0.05) {
                _metClick('low');
                // Dim flash for subdivision — only raise alpha, never lower a beat flash in progress
                if (_metSettings.flashEnabled && _metState.flashAlpha < 0.07) {
                    _metState.flashAlpha = 0.07;
                }
            }
        }
    }

    // Count-in overlay: show 4-3-2-1 before the first beat
    if (_metSettings.countInEnabled && beats && beats.length >= 2) {
        const firstBeatTime = beats[0].time;
        const beatInterval = beats[1].time - beats[0].time;
        const remaining = firstBeatTime - t;
        if (remaining > 0.01 && beatInterval > 0.01) {
            const count = Math.ceil((remaining + 0.001) / beatInterval);
            if (count >= 1 && count <= 4) {
                // alpha: 1.0 at the start of each count beat, fades to ~0.3 before the next
                const beatPhase = ((remaining + 0.001) % beatInterval) / beatInterval;
                _metUpdateCountIn(count, 0.3 + 0.7 * (1 - beatPhase));
            } else {
                _metClearCountIn();
            }
        } else {
            _metClearCountIn();
        }
    } else if (_metCountInEl) {
        _metClearCountIn();
    }
}

const TICK_INTERVAL_ID_KEY = 'slopsmithMetronomeTickIntervalId';
const VISIBILITY_CHANGE_HOOKS_INSTALLED_KEY = '__slopsmithMetronomeVisibilityChangeHooksInstalled';
const INSTALLED_VISIBILITY_CHANGE_HANDLER_REF_KEY = '__slopsmithMetronomeInstalledVisibilityChangeHandlerRef';

function _metStopTickInterval() {
    if (window[TICK_INTERVAL_ID_KEY]) {
        clearInterval(window[TICK_INTERVAL_ID_KEY]);
        window[TICK_INTERVAL_ID_KEY] = null;
    }
}

function _metStartTickInterval() {
    if (window[TICK_INTERVAL_ID_KEY]) return;
    window[TICK_INTERVAL_ID_KEY] = setInterval(function() {
        const currentHighway = _metGetHighway();
        const now = Date.now();
        if (
            window[DRAW_HOOK_HIGHWAY_REF_KEY] !== currentHighway &&
            now >= _metNextDrawHookRetryAtMs
        ) {
            _metEnsureDrawHookInstalled();
            _metNextDrawHookRetryAtMs = now + DRAW_HOOK_RETRY_DELAY_MS;
        }
        _metTick();
    }, 1000 / 60);
}

function _metInstallVisibilityHooks() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const installedVisibilityHandler = window[INSTALLED_VISIBILITY_CHANGE_HANDLER_REF_KEY];
    if (window[VISIBILITY_CHANGE_HOOKS_INSTALLED_KEY] === true && installedVisibilityHandler) return;

    const visibilityChangeHandler = function() {
        if (document.hidden) {
            _metStopTickInterval();
            return;
        }
        const currentHighway = _metGetHighway();
        if (currentHighway && typeof currentHighway.getBeats === 'function' && typeof currentHighway.getTime === 'function') {
            const beats = currentHighway.getBeats();
            const t = currentHighway.getTime();
            if (beats && beats.length) {
                let lo = 0, hi = beats.length;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (beats[mid].time <= t) lo = mid + 1;
                    else hi = mid;
                }
                _metState.lastBeatIdx = lo - 1;
                _metState.lastSubdivInBeat = -1;
            }
        }
        _metStartTickInterval();
    };

    window[INSTALLED_VISIBILITY_CHANGE_HANDLER_REF_KEY] = visibilityChangeHandler;
    window[VISIBILITY_CHANGE_HOOKS_INSTALLED_KEY] = true;
    document.addEventListener('visibilitychange', visibilityChangeHandler);
}

// Node-only export hook for tests; browsers fall through to the polling
// loop + playSong wrapping below.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        _metSettings, _metState, _metClick, _metFlash, _metBindVolumeSlider,
        _metBindFlashCheck, _metBindSubdivSelect, _metBindCountInCheck,
        _metInjectButton, _metSyncUi, _metToggle, _metSetVolume, _metSaveSettings,
        _metGetHighway, _metEnsureDrawHookInstalled, _metTick,
        _metUpdateCountIn, _metClearCountIn,
        _metStartTickInterval, _metStopTickInterval, _metInstallVisibilityHooks,
    };
    return;
}

// Register draw hook on the highway renderer for the visual flash
_metEnsureDrawHookInstalled();

// Poll at 60fps for beat detection
_metStopTickInterval();
_metStartTickInterval();

// Bug #5 fix: pause the polling loop while the tab is backgrounded instead
// of letting the browser throttle setInterval unpredictably, then resync
// lastBeatIdx (without firing a burst of "missed" clicks) on return so
// beats don't silently get marked visited without ever clicking.
_metInstallVisibilityHooks();

// Hook into playSong to inject button and reset state
(function() {
    const METRONOME_HOOKS_INSTALLED_KEY = '__slopsmithMetronomeHooksInstalled';
    const INSTALLED_PLAY_SONG_WRAPPER_REF_KEY = '__slopsmithMetronomeInstalledPlaySongWrapperRef';
    const PLAY_SONG_WRAPPED_TAG = 'slopsmithMetronomePlaySongWrapped';
    const PLAY_SONG_ORIGINAL_REF_TAG = 'slopsmithMetronomePlaySongOriginalRef';
    const currentPlaySong = window.playSong;
    if (typeof currentPlaySong !== 'function') return;
    const installedPlaySongRef = window[INSTALLED_PLAY_SONG_WRAPPER_REF_KEY];
    if (
        window[METRONOME_HOOKS_INSTALLED_KEY] === true &&
        installedPlaySongRef === currentPlaySong &&
        currentPlaySong[PLAY_SONG_WRAPPED_TAG] === true
    ) {
        return;
    }
    const playSongBaseFn = (
        currentPlaySong[PLAY_SONG_WRAPPED_TAG] === true &&
        typeof currentPlaySong[PLAY_SONG_ORIGINAL_REF_TAG] === 'function'
    )
        ? currentPlaySong[PLAY_SONG_ORIGINAL_REF_TAG]
        : currentPlaySong;

    const wrappedPlaySong = async function(filename, arrangement) {
        // Bug #2 fix: don't touch _metState/count-in until the new song's
        // audio has actually loaded. Resetting before the await let the
        // still-running tick see the *old* song's highway/beats with a
        // freshly-zeroed lastBeatIdx, firing a spurious click for "beat 0"
        // of the outgoing song while the new one was still loading.
        await playSongBaseFn(filename, arrangement);
        _metState.lastBeatIdx = -1;
        _metState.lastSubdivInBeat = -1;
        _metClearCountIn();
        _metInjectButton();
        _metStartTickInterval();
    };
    wrappedPlaySong[PLAY_SONG_WRAPPED_TAG] = true;
    wrappedPlaySong[PLAY_SONG_ORIGINAL_REF_TAG] = playSongBaseFn;
    window.playSong = wrappedPlaySong;
    window[INSTALLED_PLAY_SONG_WRAPPER_REF_KEY] = wrappedPlaySong;
    window[METRONOME_HOOKS_INSTALLED_KEY] = true;
})();

// Hook into window.showScreen (navigation) to clear the count-in overlay
// (bug #3) and stop the 60fps polling loop (bug #6) when the user leaves
// the player/song screen, instead of leaking a full-viewport overlay or
// burning CPU against a stale highway reference indefinitely.
(function() {
    const SHOW_SCREEN_HOOKS_INSTALLED_KEY = '__slopsmithMetronomeShowScreenHooksInstalled';
    const INSTALLED_SHOW_SCREEN_WRAPPER_REF_KEY = '__slopsmithMetronomeInstalledShowScreenWrapperRef';
    const SHOW_SCREEN_WRAPPED_TAG = 'slopsmithMetronomeShowScreenWrapped';
    const SHOW_SCREEN_ORIGINAL_REF_TAG = 'slopsmithMetronomeShowScreenOriginalRef';
    const currentShowScreen = window.showScreen;
    if (typeof currentShowScreen !== 'function') return;
    const installedShowScreenRef = window[INSTALLED_SHOW_SCREEN_WRAPPER_REF_KEY];
    if (
        window[SHOW_SCREEN_HOOKS_INSTALLED_KEY] === true &&
        installedShowScreenRef === currentShowScreen &&
        currentShowScreen[SHOW_SCREEN_WRAPPED_TAG] === true
    ) {
        return;
    }
    const showScreenBaseFn = (
        currentShowScreen[SHOW_SCREEN_WRAPPED_TAG] === true &&
        typeof currentShowScreen[SHOW_SCREEN_ORIGINAL_REF_TAG] === 'function'
    )
        ? currentShowScreen[SHOW_SCREEN_ORIGINAL_REF_TAG]
        : currentShowScreen;

    const wrappedShowScreen = function(...args) {
        _metClearCountIn();
        _metStopTickInterval();
        _metState.flashAlpha = 0;
        return showScreenBaseFn.apply(this, args);
    };
    wrappedShowScreen[SHOW_SCREEN_WRAPPED_TAG] = true;
    wrappedShowScreen[SHOW_SCREEN_ORIGINAL_REF_TAG] = showScreenBaseFn;
    window.showScreen = wrappedShowScreen;
    window[INSTALLED_SHOW_SCREEN_WRAPPER_REF_KEY] = wrappedShowScreen;
    window[SHOW_SCREEN_HOOKS_INSTALLED_KEY] = true;
})();

// Rebind existing controls immediately on script initialization/re-evaluation.
_metInjectButton();

})();
