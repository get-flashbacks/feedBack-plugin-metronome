# feedBack Plugin: Metronome

A plugin for [feedBack](https://github.com/got-feedback/feedback) that adds an audible metronome click and visual beat flash to the highway player, synced to the song's tempo.

## Features

- **Audible click** — plays a sine tone on every beat, with a higher pitch on downbeats (measure starts)
- **Visual flash** — subtle amber glow on the highway canvas on each beat (brighter on downbeats)
- **Tempo-synced** — follows the song's actual beat map, including tempo changes
- **Icon button** — click the metronome icon in the player controls to open a settings pop-up (enable/disable, volume, flash, subdivision, count-in)
- **Zero setup** — no configuration needed, works with any song

## Installation

```bash
cd /path/to/feedBack/plugins
git clone https://github.com/got-feedback/feedback-plugin-metronome.git metronome
docker compose restart
```

A metronome icon will appear in the player controls bar when you play a song; click it to open the settings pop-up.

## How It Works

Arrangements include precise beat timing data with measure markers. The plugin reads this beat data from the highway renderer and triggers a click sound and visual flash at each beat position. Downbeats (first beat of each measure) get a higher-pitched click and a brighter flash.

## License

MIT
