# SaveTether-Decky

A [Decky Loader](https://wiki.deckbrew.xyz/) plugin that shows, in Game Mode on the Steam Deck, the health of the save folders [SaveTether](https://github.com/carlocgc/SaveTether) links into your sync folder: one card per link, with its state, size and file count, and a Check now button.

It only reads. Setting links up, fixing them and everything else stays in SaveTether's desktop app in Desktop Mode. The plugin runs the installed `savetether` command with `--json` and shows what it says, so every check and safety rule stays in SaveTether itself.

## Before you install

SaveTether itself must be installed on the Deck (the desktop app's installer puts the `savetether` command in `~/.local/bin`), and set up with a sync folder.

## Install

The plugin is not in the Decky store. Install it by hand:

1. Download `savetether-decky-vX.Y.Z.zip` from this repository's [releases](https://github.com/carlocgc/SaveTether-Decky/releases).
2. In Game Mode, open Decky's settings, turn on Developer mode, and use its option to install a plugin from a zip file (or from the release's URL).

Releases tagged on `main` are stable; tags with a suffix (`v0.2.0-beta1`) are prereleases for testing.

## Develop

```bash
corepack pnpm@9 install
corepack pnpm@9 run build    # dist/index.js
corepack pnpm@9 test         # node --test, no extra dependencies
```

The phase plan, the tasks and the test flow on the Deck are in SaveTether's repository: `docs/plans/phase-4-decky-plugin.md` and `docs/testing/hardware-testing.md`.

## Licence

MIT, with the Decky plugin template's BSD-3-Clause notice kept as its licence requires. See [LICENSE](LICENSE).
