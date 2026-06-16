# Metronome Plugin Constitution

A small, single-file Slopsmith plugin. The plugin's design is intentionally
narrow: an audible click and a visual flash, synced to the song's beat
map. These principles keep that scope honest.

## Principles

### 1. Beat-Map Driven, Not Wall-Clock

The plugin must derive every tick from `highway.getBeats()` /
`highway.getTime()`. We do **not** maintain a parallel timer that could
drift from the renderer's notion of song time. Tempo changes already in
the beat map come along for free; new code should not invent its own
clock.

### 2. Zero Setup, Zero Persistence

The plugin works on any song with no per-song configuration. State
lives on `window.slopsmithMetronomeSettings` for cross-reload
preferences (volume, flash on/off, enabled flag). No config file, no
SQLite, no backend route — if a feature requires those, it belongs in
a different plugin.

### 3. Idempotent Re-Evaluation

Slopsmith re-evaluates `screen.js` on plugin reload. The script must be
idempotent: existing button bindings, intervals, draw hooks, and
`playSong` wrappers must be detected and reused or replaced cleanly
(see `*_KEY` markers in `screen.js`). New global state must follow the
same pattern.

### 4. Don't Fight the Renderer

Visual feedback is rendered via `highway.addDrawHook(...)`. We never
touch the highway canvas directly outside that hook, never poll faster
than 60 Hz, and never mutate the renderer's internal state. The
plugin is a passive consumer.

### 5. Audible Click is a Single Oscillator

The click is a 60 ms sine envelope (1500 Hz on downbeats, 1000 Hz
otherwise). We do not load samples or use a synth library — that would
cost a network request on a feature that should be instant. Volume is
the only user-facing control.

## Inherits from Slopsmith Core Constitution

This plugin is loaded by Slopsmith via `plugin.json`. It inherits the
core's expectations:

- Plugins must not block the main thread or the highway render loop.
- Plugins MUST tolerate the absence of `highway` (`screen.js` is
  evaluated before a song is loaded).
- Plugins MUST NOT assume single instantiation — `screen.js` may be
  re-run when a plugin is hot-reloaded.
- The plugin loader serves the file referenced by `plugin.json.script`;
  no other file in this repo is fetched by Slopsmith.

Where this plugin's principles disagree with the core constitution,
the core wins.
