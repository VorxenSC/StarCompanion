# Star Companion by Vorxen

An in-game search overlay for Star Citizen. Press **/**, type, and see where to buy an item, how to
craft it, which missions reward a blueprint, where to mine an ore, where each commodity sells best
and what each ship costs, in aUEC and in USD.

## Why

I built Star Companion for players whose PCs struggle to leave Star Citizen: on many machines, a quick
Alt+Tab to check a price turns into a long freeze, stutters or even a crash. Here, everything you'd look
up sits right on top of the game: press a key, find it, keep flying. And even on a powerful rig, it's
simply faster than leaving the cockpit.

The UI follows the "Star Companion by Vorxen" canvas made in Claude Design: an idle search bar that
grows into a result panel as you type, with text revealed behind a scan line.

## Install

Download `StarCompanion-<version>-setup.exe` from
[Releases](https://github.com/VorxenSC/StarCompanion/releases/latest) and run it. It installs to a
"Star Companion" folder, adds desktop and Start menu shortcuts, and updates itself from then on.

When closed, Star Companion is a small, faint icon that stays on screen. Click it (or press **/**)
and the search bar unfolds out of it toward the middle of the screen: right-to-left when the icon is
on the right half, left-to-right when it is on the left. Closing folds the bar back into the icon.
Drag the icon to place it anywhere; the tray menu can turn it off, in which case the shortcut alone opens it.

Run Star Citizen in **Borderless** mode. No overlay can draw over exclusive fullscreen. The first
launch shows a short "Before you start" notice with these requirements; tick "Don't show this
again" to skip it (the tray menu can show it again).

### Updates

At launch the installed app checks this repository's Releases. When a newer version exists it asks
"Update now" or "Later" (with "Don't remind me about this version"); "Update now" downloads it,
installs it and restarts. The tray menu has "Check for updates", and Settings can turn the launch
check off. A log is kept in `%APPDATA%\Star Companion\update.log`.

To publish a new version: bump `version` in `package.json`, run `npm run dist`, and create a GitHub
release tagged `v<version>` with `StarCompanion-<version>-setup.exe`, its `.blockmap` and
`latest.yml` from `dist/`.

| Key / action | What it does |
|---|---|
| / | open/close (default; click the key in the bar to change it) |
| ↑ ↓ | move through results |
| Enter | open the selected result |
| Tab / Shift+Tab | filter by type (all, items, ships, blueprints, missions, minerals, locations) |
| PgUp / PgDn | scroll the panel |
| Esc | detail → list → clear search → close |
| Ctrl + = / Ctrl + - / Ctrl + 0 | larger / smaller / default text |
| drag "Star Companion" or the bar | move the overlay (the icon follows) |
| drag the corner grip | resize: width, and the panel's maximum height |

The shortcut is a single key (no Ctrl, Alt or Shift). To change it, click the key shown in the search
bar (or Settings → Shortcut → Change) and press the new key; Enter saves it, Esc cancels. The key
still reaches the game, so pick one you don't need there; the numpad keys work well.

Why the shortcut works in game: Star Citizen registers its keyboard with Raw Input's "no hotkeys"
flag, which switches off ordinary global shortcuts while it has focus. A small helper
(`native/keys`, built with the .NET Framework C# compiler that ships with Windows) listens with Raw
Input in sink mode, the documented passive way for a background window to receive keys. Nothing is
hooked or injected and the game process is never touched. Run the game and Star Companion at the
same privilege level (both normal is best): Windows does not deliver an administrator window's keys
to a normal one.

Settings (gear button in the search bar, or tray → Settings…) has: shortcut, start with Windows,
close when clicking the game, show icon when closed, icon opacity, window opacity, text size, reset
position and size, updates, the startup notice and the settings file's folder. Everything is saved in
`config.json` (`hotkey`, `hideOnBlur`, `opacity`, `zoom`, `dock`, `dockOpacity`, `dockX`/`dockY`,
`windowWidth`, `height` = maximum window height).

## Data sources

| Source | What it provides | How it is collected |
|---|---|---|
| finder.cstone.space | shops, base price and verification date for ~3,000 items and ships; item pictures | `/GetSearch` index + each item page (cached) |
| sc-craft.tools | 1,612 blueprints: materials, quality effects, missions that reward them | JSON API `/api/blueprints` |
| scminer.rocks | 37 minerals: locations and abundance per system, best sale, mining lasers/modules/gadgets and where to buy them | datasets embedded in the site's JS bundles |
| starcitizen.tools | items (size, grade, class, manufacturer), missions, locations, ships with default components | `api.star-citizen.wiki` |
| RSI Pledge Store | ship prices in USD (standalone, warbond, packages) | imported daily from robertsspaceindustries.com by the wiki |
| UEX Corp (what spviewer.eu uses) | buy/sell/rent prices per terminal | public API `api.uexcorp.uk/2.0` |
| UEX commodities | 124 commodities at ~2,600 terminal prices: what each terminal pays and charges, demand and stock levels, auto load/unload, and the live PU version | `commodities_prices_all`, `terminals`, `game_versions` |
| UEX marketplace | approximate player asking price of items listed now; a link to the marketplace filtered for each item | `marketplace_listings` |

The search bar shows which PU version the data is for (for example **PU 4.10.2**). The app asks UEX
for the live version at launch and every 6 hours; after a patch the tag turns amber
("Data PU 4.10.2 · PU 4.11 live") until the database is updated.

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

## Support

Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million
aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7

☕ [buymeacoffee.com/fpessoau](https://buymeacoffee.com/fpessoau)

## Development

```bash
npm install
npm start          # run from source
npm test           # search and database tests
npm run icon       # re-render the app icon from the design
npm run dist       # build the installer
```

Fonts (Chakra Petch, IBM Plex Sans, IBM Plex Mono) are bundled under `app/renderer/fonts` under the
SIL Open Font License, so the overlay works offline.
