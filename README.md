# Star Companion by Vorxen

An in-game search overlay for Star Citizen. Press **PageDown**, type, and see where to buy an item, how to
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

At launch a splash (the Splash artboard of the design canvas) plays in full while the database
loads: the panel opens, the name is revealed behind a scan line, the o7 icon draws itself and the
statuses run to Ready. It fades after about four and a half seconds (later only if the database is
still loading), never takes focus and lets clicks through.

When closed, Star Companion is a small, faint icon that stays on screen. Click it (or press **PageDown**)
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
| PageDown | open/close (default; click the key in the bar to change it) |
| ↑ ↓ | move through results |
| Enter | open the selected result |
| Tab / Shift+Tab | filter by type (all, items, ships, blueprints, missions, minerals, commodities, factions, locations) |
| PgUp / mouse wheel | scroll the panel (PgDn too, if you change the shortcut away from it) |
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

With the game in front, Windows refuses to hand keyboard focus to a background app, so the helper
also brings the search bar forward when the shortcut opens it (joining the game window's input for
that one call, the usual way around the refusal). Star Citizen can still leave the bar without
keyboard input until it is clicked, so when the shortcut opens it the helper clicks into the search
box, only once the bar is really in front (never while the game is, so the game cannot take it as a
shot), and puts the cursor back. Settings → Click into the search box turns this off. Settings →
Key listener shows whether the listener runs and how many key presses it has seen, and
`%APPDATA%\Star Companion\keys.log` records each shortcut press and whether the bar got focus (never
which other keys were pressed).

The icon shakes like a ringing alarm clock, with a soft glow, so a new player notices it: once at each launch,
and every few seconds until the bar has been opened for the first time (the startup notice does not count).
With Windows animations off, only the glow stays.

Settings (gear button in the search bar, or tray → Settings…) has: shortcut, key listener status,
start with Windows, close when clicking the game, show icon when closed, icon transparency, transparency
(0% solid to 100% in 20% steps; the bar and the icon start at 40%, the pins at 0%), text size, language (Automatic follows
Windows' display language: Portuguese → Português (Brasil), anything else → English), reset position
and size, updates, the startup notice and the settings file's folder. Everything is saved in
`config.json` (`hotkey`, `hideOnBlur`, `transparency`, `zoom`, `language`, `dock`, `dockTransparency`,
`dockX`/`dockY`, `windowWidth`, `height` = maximum window height). Once you resize with the grip,
your width and height are kept from then on.

Mineral pages have a **Copy RS for chat** button under the radar signature: it copies the signature
for 1 to 10 rocks as one line to paste in the game chat (`Gold RS: 3585, 7170, 10755, …`). Next to it,
**Pin {mineral}** and **Pin all ship ores / hand-mined / ROC ores** keep a small list beside the icon to
match a scanner reading while mining: one mineral with its signature for 1 to 10 rocks, or every
mineral of that kind with its signature, in alphabetical order. The same choice is in Settings (Pin
beside the icon) and the tray menu (Pin to Screen, which lists everything that can be pinned in alphabetical order, the zone maps and the minerals in submenus). The list never takes focus, lets clicks
through, and hides while the search bar is open. Every pinned window (signature lists, the hangar
timer, a zone map) has a small transparency slider (0% solid to 100%, in 20% steps) at its bottom right and a resize corner (the bottom
corner away from the icon; double-click it for the default size). The text grows with the window, so
a bigger pin reads more easily. Each kind keeps its own size and transparency.

Search **Executive Hangar** (or "exec hangar", "hangar executivo") for the Pyro contested-zone run that
ends in a PYAM Exec ship. The page shows the hangar's live timer: its five lights (red turning green
one every 24 minutes while it is closed for 2 hours, going out one every 12 minutes while it is open
for 1 hour, then 5 minutes of reset), the countdown and the next openings in your local time. Below:
the route (red keycards at PYAM-SUPVISR-3-4/3-5, compboards 1–3 at Checkmate, 4 and 7 at Orbituary,
5 and 6 at Ruin Station, then the hangar), the doors on the way to each compboard and the keycards
they take (2 red, 3 blue and the Crypt keycard for a full run), a cooldown timer for each keycard and
compboard spot (Start when you take one; it is kept if you close the app), the reward ships, and links
to the wiki and the timer sites.

Click a station's name (in the route, the tables or the route diagram) to see its contested zone map
as a mini map in the page, with a tab per zone; click the map for full size. **Pin map** keeps it
beside the icon, fainter than the icon so the game shows through (the small slider at its bottom right,
sets how faint, and is kept): drag its bottom corner (the one away
from the icon) to resize it, double-click that corner for the default 420 px, and close it with the ×
in its top-right corner. The location pages of Checkmate, Orbituary, Ruin Station, the
Supervisor stations and PYAM-EXHANG-0-1 show their map too. The maps are the community's: Terada
(@cmd_Terada) drew Checkmate, Orbituary and Ruin Station, and u/Kerast on Reddit the Executive Hangar
and the Supervisor stations. They are shown from contestedzonetimers.com, credited under each map, and
not copied into the app. **Pin the timer** keeps the lights
and the countdown beside the icon, like the signature lists (also Settings → Pin beside the icon →
Executive Hangar, and the tray menu). The cycle's start is read from contestedzonetimers.com at launch
and every 3 hours, and kept for starts without a connection.

Tables list their rows in alphabetical order (stats, shops, missions, mining locations, terminals…),
except where the order is the information: reputation levels and a system's planets.

Results are grouped by kind (activities such as the Executive Hangar, blueprints, then commodities, minerals, items, ships, factions, missions,
locations), with the exact name first. Colour and edition variants (Parallax "Sunstone"…) show as one
row with "+N variants"; the detail lists them all.

## Data sources

| Source | What it provides | How it is collected |
|---|---|---|
| finder.cstone.space | shops, base price and verification date for ~3,000 items and ships; item pictures | `/GetSearch` index + each item page (cached) |
| sc-craft.tools | 1,612 blueprints: materials, quality effects, missions that reward them with the drop chance. Each mission is matched to the wiki's missions by title (fill-in tokens such as `~mission(Location)` match any words) for the faction that offers it, the systems and the kind of mission (bounty hunting, defense, attack, recovery, mining…, read from the game's internal mission name); about 90 % of the links match | JSON API `/api/blueprints` |
| contestedzonetimers.com | the Executive Hangar cycle's start (re-checked in game by its author after each patch), the cycle's phases and each keycard and compboard spot's cooldown | `/lib/cfg.dat`, read by the app at launch and every 3 hours |
| expcarry.com contested zones guide, The Orbital Ledger, starcitizen.tools PYAM-EXHANG-0-1 | the doors and keycards on the way to each compboard, the route, the reward ships | read by hand into `scripts/build-db.js` |
| contestedzonetimers.com/contested-zone-maps | the zone maps by Terada (@cmd_Terada) and u/Kerast, shown in the page and the pin with their credit | loaded from the site when shown |
| scminer.rocks | 37 minerals as on its mineral directory cards: rarity, server base value (ship ores, aUEC/SCU), radar signature for 1–10 rocks (with a "Copy for chat" button: "Quantainium RS: 3170, 6340, …"), volatile ores (Quantainium, Savrilium), instability, resistance and density, locations and abundance per system, best sale; mining lasers/modules/gadgets and where to buy them | datasets embedded in the site's JS bundles |
| starcitizen.tools | items (size, grade, class, manufacturer), missions, locations, ships | `api.star-citizen.wiki` |
| starcitizen.tools ship pages | each ship's full default loadout, as erkul.games and the RSI ship page show it: guns with the turret or mount they sit on, missiles and bombs with their rack, and the components; groups and items in alphabetical order (coolers, jump drive, life support, missiles, power plants, quantum drive, radar, shields, weapons…), with size, grade (A–D) and class (Civilian, Military, Stealth…). Each gun and missile says who fires it: the pilot, a crew member in a manned turret, or one at a remote turret (the Paladin's side turrets also go to the pilot while no gunner sits at them); the pilot's come first. Countermeasures are left out | `api.star-citizen.wiki` vehicle detail, one request per ship |
| RSI Pledge Store | each ship's store price in USD: its standalone listing and, while it is on sale, the warbond one (about 220 ships), read from the store pages' own product data (`collect-rsi-prices.js`, one page at a time); the wiki's daily RSI import fills ships without a page. The ship page shows that one current price | robertsspaceindustries.com store pages, links from the wiki and UEX |
| UEX Corp (what spviewer.eu uses) | buy/sell/rent prices per terminal | public API `api.uexcorp.uk/2.0` |
| UEX commodities | 124 commodities at ~2,600 terminal prices: what each terminal pays and charges, demand and stock levels, auto load/unload, and the live PU version. The running app fetches demand, stock and prices again at launch and every 30 minutes (`scripts/lib/commodities.js`, shared with the collector), so they stay current without a database update | `commodities_prices_all`, `terminals`, `game_versions` |
| UEX marketplace | approximate player asking price of items listed now; a link to the marketplace filtered for each item. Items with offers at the last update are checked again, so listings older than the public feed's ~2 days are kept; UEX entries that differ only by spacing ("Torrent Compensator 2" / "Compensator2") count as one item | `marketplace_listings` |
| starcitizen.tools weapons | damage per shot by type, fire modes, rate and DPS for 760 personal and ship weapons; the real manufacturer where the game files have a placeholder | `api.star-citizen.wiki` items |
| starcitizen.tools factions | 57 factions: summary, area, focus, leadership and reputation ladder (standing names and reputation needed) | `api.star-citizen.wiki` factions |
| Pictures | cstone's render first; else the item's or ship's wiki page image (5,585 names); else a player's photo from an open UEX offer. All are requested at once, the first to arrive shows and a preferred one replaces it | `uifimages`, MediaWiki `pageimages` (`collect-images.js`), UEX listing photos |
| Curated notes | where players report finding things (`scripts/curated/tips.json`) and system overviews (`scripts/curated/systems.json`) | written by hand |

Blueprints include a crafting simulator with the same rules as sc-craft.tools: a quality slider (0–1000)
for all materials and one per material slot; each slot moves its stats in a straight line between the
modifier at the lowest and at the highest quality, and slots on the same stat multiply. Base damage and
fire rate come from the finished weapon.

Mission texts keep the game's fill-in tokens ([TargetName], [Location|Address]…); the database turns
them into plain words ("the target", "the contract location"), since the real values only exist once a
contract is generated in game. Medals show only their Pristine condition.

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
npm run dist       # build the installer
npm run dist:portable   # a portable exe for local testing (not published)
# Both first move the previous version's files from dist/ into dist/Old.
```

The app icon (the o7 salute) comes from the design pack in `build/icons/` (SVG source, PNGs from 16 to
1024 px and the `.ico`): `build/icon.ico` (exe, installer, shortcuts) and `build/icon.png` are copies
of it, `app/renderer/icon.png` is the 128 px one (the on-screen icon) and `app/renderer/tray.png` the
32 px one.

Fonts (Chakra Petch, IBM Plex Sans, IBM Plex Mono) are bundled under `app/renderer/fonts` under the
SIL Open Font License, so the overlay works offline.
