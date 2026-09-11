# feedBack Plugin: Metronome

A plugin for [feedBack](https://github.com/got-feedback/feedback) that adds an audible metronome click and visual beat flash to the highway player, synced to the song's tempo.

## Features

- **Audible click** — plays a sine tone on every beat, with a higher pitch on downbeats (measure starts)
- **Visual flash** — subtle amber glow on the highway canvas on each beat (brighter on downbeats)
- **Tempo-synced** — follows the song's actual beat map, including tempo changes
- **Single icon button** — click the metronome icon to open a settings pop-up (enable/disable, volume, flash, subdivision, count-in); the pop-up's "Enabled" checkbox is the on/off toggle
- **Zero setup** — no configuration needed, works with any song

## Installation

```bash
cd /path/to/feedBack/plugins
git clone https://github.com/got-feedback/feedback-plugin-metronome.git metronome
docker compose restart
```

A metronome icon appears when you play a song. Where it shows up depends on the app version:

- **v0.3.0+ ("fee[dB]ack" v3 UI)** — the icon lives in the player's "Plugins" rail popover (hover the left icon rail during playback and open the plugin controls group). The v3 transport bar itself — where the speed slider lives — is reserved for host-native controls only, so the icon doesn't sit directly beside it.
- **Classic v2 UI** — the icon sits directly in the player controls bar.

Click it to open the settings pop-up: check "Enabled" to turn the click on/off, and adjust volume, flash, subdivision, or count-in from the same panel. The icon itself lights up whenever the metronome is enabled, even with the pop-up closed.

## How It Works

Arrangements include precise beat timing data with measure markers. The plugin reads this beat data from the highway renderer and triggers a click sound and visual flash at each beat position. Downbeats (first beat of each measure) get a higher-pitched click and a brighter flash.

## License

MIT
