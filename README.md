# Star Companion by Vorxen

An in-game search overlay for Star Citizen. Press **Ctrl + ↑**, type, and see where to buy an item, how to
craft it, which missions reward a blueprint, where to mine an ore and what each ship costs, in aUEC
and in USD.

The UI follows the "Star Companion by Vorxen" canvas made in Claude Design: an idle search bar that
grows into a result panel as you type, with text revealed behind a scan line.

## Executables

In `dist/`:

- `StarCompanion-<version>-setup.exe`: installer, with desktop and Start menu shortcuts.
- `StarCompanion-<version>-portable.exe`: runs without installing.

When closed, Star Companion is a small, faint icon that stays on screen. Click it (or press **Ctrl + ↑**)
and the search bar unfolds out of it toward the middle of the screen: right-to-left when the icon is
on the right half, left-to-right when it is on the left. Closing folds the bar back into the icon.
Drag the icon to place it anywhere; the tray menu can turn it off, in which case the shortcut alone opens it.

Run Star Citizen in **Borderless** mode. No overlay can draw over exclusive fullscreen. The first
launch shows a short "Before you start" notice with these requirements; tick "Don't show this
again" to skip it (the tray menu can show it again).

### Updates

At launch the installed app checks this repository's Releases. When a newer version exists it asks
"Update now" or "Later" (with "Don't remind me about this version"); "Update now" downloads it,
installs it and restarts. The portable exe can't replace itself, so it offers the download page
instead. The tray menu has "Check for updates" and can turn the launch check off. A log is kept in
`%APPDATA%\Star Companion\update.log`.

To publish a new version: bump `version` in `package.json`, run `npm run dist`, and create a GitHub
release tagged `v<version>` with `StarCompanion-<version>-setup.exe`, its `.blockmap`,
`latest.yml` and the portable exe from `dist/`.

| Key / action | What it does |
|---|---|
| Ctrl + ↑ | open/close (default; click the key in the bar to change it) |
| ↑ ↓ | move through results |
| Enter | open the selected result |
| Tab / Shift+Tab | filter by type (all, items, ships, blueprints, missions, minerals, locations) |
| PgUp / PgDn | scroll the panel |
| Esc | detail → list → clear search → close |
| Ctrl + = / Ctrl + - / Ctrl + 0 | larger / smaller / default text |
| drag "Star Companion" or the bar | move the overlay (the icon follows) |
| drag the corner grip | resize: width, and the panel's maximum height |

To change the shortcut, click the key shown in the search bar (or tray menu → Change hotkey) and
press the new combination: F-keys and numpad keys work alone, letters and numbers need Ctrl, Alt or
Shift. Enter saves it, Esc cancels; a shortcut another program already holds is refused.

The tray menu has: start with Windows (installed app, or the portable exe where it sits), show
icon when closed, icon opacity, window opacity, text size, reset position and size, change hotkey,
update database, edit settings, reload settings and quit. Everything set there or by
dragging is saved in `config.json` (`hotkey`, `hideOnBlur`, `opacity`, `zoom`, `dock`,
`dockOpacity`, `dockX`/`dockY`, `windowWidth`, `height` = maximum window height).

## Data sources

| Source | What it provides | How it is collected |
|---|---|---|
| finder.cstone.space | shops, base price and verification date for ~3,000 items and ships; item pictures | `/GetSearch` index + each item page (cached) |
| sc-craft.tools | 1,612 blueprints: materials, quality effects, missions that reward them | JSON API `/api/blueprints` |
| scminer.rocks | 37 minerals: locations and abundance per system, best sale, mining lasers/modules/gadgets and where to buy them | datasets embedded in the site's JS bundles |
| starcitizen.tools | items (size, grade, class, manufacturer), missions, locations, ships with default components | `api.star-citizen.wiki` |
| RSI Pledge Store | ship prices in USD (standalone, warbond, packages) | imported daily from robertsspaceindustries.com by the wiki |
| UEX Corp (what spviewer.eu uses) | buy/sell/rent prices per terminal | public API `api.uexcorp.uk/2.0` |

erkul.games and spviewer.eu's own API are not used: both require a token or an anti-bot challenge.
Their equivalent data (component specs, prices) comes from the wiki and UEX.

## Updating the data

```bash
npm run update-data
```

Runs every collector (`scripts/collect-*.js`) and builds `app/data/db.json`. cstone pages are cached
in `data/raw/cstone-pages`; `node scripts/update-all.js --fresh` downloads them all again. A collector
that fails keeps its previous dump.

In the executable, "Update database" (tray) writes the new database to
`%APPDATA%\Star Companion\data` and uses it instead of the bundled one. The first update downloads
everything from scratch and takes about 15 minutes (about 3,000 cstone pages).

## Development

```bash
npm install
npm start          # run from source
npm test           # search and database tests
npm run icon       # re-render the app icon from the design
npm run dist       # build the installer and the portable exe
```

Fonts (Chakra Petch, IBM Plex Sans, IBM Plex Mono) are bundled under `app/renderer/fonts` under the
SIL Open Font License, so the overlay works offline.
