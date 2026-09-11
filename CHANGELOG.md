# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Replaced the separate "Metronome" text toggle and settings icon with a single icon button. Clicking it opens the settings pop-up, whose "Enabled" checkbox is now the only on/off control; the icon itself still lights up whenever the metronome is enabled. (#12)
- Updated the README to describe where the icon actually surfaces per app version: the v3 "Plugins" rail popover vs. the classic v2 controls bar (the v3 transport bar, where the speed slider lives, is host-native-only and can't host plugin controls directly).

### Fixed

- Re-injecting the button on a page that still has the pre-consolidation two-button DOM (e.g. a stale tab that hasn't reloaded since an update) now correctly detects and replaces it, instead of misreading the old text toggle as the new consolidated button.
