/* global CompanionSearch, CompanionI18n, companion */
// Overlay UI following the "Star Companion by Vorxen" Claude Design canvas:
// idle = search bar only; typing opens a panel of one-line results; Enter opens the item detail.
const $ = (id) => document.getElementById(id);
const qEl = $('q');
const panelEl = $('panel');
const scrollEl = $('scroll');
const contentEl = $('content');
const filterEl = $('filter');

const COFFEE_URL = 'https://buymeacoffee.com/fpessoau';
const REPO_URL = 'https://github.com/VorxenSC/StarCompanion';
// Why the app exists, shown in Settings → About (and in the README).
const ABOUT_TEXT =
  "I built Star Companion for players whose PCs struggle to leave Star Citizen: on many machines, a quick Alt+Tab to check a price turns into a long freeze, stutters or even a crash. Here, everything you'd look up sits right on top of the game: press a key, find it, keep flying. And even on a powerful rig, it's simply faster than leaving the cockpit.";
// Translate: the English text is the key (see i18n.js). Section titles, notes, table headers, fact
// labels and link labels are translated by the helpers below; call sites wrap only other text.
const tr = (key, vars) => CompanionI18n.t(key, vars);

const TYPES = [
  ['all', 'All'],
  ['item', 'Items'],
  ['ship', 'Ships'],
  ['blueprint', 'Blueprints'],
  ['mission', 'Missions'],
  ['mineral', 'Minerals'],
  ['commodity', 'Commodities'],
  ['faction', 'Factions'],
  ['location', 'Locations'],
];
const TYPE_LABEL = { activity: 'Activity', item: 'Item', ship: 'Ship', blueprint: 'Blueprint', mission: 'Mission', mineral: 'Mineral', commodity: 'Commodity', faction: 'Faction', location: 'Location' };
const GROUP_LABEL = { activity: 'Activities', item: 'Items', ship: 'Ships', blueprint: 'Blueprints', mission: 'Missions', mineral: 'Minerals', commodity: 'Commodities', faction: 'Factions', location: 'Locations' };
const PANEL_GAP = 6; // .panel.open margin-top
const SHRINK_DELAY = 440; // let the panel's height transition finish before the window shrinks

let index = [];
let itemByName = new Map(); // item entries by exact name: blueprints read their weapon's base stats here
let dbEntries = []; // the loaded database's entries (live commodity data is patched into them)
let liveAt = null; // when the commodity demand shown was fetched from UEX (null: the database's)
let type = 'all';
let results = [];
let idx = 0;
let detail = null;
let listKey = '';
let maxHeight = 760; // window pixels
let zoom = 1; // text size; layout is measured in CSS px, the window in zoom × CSS px
let gripping = false;
let notice = false; // the "Before you start" notice is in the panel
let recorder = null; // { current, pending, partial, error } while the shortcut recorder is in the panel
let dataDate = '';
let gameVersion = null; // the PU version the database was built for

// "PU 4.10.2" beside the brand; turns amber with a hint when UEX reports a newer live version.
function renderPu(live) {
  const el = $('pu');
  if (!gameVersion) return;
  el.hidden = false;
  const stale = live && live !== gameVersion;
  el.classList.toggle('stale', !!stale);
  el.textContent = stale ? tr('Data PU {data} · PU {live} live', { data: gameVersion, live }) : `PU ${gameVersion}`;
  el.title = stale
    ? tr('The game is now on PU {live}; this data is for PU {data}. Tray menu → Update database.', { live, data: gameVersion })
    : live ? tr('Data matches the live Star Citizen version (PU {live}, per UEX).', { live }) : tr('Data for Star Citizen PU {data}.', { data: gameVersion });
}

// ---------- DOM helpers (all data goes through textContent, never innerHTML) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'delay') el.style.setProperty('--d', `${v}ms`); // CSSOM: allowed by the CSP
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n ?? '—');
// Tables list their rows in alphabetical order (of what the first column says, in the language shown).
// The exceptions keep an order that carries meaning: reputation levels (a ladder) and a system's
// planets (from the star outward), and 1×–10× rock counts.
const alpha = (key) => (a, z) => String(key(a) ?? '').localeCompare(String(key(z) ?? ''), CompanionI18n.getLanguage(), { sensitivity: 'base', numeric: true });
const sortedBy = (list, key) => [...list].sort(alpha(key));
const auec = (n) => (typeof n === 'number' && n > 0 ? h('span', { class: 'price' }, `${fmt(n)} aUEC`) : h('span', { class: 'dim' }, '—'));
const usd = (n) => h('span', { class: 'usd' }, `$${Number(n).toLocaleString('en-US')}`);
const link = (label, url) => h('a', { onclick: () => companion.openLink(url) }, label);
const jump = (label, query, t) => h('span', { class: 'link', onclick: () => goTo(query, t) }, label);
const section = (title, ...kids) => [h('div', { class: 'sec-title' }, tr(title)), ...kids];
const note = (text) => h('p', { class: 'note' }, tr(text));
const pct = (m) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;

// tableClass: "t-price" for the place · price · date tables, whose columns line up from one table to
// the next (the ship's USD price above its in-game shops).
function table(headers, rows, tableClass) {
  return h(
    'table',
    { class: tableClass },
    h('thead', null, h('tr', null, headers.map(([label, cls]) => h('th', { class: cls }, label && tr(label))))),
    h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c, i) => h('td', { class: headers[i][1] }, c))))),
  );
}

function links(pairs) {
  const present = pairs.filter(([, url]) => url);
  return present.length ? h('div', { class: 'links' }, present.map(([label, url]) => link(`${tr(label)} ↗`, url))) : null;
}

// Where to buy or rent, in alphabetical order of the place (cheapest first when two read the same).
// The sources (cstone, UEX, the wiki) often list the same shop, spelled a little differently
// ("Area 18 - Astro Armada" / "Area18 - Retail bridges - Astro Armada", "New Deal Lorville" /
// "Teasa Spaceport - New Deal"). Same price, same city, and one shop name inside the other (spaces
// ignored): one shop, shown once with its most recent check.
const flat = (s) => CompanionSearch.norm(s).replace(/ /g, '');
function shopParts(s) {
  const parts = String(s.where || '').split(' - ');
  return { city: flat(parts[2] || parts[1] || ''), shop: flat(parts[parts.length - 1]) };
}
const sameShop = (a, z) => {
  if ((a.price || 0) !== (z.price || 0)) return false;
  const x = shopParts(a);
  const y = shopParts(z);
  return x.city === y.city && x.shop && y.shop && (x.shop.includes(y.shop) || y.shop.includes(x.shop));
};
function dedupeShops(shops) {
  const kept = [];
  for (const s of shops) {
    const i = kept.findIndex((k) => sameShop(k, s));
    if (i === -1) kept.push(s);
    else if (String(s.verified || '') > String(kept[i].verified || '')) kept[i] = s;
  }
  return kept;
}
function shopsTable(shops) {
  const sorted = dedupeShops(shops).sort((a, z) => alpha((s) => s.where)(a, z) || (a.price || Infinity) - (z.price || Infinity));
  const sells = sorted.some((s) => s.sell);
  return table(
    [['Where', ''], ['Price', 'num'], ...(sells ? [['Sells for', 'num']] : []), ['Verified', 'dim']],
    sorted.map((s) => [s.where, auec(s.price), ...(sells ? [s.sell ? auec(s.sell) : ''] : []), s.verified || '']),
    sells ? undefined : 't-price',
  );
}

// ---------- Detail views: { facts: [[label, value]], body: [nodes] } ----------
function viewItem(e) {
  const d = e.d;
  const attrs = Object.entries(d.attrs || {})
    .filter(([k]) => k !== 'MANUFACTURER')
    .map(([k, v]) => [k.charAt(0) + k.slice(1).toLowerCase(), v]);
  const cheapest = d.shops?.filter((s) => s.price > 0).sort((a, z) => a.price - z.price)[0];
  const m = d.market;
  const uexUrl = d.uexId && `https://uexcorp.space/marketplace/?id_item=${d.uexId}`;
  const w = d.weapon;
  const topDps = w && Math.max(0, ...w.modes.map((x) => x.dps || 0));
  return {
    facts: [
      ['Damage', w?.perShot && h('span', null, h('span', { class: 'price' }, fmt(round1(w.perShot))), tr(' per shot'))],
      ['DPS', topDps > 0 && fmt(Math.round(topDps))],
      ['Manufacturer', d.manufacturer],
      ['Type', d.type],
      ['Size', d.size],
      ['Grade', d.grade],
      ['Class', d.class],
      ['Lowest price', cheapest && auec(cheapest.price)],
      ['UEX market price', m && h('span', null, h('span', { class: 'price' }, `~${fmt(m.approx)} aUEC`))],
      ['Craftable', d.craftable],
      ['Loot', d.lootable ? tr('Can be found as loot') : null],
      ...attrs,
    ],
    body: [
      tipsSection(d.tips),
      w && weaponSection(w),
      d.blueprint && section('Blueprint', jump(`View the ${e.n} blueprint →`, e.n, 'blueprint')),
      section(
        'Where to buy',
        d.shops?.length ? shopsTable(d.shops) : note(d.lootable ? 'Not sold in any known shop — found as loot.' : 'No known shop in the sources.'),
      ),
      (m || uexUrl) &&
        section(
          'Player market (UEX)',
          m
            ? table(
                [['Approx. asking price', ''], ['Range', 'num'], ['Offers', 'num'], ['Latest', 'dim']],
                [[auec(m.approx), h('span', null, auec(m.min), ' – ', auec(m.max)), `${m.sellCount} selling${m.buyCount ? ` · ${m.buyCount} buying` : ''}`, m.newest]],
              )
            : note('Not listed by players right now.'),
          m && note('Median of open player sell offers on the UEX marketplace; quality, pips and bundles vary, so check the listings.'),
          uexUrl && h('p', { class: 'note' }, link('Open the UEX marketplace filtered for this item ↗', uexUrl)),
        ),
      variantsSection(e),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['UEX market', uexUrl], ['cstone', d.cstoneUrl], ['Wiki', d.wikiUrl], ['scminer', d.minerUrl]]),
    ],
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

// Damage per shot by kind and each fire mode's rate and damage per second (wiki, from the game files).
function weaponSection(w) {
  return section(
    'Damage',
    w.damages.length > 0 && table([['Damage type', ''], ['Per shot', 'num']], sortedBy(w.damages, (x) => x.kind).map((x) => [x.kind.charAt(0).toUpperCase() + x.kind.slice(1), fmt(round1(x.damage))])),
    w.modes.length > 0 && table([['Fire mode', ''], ['Rate', 'num'], ['DPS', 'num']], sortedBy(w.modes, (x) => x.mode).map((x) => [x.mode, x.rpm ? `${fmt(x.rpm)} rpm` : tr('continuous'), x.dps ? fmt(Math.round(x.dps)) : '—'])),
    note([w.class, w.type, w.magazine && tr('{n} rounds per magazine', { n: w.magazine })].filter(Boolean).join(' · ')),
  );
}

// The other colours or editions of the same item (or blueprint), one click away.
function variantsSection(e) {
  const v = e.d.variants;
  if (!v || v.length < 2) return null;
  return section(
    tr('Variants ({n})', { n: v.length }),
    h('div', null, v.map((name) => h('span', { class: `pill${name === e.n ? ' current' : ''}` }, name === e.n ? name : jump(name, name, e.t)))),
  );
}

function tipsSection(tips) {
  if (!tips?.length) return null;
  return section('Where players find it', tips.map((t) => h('p', { class: 'tip' }, t.text, t.seen && h('span', { class: 'tip-src' }, ` — ${tr(t.seen)}`))));
}

function viewShip(e) {
  const d = e.d;
  // The ship's price in the RSI store, one line: read from its store page when that worked (d.rsi),
  // else the wiki's most recent standalone listing (never a package), else the RSI MSRP.
  const listings = (d.store || []).filter((s) => s.standalone && !s.pack).sort((a, z) => (z.checked || '').localeCompare(a.checked || ''));
  const wikiListing = listings.find((s) => s.available) || listings[0];
  const fromRsi = d.rsi && (d.rsi.usd != null
    ? { usd: d.rsi.usd, available: d.rsi.available, url: d.rsi.url, checked: d.rsi.checked }
    : d.rsi.warbond && { usd: d.rsi.warbond.usd, available: d.rsi.warbond.available, warbond: true, url: d.rsi.warbond.url, checked: d.rsi.checked });
  // A warbond on sale now is a current store price too: shown beside the standalone one.
  const warbondNow = d.rsi?.usd != null && d.rsi.warbond?.available ? { usd: d.rsi.warbond.usd, available: true, warbond: true, url: d.rsi.warbond.url, checked: d.rsi.checked } : null;
  const price = fromRsi
    || (wikiListing
      ? { usd: wikiListing.discountedUsd || wikiListing.usd, available: wikiListing.available, warbond: wikiListing.warbond, url: wikiListing.url, checked: wikiListing.checked }
      : d.msrp ? { usd: d.msrp, msrp: true } : null);
  const warbondBadge = h('span', { class: 'badge-warbond' }, 'WARBOND');
  return {
    facts: [
      ['Size', [d.size, d.sizeClass && `class ${d.sizeClass}`].filter(Boolean).join(' · ')],
      ['Crew', d.crew && (d.crew.min === d.crew.max ? d.crew.min : `${d.crew.min}–${d.crew.max}`)],
      ['Cargo', d.cargo != null && `${fmt(d.cargo)} SCU`],
      ['Speed', d.speed && `SCM ${fmt(d.speed.scm)} · max ${fmt(d.speed.max)}`],
      ['Hull', d.health && fmt(Math.round(d.health))],
      ['Shield', d.shieldHp && fmt(Math.round(d.shieldHp))],
      ['Pilot DPS', d.pilotDps && fmt(Math.round(d.pilotDps))],
      ['Store price', price && h('span', null, usd(price.usd), price.warbond && [' ', warbondBadge.cloneNode(true)])],
      ['In-game price', d.buy?.[0]?.price && auec(d.buy[0].price)],
      ['Status', d.status],
    ],
    body: [
      // What the ship flies with comes first, right after the overview; prices follow.
      d.loadout?.length > 0 && section('Default components', loadoutTable(d.loadout)),
      section(
        'Price in USD (RSI store)',
        !price
          ? note('No USD price (not sold in the RSI store).')
          : price.msrp
            ? h('p', { class: 'note' }, usd(price.usd), ' ', tr('MSRP — not listed in the store right now.'))
            : [
                table(
                  // The same columns as "Buy in game" below (place · price · date), so they line up; the
                  // listing's status sits beside its name.
                  [['Standalone ship', ''], ['USD', 'num'], ['Checked', 'dim']],
                  [price, warbondNow].filter(Boolean).map((p) => [
                    h(
                      'span',
                      null,
                      p.url ? link(e.d.shortName || e.n, p.url) : e.d.shortName || e.n,
                      ' ',
                      p.warbond && [warbondBadge.cloneNode(true), ' '],
                      h('span', { class: 'dim' }, `· ${tr(p.available ? 'on sale' : 'off sale')}`),
                    ),
                    usd(p.usd),
                    p.checked || '',
                  ]),
                  't-price',
                ),
                (price.warbond || warbondNow) && note('Warbond: a discounted offer that must be paid with new money (not store credit).'),
              ],
      ),
      section('Buy in game (aUEC)', d.buy?.length ? shopsTable(d.buy) : note('Not sold in any in-game shop.')),
      d.rent?.length > 0 && section('Rent in game', shopsTable(d.rent)),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['Wiki', d.wikiUrl], ['RSI store', d.pledgeUrl], ['cstone', d.cstoneUrl]]),
    ],
  };
}

// The default loadout grouped like erkul.games and the RSI ship page, groups and the items inside
// them in alphabetical order (of the group names in the language shown), each item with size (S3),
// grade (A–D) and class. Identical items on the same mount are counted (×4); a gun or missile shows
// the turret or rack it sits on.
const LOADOUT_GROUPS = [
  ['WeaponGun', 'Weapons'], ['Missile', 'Missiles'], ['Bomb', 'Bombs'], ['Shield', 'Shields'], ['PowerPlant', 'Power plants'],
  ['Cooler', 'Coolers'], ['QuantumDrive', 'Quantum drive'], ['JumpDrive', 'Jump drive'], ['Radar', 'Radar'], ['LifeSupportGenerator', 'Life support'],
  ['WeaponMining', 'Mining lasers'], ['SalvageHead', 'Salvage heads'], ['TractorBeam', 'Tractor beams'], ['QuantumInterdictionGenerator', 'Quantum interdiction'],
  ['EMP', 'EMP'],
];
// Who fires a weapon: the pilot, a crew member in a manned turret, or one at a remote turret's seat.
// Within a group the pilot's weapons come first.
const CONTROLS = { pilot: 'Pilot', 'remote-pilot': 'Remote turret · pilot if unmanned', manned: 'Crew turret', remote: 'Remote turret' };
const CONTROL_ORDER = ['pilot', 'remote-pilot', 'manned', 'remote'];
function groupLoadout(loadout) {
  const m = new Map();
  for (const l of loadout) {
    const k = `${l.type}|${l.item}|${l.mount || ''}|${l.control || ''}`;
    if (m.has(k)) m.get(k).count++;
    else m.set(k, { ...l, count: 1 });
  }
  const lang = CompanionI18n.getLanguage();
  const groupName = (t) => tr((LOADOUT_GROUPS.find(([g]) => g === t) || [t, t])[1]);
  const rank = (l) => (CONTROL_ORDER.indexOf(l.control) + 5) % 5;
  return [...m.values()].sort((a, z) =>
    groupName(a.type).localeCompare(groupName(z.type), lang) ||
    rank(a) - rank(z) ||
    a.item.localeCompare(z.item, lang) ||
    (a.mount || '').localeCompare(z.mount || '', lang));
}

// Left out of the table: decoy and noise launchers (countermeasures) say little about a ship.
const LOADOUT_HIDDEN = new Set(['WeaponDefensive']);
function loadoutTable(loadout) {
  const rows = groupLoadout(loadout.filter((l) => !LOADOUT_HIDDEN.has(l.type)));
  const label = (t) => tr((LOADOUT_GROUPS.find(([g]) => g === t) || [t, t])[1]);
  return table(
    [['Slot', 'dim'], ['Component', ''], ['Size', 'num'], ['Grade', 'num'], ['Class', 'dim']],
    rows.map((l, i) => [
      i === 0 || rows[i - 1].type !== l.type ? label(l.type) : '',
      h('span', null, jump(l.item, l.item, 'item'), l.count > 1 ? ` ×${l.count}` : '', l.mount && h('span', { class: 'dim' }, ` · ${tr('on {mount}', { mount: l.mount })}`),
        CONTROLS[l.control] && h('span', { class: `control control-${l.control}` }, tr(CONTROLS[l.control]))),
      l.size != null ? `S${l.size}` : '',
      l.grade ? h('span', { class: `grade grade-${l.grade.toLowerCase()}` }, l.grade) : '',
      l.class ? tr(l.class) : '',
    ]),
  );
}

function viewBlueprint(e) {
  const d = e.d;
  const mins = Math.round((d.craftTime || 0) / 60);
  const best = d.missions[0];
  const kinds = (m) => (m.kinds || []).map((k) => tr(k)).join(', ');
  return {
    facts: [
      ['Craft time', d.craftTime ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : `${mins} min`) : null],
      ['Materials', d.ingredients.length],
      ['Missions', d.missions.length || (d.defaultOwned ? 'Default blueprint' : 'None known')],
      // The mission most likely to give it, its odds, who offers it and what kind of job it is.
      ['Best mission', best && jump(best.name, best.name, 'mission'), { wide: true }],
      ['Drop chance', best && `${Math.round(best.chance * 100)}%`],
      ['Faction', best?.factions?.join(', ')],
      ['Mission type', best && kinds(best)],
      ['Systems', best?.systems?.join(', ')],
    ],
    body: [
      section(
        'Materials',
        table(
          [['Slot', 'dim'], ['Material', ''], ['Qty', 'num'], ['Quality affects', 'effects']],
          [...d.ingredients].sort((a, z) => a.slot.localeCompare(z.slot)).map((ing) => [
            ing.slot,
            h('span', null, ing.options.map((o, i) => [i ? ' or ' : '', jump(o.name, o.name, 'mineral')])),
            ing.options.map((o) => `${o.qty} ${o.unit === 'scu' ? 'SCU' : 'pcs'}`).join(' / '),
            ing.effects.map((f) => tr(f.stat)).join(', '), // what this material's quality changes (the simulator shows how much)
          ]),
        ),
      ),
      craftSimulator(e),
      section(
        'Missions that reward it',
        d.missions.length
          ? table(
              [['Mission', ''], ['Faction', ''], ['Type', 'dim'], ['Drop chance', 'num']],
              sortedBy(d.missions, (m) => m.name).map((m) => [jump(m.name, m.name, 'mission'), m.factions?.join(', ') || '', kinds(m), `${Math.round(m.chance * 100)}%`]),
            )
          : note(d.defaultOwned ? 'Every player already owns this blueprint.' : 'No known mission.'),
      ),
      section('Item', jump(`Where to buy a ready-made ${e.n} →`, e.n, 'item')),
      variantsSection(e),
      links([['sc-craft.tools', d.url]]),
    ],
  };
}

// ---------- Crafting simulator (same rules as sc-craft.tools) ----------
// Each material slot has a quality from 0 to 1000. A slot's quality effect moves a stat from its
// modifier at the lowest quality to its modifier at the highest, in a straight line; slots that touch
// the same stat multiply together. Base values come from the finished item (wiki and sc-craft).
const QUALITY_MAX = 1000;
function slotModifier(f, q) {
  const lo = f.qMin ?? 0;
  const hi = f.qMax ?? QUALITY_MAX;
  const t = hi > lo ? Math.max(0, Math.min(1, (q - lo) / (hi - lo))) : 1;
  return f.min + (f.max - f.min) * t;
}

function craftedModifiers(ingredients, qualities) {
  const out = new Map();
  ingredients.forEach((ing, i) => {
    for (const f of ing.effects) {
      const m = slotModifier(f, qualities[i]);
      out.set(f.stat, (out.has(f.stat) ? out.get(f.stat) : 1) * m);
    }
  });
  return out;
}

// Base values for the stats sc-craft names, when the finished item tells us them.
function craftBases(e) {
  const item = itemByName.get(e.n);
  const w = item?.d.weapon;
  const stats = e.d.itemStats;
  const rate = stats?.fire_modes?.[0]?.fire_rate || w?.modes.find((m) => m.rpm)?.rpm;
  const dps = w && Math.max(0, ...w.modes.map((m) => m.dps || 0));
  const bases = new Map();
  if (w?.perShot) bases.set('Impact Force', { value: w.perShot, unit: '', label: 'Damage per shot' });
  if (rate) bases.set('Fire Rate', { value: rate, unit: ' rpm' });
  if (dps > 0) bases.set('DPS', { value: dps, unit: '', derived: ['Impact Force', 'Fire Rate'] });
  if (stats?.mass_kg) bases.set('Mass', { value: stats.mass_kg, unit: ' kg', fixed: true });
  return bases;
}

function craftSimulator(e) {
  const ings = e.d.ingredients.filter((ing) => ing.effects.length);
  if (!ings.length) return null;
  const all = e.d.ingredients;
  const qualities = all.map(() => 500);
  const bases = craftBases(e);
  const stats = [...new Set(all.flatMap((ing) => ing.effects.map((f) => f.stat)))];
  const cells = new Map(); // stat -> { crafted, change }
  const fmtVal = (v, unit) => `${fmt(v >= 100 ? Math.round(v) : round1(v))}${unit || ''}`;
  const rows = [];
  for (const stat of stats) {
    const b = bases.get(stat);
    const crafted = h('span', { class: 'price' });
    const change = h('span');
    cells.set(stat, { crafted, change, b });
    rows.push([tr(b?.label || stat), b ? fmtVal(b.value, b.unit) : h('span', { class: 'dim' }, '×1.00'), crafted, change]);
  }
  const dps = bases.get('DPS');
  if (dps && stats.some((x) => dps.derived.includes(x))) {
    const crafted = h('span', { class: 'price' });
    const change = h('span');
    cells.set('DPS', { crafted, change, b: dps, derived: true });
    rows.push([tr('Damage per second'), fmtVal(dps.value), crafted, change]);
  }
  rows.sort(alpha((r) => r[0]));
  const update = () => {
    const mods = craftedModifiers(all, qualities);
    for (const [stat, c] of cells) {
      const m = c.derived ? c.b.derived.reduce((acc, k) => acc * (mods.get(k) ?? 1), 1) : mods.get(stat) ?? 1;
      c.crafted.textContent = c.b ? fmtVal(c.b.value * m, c.b.unit) : `×${m.toFixed(2)}`;
      const pctChange = Math.round((m - 1) * 1000) / 10;
      c.change.textContent = pctChange === 0 ? '±0%' : `${pctChange > 0 ? '+' : ''}${pctChange}%`;
      c.change.className = pctChange > 0 ? 'up' : pctChange < 0 ? 'down' : 'dim';
    }
  };
  const slider = (value, oninput) => {
    const r = h('input', { type: 'range', min: '0', max: String(QUALITY_MAX), step: '10', class: 'q-range' });
    r.value = String(value);
    r.addEventListener('input', () => oninput(Number(r.value)));
    return r;
  };
  // The number beside a slider: click it to type a quality (0–1000); Enter or leaving the box applies
  // it, Esc keeps the old value.
  const qualityValue = (onSet) => {
    const btn = h('button', { class: 'q-value', title: tr('Click to type a quality (0–1000)') }, '500');
    btn.addEventListener('click', () => {
      const input = h('input', { type: 'number', min: '0', max: String(QUALITY_MAX), step: '1', class: 'q-input', 'aria-label': tr('Quality') });
      input.value = btn.textContent;
      let done = false;
      const finish = (apply) => {
        if (done) return;
        done = true;
        const v = Math.round(Number(input.value));
        if (apply && input.value !== '' && Number.isFinite(v)) onSet(Math.max(0, Math.min(QUALITY_MAX, v)));
        input.replaceWith(btn);
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation(); // the box owns the keyboard: no search shortcuts while typing
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      btn.replaceWith(input);
      input.focus();
      input.select();
    });
    return btn;
  };
  const slotSliders = [];
  const outputs = [];
  const setSlot = (i, v) => {
    qualities[i] = v;
    slotSliders[i].value = String(v);
    outputs[i].textContent = String(v);
  };
  const setAll = (v) => {
    globalSlider.value = String(v);
    globalOut.textContent = String(v);
    all.forEach((_ing, i) => setSlot(i, v));
    update();
  };
  const globalOut = qualityValue(setAll);
  const globalSlider = slider(500, setAll);
  // One row per material slot, in alphabetical order of the slot (Cabling, Frame, Regulator…).
  const order = all.map((_ing, i) => i).sort((a, z) => all[a].slot.localeCompare(all[z].slot));
  for (let i = 0; i < all.length; i++) {
    outputs[i] = qualityValue((v) => { setSlot(i, v); update(); });
    slotSliders[i] = slider(500, (v) => { setSlot(i, v); update(); });
  }
  const slotRows = order.map((i) => h(
    'div',
    { class: 'q-row' },
    h('span', { class: 'q-slot' }, all[i].slot, h('span', { class: 'dim' }, ` · ${all[i].options.map((o) => o.name).join(' / ')}`)),
    slotSliders[i],
    outputs[i],
  ));
  update();
  return section(
    'Crafted quality',
    h('div', { class: 'q-row q-global' }, h('span', { class: 'q-slot' }, tr('All materials')), globalSlider, globalOut),
    h('div', { class: 'q-slots' }, slotRows),
    table([['Stat', ''], ['Base', 'num'], ['Crafted', 'num'], ['Change', 'num']], rows),
    note('Material quality 0–1000, as on sc-craft.tools: each slot moves its stats in a straight line between the lowest and highest quality, and slots on the same stat multiply.'),
  );
}

function viewMission(e) {
  const d = e.d;
  const reward = d.rewardMin ? `${fmt(d.rewardMin)}${d.rewardMax > d.rewardMin ? ` – ${fmt(d.rewardMax)}` : ''} ${d.currency === 'UEC' ? 'aUEC' : d.currency || ''}` : null;
  return {
    facts: [
      ['Contractor', d.giver],
      ['Faction', d.faction || d.factions?.join(', ')],
      ['Mission type', d.kinds?.map((k) => tr(k)).join(', ')],
      ['Systems', d.systems?.join(', ')],
      ['Legality', d.legal],
      ['Reward', reward],
      ['Minimum reputation', d.minStanding],
      ['Blueprints', d.blueprints?.length],
      ['Combat', d.combat],
      ['Cargo hauling', d.hauling],
      ['Shareable', d.shareable],
      ['One-time only', d.onceOnly],
    ],
    body: [
      d.blueprints?.length > 0 &&
        section(
          'Blueprints it can reward',
          table([['Blueprint', ''], ['Chance', 'num']], sortedBy(d.blueprints, (b) => b.name).map((b) => [jump(b.name, b.name, 'blueprint'), `${Math.round(b.chance * 100)}%`])),
        ),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['Wiki', d.url]]),
    ],
  };
}

// The levels scminer.rocks shows on its mineral cards, as bars: none/very low … extreme.
const LEVELS = { none: 0, 'very low': 1, low: 1, medium: 2, moderate: 2, high: 3, 'very high': 4, extreme: 5 };
function levelBar(word, tone) {
  const n = LEVELS[String(word || '').toLowerCase()];
  if (n == null) return word || null;
  const label = String(word).toLowerCase() === 'very low' ? 'Very low' : word; // the data says "Very Low"
  return h('span', { class: `level tone-${tone}` }, h('span', { class: 'level-track' }, h('i', { class: `level-fill w${n}` })), h('span', { class: 'level-word' }, tr(label)));
}

// The radar signature as one line for the game chat: "Gold RS: 3585, 7170, …". Players paste it to
// tell how many rocks of an ore the scanner is reading.
const rsLine = (e) => `${e.n} RS: ${e.d.rs.join(', ')}`;
function copyRsButton(e) {
  if (!e.d.rs || e.d.rs.length < 2) return null;
  const label = tr('Copy RS for chat');
  const btn = h('button', { class: 'set-btn copy-btn', title: rsLine(e) }, label);
  btn.addEventListener('click', () => {
    companion.copyText(rsLine(e));
    btn.textContent = tr('Copied');
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1600);
  });
  return btn;
}

// The signature list beside the icon (the "Pin mineral signatures" setting): one button pins this
// mineral with its 1×–10× rocks, another the whole list of its kind (ship ores, hand-mined, ROC
// ores). A button already showing on screen reads "Unpin" and takes the list away.
const PIN_KIND = { ship: 'Pin all ship ores', fps: 'Pin all hand-mined', vehicle: 'Pin all ROC ores' };
const pinButtons = [];
// The pinned map closed with its own ×: the buttons on screen read "Pin map" again.
companion.onPinChanged(async () => {
  const s = await companion.getSettings();
  for (const b of pinButtons) if (b.isConnected) b.refresh(s);
});
function pinButton(e, mode) {
  const label = mode === 'mineral' ? tr('Pin {name}', { name: e.n }) : tr(PIN_KIND[mode]);
  const btn = h('button', { class: 'set-btn copy-btn', title: tr('A list of radar signatures beside the icon, for scanning') }, label);
  const isOn = (s) => s.pinSignatures === mode && (mode !== 'mineral' || s.pinMineral === e.n);
  btn.refresh = (s) => {
    const on = isOn(s);
    btn.textContent = on ? tr('Unpin') : label;
    btn.classList.toggle('done', on);
  };
  pinButtons.push(btn);
  companion.getSettings().then(btn.refresh);
  btn.addEventListener('click', async () => {
    const s = await companion.getSettings();
    const next = await companion.setSetting('pinSignatures', isOn(s) ? false : { mode, mineral: e.n });
    for (const b of pinButtons) if (b.isConnected) b.refresh(next);
  });
  return btn;
}

// The radar signature of 1 to 10 rocks of this ore, with the copy and pin buttons beside its title.
function rsSection(e) {
  const rs = e.d.rs?.length > 1 ? e.d.rs : e.d.signature > 0 ? [e.d.signature] : null;
  if (!rs) return null;
  const many = rs.length > 1;
  pinButtons.length = 0;
  return [
    h('div', { class: 'sec-title' }, many ? tr('Radar signature (1× – {n}×)', { n: rs.length }) : tr('Radar signature')),
    h('div', { class: 'rs-chips' }, rs.map((v, i) => h('span', { class: 'rs-chip' }, h('span', { class: 'dim' }, `${i + 1}×`), fmt(v)))),
    // The copy and pin buttons, under the values they act on.
    h('div', { class: 'rs-actions' }, many && copyRsButton(e), many && pinButton(e, 'mineral'), PIN_KIND[e.d.category] && pinButton(e, e.d.category)),
  ];
}

function viewMineral(e) {
  const d = e.d;
  const systems = Object.entries(d.locations || {}).filter(([, list]) => list.length);
  const top = systems.flatMap(([, list]) => list).sort((a, z) => z.abundance - a.abundance)[0];
  const shipOre = d.category === 'ship';
  return {
    facts: [
      ['Server base', shipOre && d.baseValue && h('span', null, auec(d.baseValue), ' / SCU')],
      ['Radar signature', d.signature > 0 && `${fmt(d.signature)} RS`],
      ['Volatile', d.volatile && h('span', { class: 'badge-volatile' }, tr('VOLATILE (15 MIN)'))],
      ['Best Location', top && `${top.name} · ${top.abundance}%`],
      ['Rarity', d.tier && tr(d.tier.charAt(0).toUpperCase() + d.tier.slice(1))],
      ['Mined with', { ship: tr('Mining ship'), vehicle: tr('ROC / ground vehicle'), fps: tr('Hand tool (multitool)') }[d.category] || d.category],
      ['Sell value', d.bestSell?.price > 0 && h('span', null, auec(d.bestSell.price), ' / SCU')],
      ['Best sale at', d.bestSell?.price > 0 && d.bestSell.where],
      ['Found with', [d.props?.secondary, d.props?.tertiary].filter((x) => x && x !== '-').join(', ')],
    ],
    sortFacts: true, // the card reads in alphabetical order, left to right
    // The three levels on one row of their own, always in this order.
    bars: [
      ['Density', levelBar(d.props?.density, 'purple')],
      ['Instability', levelBar(d.props?.instability, 'red')],
      ['Resistance', levelBar(d.props?.resistance, 'orange')],
    ],
    body: [
      d.volatile && note('Volatile: once mined it becomes unstable in the hold. Sell or refine it within about 15 minutes, or it can explode.'),
      rsSection(e),
      d.commodity && section('Trading', jump(`Prices and demand per location for ${e.n} →`, e.n, 'commodity')),
      section(
        'Where to mine',
        systems.length
          ? sortedBy(systems, ([sys]) => sys).map(([sys, list]) => [
              h('div', { class: 'system' }, sys.toUpperCase()),
              table([['Location', ''], ['Abundance', 'num']], sortedBy(list, (l) => l.name).map((l) => [l.name, `${l.abundance}%`])),
            ])
          : note('No known locations.'),
      ),
      d.usedIn?.length > 0 &&
        section(`Used in ${d.usedInCount} blueprints`, h('div', null, sortedBy(d.usedIn, (n) => n).map((n) => h('span', { class: 'pill' }, jump(n, n, 'blueprint'))))),
      links([['scminer', d.url]]),
    ],
  };
}

// UEX inventory levels run 1 (empty) … 7 (full). For selling to a terminal, an empty inventory means
// the terminal wants it: demand is the inverse of its inventory. For buying, the level is the stock.
const DEMAND = ['', 'Very high', 'High', 'Good', 'Medium', 'Low', 'Very low', 'None'];
const STOCK = ['', 'Out of stock', 'Very low', 'Low', 'Medium', 'High', 'Very high', 'Full'];
function meter(filled, label, tone) {
  return h(
    'span',
    { class: `meter tone-${tone}`, title: label },
    h('span', { class: 'meter-bar' }, Array.from({ length: 7 }, (_, i) => h('i', { class: i < filled ? 'on' : null }))),
    h('span', { class: 'meter-label' }, label),
  );
}
const demandMeter = (inventory) => (inventory ? meter(8 - inventory, DEMAND[inventory], inventory <= 2 ? 'good' : inventory <= 4 ? 'mid' : 'low') : h('span', { class: 'dim' }, '—'));
const stockMeter = (stock) => (stock ? meter(stock, STOCK[stock], stock >= 5 ? 'good' : stock >= 3 ? 'mid' : 'low') : h('span', { class: 'dim' }, '—'));
// How cargo moves at the terminal: auto load/unload, else a freight elevator or a loading dock.
function placeCell(l) {
  const tag = l.autoLoad ? ['AUTO LOAD', 'auto'] : l.freightElevator ? ['ELEVATOR', 'manual'] : l.loadingDock ? ['DOCK', 'manual'] : null;
  return h('span', null, l.where, tag && h('span', { class: `badge-load ${tag[1]}`, title: l.autoLoad ? 'Cargo is loaded and unloaded automatically' : 'Cargo is moved by hand' }, tag[0]));
}

// "Stanton - microTech - New Babbage - TDD New Babbage" → "New Babbage - TDD New Babbage" for the header.
const shortWhere = (where) => where.split(' - ').slice(-2).join(' - ');

function viewCommodity(e) {
  const d = e.d;
  const sells = d.locations.filter((l) => l.sell).sort((a, z) => z.sell - a.sell);
  const buys = d.locations.filter((l) => l.buy).sort((a, z) => a.buy - z.buy);
  const at = (price, where) => h('span', null, auec(price), h('span', { class: 'headline-where' }, shortWhere(where)));
  return {
    facts: [
      ['Best sale', sells[0] && at(sells[0].sell, sells[0].where)],
      ['Cheapest buy', buys[0] && at(buys[0].buy, buys[0].where)],
      ['Code', d.code],
      ['Sell at', sells.length ? `${sells.length} terminals` : 'Nowhere listed'],
      ['Buy at', buys.length ? `${buys.length} terminals` : 'Nowhere listed'],
      ['Auto load/unload', d.locations.length ? `${d.locations.filter((l) => l.autoLoad).length} of ${d.locations.length} locations` : null],
      ['Legality', d.illegal ? 'Illegal — scanned cargo is contraband' : null],
    ],
    body: [
      d.mineral && section('Mining', jump(`Where to mine ${e.n} →`, e.n, 'mineral')),
      section(
        'Sell here · demand per location',
        sells.length
          ? table(
              [['Location', ''], ['Pays / SCU', 'num'], ['Demand', ''], ['Updated', 'dim']],
              sortedBy(sells, (l) => l.where).map((l) => [placeCell(l), auec(l.sell), demandMeter(l.inventory), l.updated || '']),
            )
          : note('No terminal buys it.'),
      ),
      section(
        'Buy here · stock per location',
        buys.length
          ? table(
              [['Location', ''], ['Costs / SCU', 'num'], ['Stock', ''], ['Updated', 'dim']],
              sortedBy(buys, (l) => l.where).map((l) => [placeCell(l), auec(l.buy), stockMeter(l.stock), l.updated || '']),
            )
          : note('No terminal sells it.'),
      ),
      note('Demand and stock are UEX inventory levels reported by players; they move as people trade. AUTO LOAD: cargo is loaded and unloaded for you; ELEVATOR / DOCK: you move it by hand.'),
      liveAt && note(tr('Live from UEX: updated at {time}, again every 30 minutes.', { time: new Date(liveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })),
      links([['UEX', d.url], ['Wiki', d.wikiUrl]]),
    ],
  };
}

// Fresh demand, stock and prices from UEX (fetched by the main process at launch and every 30 min)
// replace each commodity's terminal list; an open commodity page is drawn again with them.
function applyLiveCommodities(data) {
  if (!data?.commodities?.length || !dbEntries.length) return;
  const byName = new Map(data.commodities.map((c) => [CompanionSearch.norm(c.name), c.locations]));
  for (const e of dbEntries) {
    if (e.t !== 'commodity') continue;
    const locations = byName.get(CompanionSearch.norm(e.n));
    if (locations) e.d.locations = locations;
  }
  liveAt = data.at;
  if (detail?.t === 'commodity') {
    const top = scrollEl.scrollTop;
    render();
    scrollEl.scrollTop = top;
  }
}
companion.onCommoditiesLive(applyLiveCommodities);

function viewLocation(e) {
  const d = e.d;
  const o = d.overview;
  return {
    facts: [['Type', d.type], ['Inside', d.parent], ['System', d.system], ['Star', o?.star], ['Missions available', d.missionCount || null]],
    body: [
      o && section('System map', systemMap(e.n, o), o.summary && h('p', { class: 'desc' }, o.summary)),
      o && section(
        'Planets and moons',
        table([['Planet', ''], ['Moons', ''], ['Landing zone', '']], o.bodies.map((b) => [jump(b.name, b.name, 'location'), h('span', null, b.moons.map((m, i) => [i ? ', ' : '', jump(m, m, 'location')])), b.zones.join(', ')])),
      ),
      o?.jumpPoints?.length > 0 && section('Jump points', h('div', null, sortedBy(o.jumpPoints, (j) => j).map((j) => h('span', { class: 'pill' }, j)))),
      d.zoneMap && section('Zone map', zoneMapPanel([d.zoneMap], { tabs: false, initial: d.zoneMap.name })),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['Wiki', d.url]]),
    ],
  };
}

// A schematic of the system: the star, then each planet on its orbit, moons as dots around it.
// Stands in until the drawn map for each system is designed.
function systemMap(name, o) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    if (text != null) x.textContent = text;
    return x;
  };
  const n = o.bodies.length;
  const W = 640;
  const H = 150;
  const cy = 64;
  const svg = el('svg', { class: 'sysmap', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': tr('Map of {name}', { name }) });
  svg.append(el('circle', { cx: 0, cy, r: 34, class: 'sysmap-star' }));
  o.bodies.forEach((b, i) => {
    const x = 90 + (i * (W - 140)) / Math.max(1, n - 1);
    svg.append(el('path', { d: `M ${x} ${cy - 46} A ${x} ${x} 0 0 1 ${x} ${cy + 46}`, class: 'sysmap-orbit' }));
    const g = el('g', { class: 'sysmap-body' });
    g.append(el('circle', { cx: x, cy, r: 9 }));
    b.moons.forEach((_, j) => {
      const a = (j / Math.max(1, b.moons.length)) * Math.PI * 2 - Math.PI / 2;
      g.append(el('circle', { cx: x + Math.cos(a) * 17, cy: cy + Math.sin(a) * 17, r: 2.4, class: 'sysmap-moon' }));
    });
    g.append(el('text', { x, y: cy + 40, 'text-anchor': 'middle' }, b.name));
    if (b.zones.length) g.append(el('text', { x, y: cy + 56, 'text-anchor': 'middle', class: 'sysmap-zone' }, b.zones[0]));
    g.addEventListener('click', () => goTo(b.name, 'location'));
    svg.append(g);
  });
  return svg;
}

function viewFaction(e) {
  const d = e.d;
  const ranks = d.ranks || [];
  return {
    facts: [
      ['Type', d.type],
      ['Area', d.area],
      ['Focus', d.focus],
      ['Leadership', d.leadership],
      ['Headquarters', d.headquarters],
      ['Founded', d.founded],
      ['Ranks', ranks.filter((r) => r.min >= 0).length || null],
    ],
    body: [
      d.description && section('About', h('p', { class: 'desc' }, d.description)),
      ranks.length
        ? section(
            'Reputation levels',
            table([['Standing', ''], ['Reputation needed', 'num']], ranks.map((r) => [r.name, r.min < 0 ? tr('below 0') : fmt(r.min)])),
            note('Reputation is earned by completing this faction\'s contracts; each standing unlocks better-paid ones.'),
          )
        : note('No reputation ladder: this faction does not track standing with players.'),
      links([['Wiki', d.url]]),
    ],
  };
}

// ---------- Executive Hangar ----------
// The hangar's live timer (its five lights, the countdown, the next openings in local time), the run
// from the red keycards to the hangar, which keycard opens each compboard, a cooldown timer for each
// spot, the reward ships, and a pin that keeps the timer beside the icon.
let hangarAnchor = CompanionHangar.DEFAULT_ANCHOR;
companion.hangarAnchor().then((a) => { if (a) hangarAnchor = a; });
companion.onHangarAnchor((a) => { hangarAnchor = a; });

const HANGAR_PHASE = { closed: 'Closed', open: 'Open', reset: 'Resetting' };
const HANGAR_UNTIL = { closed: 'opens in {time}', open: 'closes in {time}', reset: 'reopens in {time}' };
const localTime = (s) => {
  const d = new Date(s * 1000);
  const time = d.toLocaleTimeString(CompanionI18n.getLanguage(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(CompanionI18n.getLanguage(), { weekday: 'short' })} ${time}`;
};

// Runs fn every second while el is on screen; stops once the page is left.
function everySecond(el, fn) {
  fn();
  const id = setInterval(() => (el.isConnected ? fn() : clearInterval(id)), 1000);
  return el;
}

// "Compboard 4" and "Blue keycard terminal 2" translate as "Compboard {n}" and so on.
const trNumbered = (text) => {
  const m = /^(.*\D)(\d+)$/.exec(text);
  return m ? tr(`${m[1]}{n}`, { n: m[2] }) : tr(text);
};

function hangarLights(lights) {
  return h('span', { class: 'hlights' }, lights.map((l) => h('i', { class: `hlight hlight-${l}` })));
}

// "Closed · opens in 1:04:12", kept current.
function hangarStatus() {
  const el = h('span', { class: 'hstatus' });
  return everySecond(el, () => {
    const s = CompanionHangar.state(Date.now(), hangarAnchor);
    el.className = `hstatus hstatus-${s.phase}`;
    el.replaceChildren(h('b', null, tr(HANGAR_PHASE[s.phase])), h('span', { class: 'hclock' }, ` · ${tr(HANGAR_UNTIL[s.phase], { time: CompanionHangar.clock(s.left) })}`));
  });
}

function hangarPanel() {
  const el = h('div', { class: 'hpanel' });
  return everySecond(el, () => {
    const s = CompanionHangar.state(Date.now(), hangarAnchor);
    const next = s.windows[0];
    el.replaceChildren(
      hangarLights(s.lights),
      h('div', { class: 'hpanel-text' },
        h('div', { class: `hpanel-big hstatus-${s.phase}` }, CompanionHangar.clock(s.left)),
        h('div', { class: 'dim' },
          s.phase === 'open'
            ? tr('Open until {time} (your time)', { time: localTime(s.openEnds) })
            : tr('Opens at {time} (your time), for 1 hour', { time: localTime(next.opens) }))),
    );
  });
}

// One countdown per keycard or compboard spot, started when you take one: its end time is kept, so it
// survives closing the overlay and restarting the app.
const COOLDOWN_KEY = 'hangar-cooldowns';
const loadCooldowns = () => { try { return JSON.parse(localStorage.getItem(COOLDOWN_KEY)) || {}; } catch { return {}; } };
const saveCooldowns = (c) => { try { localStorage.setItem(COOLDOWN_KEY, JSON.stringify(c)); } catch { /* the timers just won't outlive the app */ } };
function cooldownCell(c) {
  const id = `${c.where}|${c.what}`;
  const time = h('span', { class: 'cd-time' });
  const btn = h('button', { class: 'set-btn copy-btn cd-btn' });
  const paint = () => {
    const end = loadCooldowns()[id];
    const left = end ? Math.ceil((end - Date.now()) / 1000) : null;
    time.textContent = left > 0 ? CompanionHangar.clock(left) : left != null ? tr('Ready') : CompanionHangar.clock(c.minutes * 60);
    time.className = `cd-time${left > 180 ? ' cd-run' : left > 0 ? ' cd-soon' : left != null ? ' cd-ready' : ''}`;
    btn.textContent = end ? tr('Clear') : tr('Start');
  };
  btn.addEventListener('click', () => {
    const all = loadCooldowns();
    if (all[id]) delete all[id];
    else all[id] = Date.now() + c.minutes * 60000;
    saveCooldowns(all);
    paint();
  });
  return [everySecond(time, paint), btn];
}

function hangarRoute(route, onStop) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    if (text != null) x.textContent = text;
    return x;
  };
  // The run as a line of stops, from the Supervisor stations to the hangar, each under the body it
  // orbits; a click opens that place.
  const W = 640;
  const svg = el('svg', { class: 'sysmap hroute', viewBox: `0 0 ${W} 92`, role: 'img', 'aria-label': tr('Executive Hangar route') });
  const stops = route.map((r, i) => ({ ...r, x: 60 + (i * (W - 120)) / (route.length - 1) }));
  svg.append(el('path', { d: `M ${stops[0].x} 34 H ${stops[stops.length - 1].x}`, class: 'sysmap-orbit' }));
  stops.forEach((r, i) => {
    const g = el('g', { class: 'sysmap-body' });
    g.append(el('circle', { cx: r.x, cy: 34, r: i === stops.length - 1 ? 11 : 8, class: i === stops.length - 1 ? 'hroute-end' : '' }));
    g.append(el('text', { x: r.x, y: 38, 'text-anchor': 'middle', class: 'hroute-n' }, String(i + 1)));
    g.append(el('text', { x: r.x, y: 66, 'text-anchor': 'middle' }, r.where.length > 1 ? 'PYAM-SUPVISR' : r.where[0]));
    g.append(el('text', { x: r.x, y: 82, 'text-anchor': 'middle', class: 'sysmap-zone' }, r.near ? tr('near {body}', { body: r.near }) : r.where.length > 1 ? '3-4 · 3-5' : tr('near the star')));
    g.addEventListener('click', () => onStop(r.where[0]));
    svg.append(g);
  });
  return svg;
}

// ---------- Contested zone maps ----------
// The community's maps of each zone (shown from contestedzonetimers.com, credited to their authors) as a
// mini map in the page: a tab per zone, the map, a button to pin it beside the icon and one to open it
// full size. show(name) switches to that zone's map and brings it into view.
function zoneMapPanel(maps, { tabs = true, initial = null } = {}) {
  const img = h('img', { class: 'zmap-img', alt: '', referrerpolicy: 'no-referrer' });
  const caption = h('div', { class: 'zmap-caption' });
  const tabRow = tabs ? h('div', { class: 'zmap-tabs' }) : null;
  const panel = h('div', { class: 'zmap' }, tabRow, h('div', { class: 'zmap-hint dim' }, tr('Click a station\'s name to see its map.')), img, caption);
  let current = null;
  const show = (name, scroll) => {
    const m = maps.find((x) => x.name === name);
    if (!m) return;
    current = m;
    panel.classList.add('shown');
    img.onload = () => fit();
    img.src = m.url;
    img.style.aspectRatio = `${m.w} / ${m.h}`;
    img.title = tr('Open full size');
    for (const t of tabRow?.children || []) t.classList.toggle('on', t.dataset.name === m.name);
    const place = m.places?.[0] || m.name;
    caption.replaceChildren(...[
      mapCredit(m),
      mapPinButton(m),
      h('button', { class: 'set-btn copy-btn', onclick: () => companion.openLink(m.url) }, tr('Full size ↗')),
      maps.length > 1 && h('button', { class: 'set-btn', onclick: () => goTo(place, 'location') }, tr('Location page')),
    ].filter(Boolean));
    fit();
    if (scroll) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  img.addEventListener('click', () => current && companion.openLink(current.url));
  if (tabRow) for (const m of maps) tabRow.append(h('button', { class: 'zmap-tab', 'data-name': m.name, onclick: () => show(m.name) }, m.name));
  panel.show = show;
  if (initial) show(initial);
  return panel;
}

// "Map by Terada (@cmd_Terada) · from contestedzonetimers.com ↗": who drew it and where it is shown from.
function mapCredit(m) {
  return h('span', { class: 'zmap-credit dim' },
    tr('Map by'), ' ', m.byUrl ? link(m.by, m.byUrl) : h('b', null, m.by),
    ' · ', tr('from'), ' ', link(`${m.source || 'contestedzonetimers.com'} ↗`, m.sourceUrl || m.url));
}

function mapPinButton(m) {
  const btn = h('button', { class: 'set-btn copy-btn', title: tr('This map beside the icon') });
  btn.refresh = (s) => {
    const on = s.pinSignatures === 'map' && s.pinMap?.url === m.url;
    btn.textContent = on ? tr('Unpin') : tr('Pin map');
    btn.classList.toggle('done', on);
  };
  pinButtons.push(btn);
  companion.getSettings().then(btn.refresh);
  btn.addEventListener('click', async () => {
    const s = await companion.getSettings();
    const on = s.pinSignatures === 'map' && s.pinMap?.url === m.url;
    const next = await companion.setSetting('pinSignatures', on ? false : { mode: 'map', map: { name: m.name, url: m.url, w: m.w, h: m.h, by: m.by, source: m.source } });
    for (const b of pinButtons) if (b.isConnected) b.refresh(next);
  });
  return btn;
}

// "1 red", "2 blue", "Crypt" as small coloured tags.
function keycardTags(k) {
  const tags = [
    k.red && h('span', { class: 'kc kc-red' }, tr('Red ×{n}', { n: k.red })),
    k.blue && h('span', { class: 'kc kc-blue' }, tr('Blue ×{n}', { n: k.blue })),
    k.crypt && h('span', { class: 'kc kc-crypt' }, 'Crypt'),
  ].filter(Boolean);
  return tags.length ? h('span', { class: 'kcs' }, tags) : h('span', { class: 'dim' }, '—');
}

function hangarPinButton() {
  const btn = h('button', { class: 'set-btn copy-btn', title: tr('The hangar timer beside the icon') });
  btn.refresh = (s) => {
    const on = s.pinSignatures === 'hangar';
    btn.textContent = on ? tr('Unpin') : tr('Pin the timer');
    btn.classList.toggle('done', on);
  };
  pinButtons.push(btn);
  companion.getSettings().then(btn.refresh);
  btn.addEventListener('click', async () => {
    const s = await companion.getSettings();
    const next = await companion.setSetting('pinSignatures', s.pinSignatures === 'hangar' ? false : 'hangar');
    for (const b of pinButtons) if (b.isConnected) b.refresh(next);
  });
  return btn;
}

function viewActivity(e) {
  const d = e.d;
  // A station's name shows its zone map; places without a map open their page.
  const maps = zoneMapPanel(d.maps);
  const mapOf = (n) => d.maps.find((m) => m.places.includes(n));
  const place = (n) => (mapOf(n) ? h('span', { class: 'link map-link', title: tr('Show the map'), onclick: () => maps.show(mapOf(n).name, true) }, n) : jump(n, n, 'location'));
  return {
    actions: [hangarPinButton()],
    facts: [
      ['Hangar', hangarStatus()],
      ['Location', place(d.location)],
      ['System', jump(d.system, d.system, 'location')],
      ['Cycle', tr('185 min: 2 h closed, 1 h open, 5 min reset')],
      ['Compboards', tr('7 (boards 1–7)')],
      ['Keycards', keycardTags(d.keycards)],
      ['Reward', tr('One PYAM Exec ship')],
    ],
    body: [
      section('Hangar timer', hangarPanel(),
        table([['Opens', ''], ['Closes', '']], CompanionHangar.state(Date.now(), hangarAnchor).windows.map((w) => [localTime(w.opens), localTime(w.closes)])),
        note('The lights turn green one every 24 minutes while it is closed and go out one every 12 minutes while it is open. The compboards only go in while it is open; at the end an alarm sounds for 5 minutes and anyone still inside dies.')),
      section('Route', hangarRoute(d.route, (n) => (mapOf(n) ? maps.show(mapOf(n).name, true) : goTo(n, 'location'))),
        table([['Step', 'num'], ['Where', ''], ['What', '']], d.route.map((r, i) => [String(i + 1), h('span', null, r.where.map((w, j) => [j ? ', ' : '', place(w)])), tr(r.what)]), 't-steps')),
      section('Zone map', maps),
      section('Compboards',
        table([['Board', 'num'], ['Where', ''], ['Doors on the way', ''], ['Keycards', '']], d.boards.map((b) => [String(b.n), place(b.where), tr(b.doors), keycardTags(b)]), 't-steps t-boards'),
        note('Boards 2 and 3 share one room and boards 4 and 7 one red door, so a full run takes 2 red keycards, 3 blue and the Crypt keycard, plus fuses for the fuse doors. Blue keycards print inside Checkmate and Orbituary (Orbituary\'s behind its red door).')),
      section('Cooldown timers',
        note('Start one when you take a keycard or a compboard: it counts down until that spot gives another.'),
        table([['Where', ''], ['What', ''], ['Timer', 'num'], ['', '']], d.cooldowns.map((c) => [place(c.where), trNumbered(c.what), ...cooldownCell(c)]), 't-cd')),
      section('Reward ships',
        h('div', null, sortedBy(d.rewards, (r) => r.name).map((r) => h('span', { class: 'pill' }, r.ship ? jump(r.name, r.ship, 'ship') : r.name))),
        note('Each comes in a military or a stealth livery. Rare FPS weapons and grade A ship components can also be found inside.')),
      section('Good to know',
        h('ul', { class: 'hnotes' },
          ['The cycle is the same on every server and region.',
            'Dark lights while the timer says open: another player has already opened the door. The cycle itself does not change.',
            'After a patch or a server restart the timer can be off for a day or two, until it is checked again in game.',
            'Watch the service entrance when defending: it lets players in behind you.'].map((t) => h('li', null, tr(t))))),
      note('Timer: contestedzonetimers.com, by Appieman. Zone maps by Terada (@cmd_Terada: Checkmate, Orbituary, Ruin Station) and u/Kerast on Reddit (Executive Hangar, Supervisor), shown from contestedzonetimers.com.'),
      links([['Zone maps', d.mapsUrl], ['Wiki', d.url], ['Guide', d.guideUrl], ['Timer', d.timerUrl], ['Tracker', d.trackerUrl]]),
    ],
  };
}

const VIEWS = { item: viewItem, ship: viewShip, blueprint: viewBlueprint, mission: viewMission, mineral: viewMineral, commodity: viewCommodity, faction: viewFaction, location: viewLocation, activity: viewActivity };

// The item's picture, by preference: cstone's render, the wiki page's picture, then a player's photo
// from a UEX offer. All are tried at once (a missing cstone picture can take a while to fail): the
// first to arrive shows at once and a more preferred one replaces it when it arrives; the box goes
// away if none loads.
function imageFor(e) {
  const id = e.d.cstoneUrl?.split('/').pop();
  const urls = [id && `https://cstone.space/uifimages/${id}.png`, e.d.image, e.d.wikiImage, e.d.playerPhoto].filter(Boolean);
  if (!urls.length) return null;
  const img = h('img', { class: 'detail-img', alt: '' });
  const state = urls.map(() => null); // null = pending, true = loaded, false = failed
  const settle = () => {
    if (state.every((s) => s === false)) { img.remove(); fit(); return; }
    const best = state.findIndex((s) => s === true);
    if (best !== -1 && img.dataset.shown !== String(best)) {
      img.dataset.shown = String(best);
      img.src = urls[best];
      fit();
    }
  };
  urls.forEach((url, i) => {
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer'; // UEX's image server refuses requests carrying another site as referrer
    probe.onload = () => { state[i] = true; settle(); };
    probe.onerror = () => { state[i] = false; settle(); };
    probe.src = url;
  });
  img.referrerPolicy = 'no-referrer';
  return img;
}

// The one or two facts worth reading first; they sit beside the name, the rest go in the grid below.
const HEADLINE = {
  item: ['Lowest price', 'UEX market price', 'DPS'],
  ship: ['Store price', 'Warbond', 'In-game price'],
  blueprint: ['Craft time'],
  mission: ['Reward'],
  mineral: ['Server base', 'Radar signature', 'Volatile'],
  commodity: ['Best sale', 'Cheapest buy'],
  faction: ['Type', 'Area'],
  location: ['System', 'Star'],
  activity: ['Hangar'],
};

function renderDetail(e) {
  const { facts, body, actions, bars, sortFacts } = VIEWS[e.t](e);
  const present = ([, v]) => v != null && v !== '' && v !== false;
  const shown = facts.filter(present);
  const headline = shown.filter(([label]) => HEADLINE[e.t].includes(label));
  const rest = shown.filter(([label]) => !HEADLINE[e.t].includes(label));
  if (sortFacts) rest.sort(([a], [z]) => tr(a).localeCompare(tr(z), CompanionI18n.getLanguage()));
  const barRow = (bars || []).filter(present);
  const fact = ([label, value, opts], i) => {
    const d = 200 + Math.min(i, 12) * 40;
    return h(
      'div',
      { class: opts?.wide ? 'fact wide' : 'fact' },
      h('div', { class: 'scan', delay: d }),
      h('span', { class: 'fact-label in', delay: d }, tr(label)),
      h('span', { class: 'fact-value in', delay: d }, value === true ? tr('Yes') : value),
    );
  };
  return h(
    'div',
    { class: 'detail' },
    // Header: picture, then type, name, class and the headline facts.
    h(
      'div',
      { class: 'detail-head' },
      imageFor(e),
      h(
        'div',
        { class: 'detail-main' },
        h(
          'div',
          { class: 'detail-top' },
          h('span', { class: 'detail-type in' }, tr(TYPE_LABEL[e.t])),
          h('button', { class: 'back', onclick: back }, 'Back ', h('kbd', null, 'ESC')),
        ),
        h('div', { class: 'detail-name in', delay: 40 }, e.n),
        h('div', { class: 'detail-meta in', delay: 110 }, e.s || ''),
        actions?.some(Boolean) && h('div', { class: 'detail-actions in', delay: 130 }, actions),
        headline.length > 0 &&
          h(
            'div',
            { class: 'headline' },
            headline.map(([label, value], i) =>
              h('div', { class: 'headline-fact' }, h('span', { class: 'fact-label in', delay: 150 + i * 60 }, tr(label)), h('span', { class: 'headline-value in', delay: 150 + i * 60 }, value)),
            ),
          ),
      ),
    ),
    // Everything else spread across the full width.
    rest.length > 0 && h('div', { class: 'facts' }, rest.map(fact)),
    barRow.length > 0 && h('div', { class: 'facts facts-bars' }, barRow.map((b, i) => fact(b, rest.length + i))),
    h('div', { class: 'rise', delay: 420 }, body),
  );
}

function renderList() {
  return h(
    'div',
    { class: 'list' },
    results.map((e, i) => {
      const d = Math.min(i, 12) * 45;
      const more = e.variantHits?.n > 1 ? tr(' · +{n} variants', { n: e.variantHits.n - 1 }) : '';
      // A header where a new kind starts (only in "all": a filter shows one kind anyway).
      const header = type === 'all' && (i === 0 || results[i - 1].t !== e.t) && h('div', { class: 'group-head' }, tr(GROUP_LABEL[e.t]));
      return [header, h(
        'button',
        { class: `row${i === idx ? ' active' : ''}`, onclick: () => open(i), onmousemove: () => setIdx(i, false) },
        h('div', { class: 'scan', delay: d }),
        h('span', { class: 'row-type in', delay: d }, tr(TYPE_LABEL[e.t])),
        h('span', { class: 'row-name in', delay: d }, e.n),
        h('span', { class: 'row-meta in', delay: d }, `${e.s || ''}${more}`),
        rowArrow(),
      )];
    }),
  );
}

function rowArrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'row-arrow');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 8 H12 M8 4 L12 8 L8 12');
  path.setAttribute('stroke', '#5FD4E8');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('fill', 'none');
  svg.append(path);
  return svg;
}

// ---------- Startup notice: what the overlay needs to work ----------
function renderNotice() {
  const key = $('hotkey').textContent;
  const items = [
    ['Borderless window', 'Run Star Citizen in Borderless mode (Graphics → Window Mode). No overlay can appear over exclusive Fullscreen.'],
    [`${key} to open`, `Press ${key} or click the small icon to open and close the search. To use another key, click ${key} in the search bar or use the tray menu → Change hotkey.`],
    ['Internet', 'Search works offline. Item pictures, links, "Update database" and app updates need a connection.'],
    ['Community data', `Prices, shops, locations and drop chances come from community sites (cstone, sc-craft.tools, scminer.rocks, starcitizen.tools, UEX) and can lag behind a new patch. Data for PU ${gameVersion || '?'}, collected ${dataDate || 'with the bundled database'}; the PU tag turns amber when a new patch is live. Check in game before a long trip.`],
    ['Unofficial', 'A fan-made tool, not affiliated with Cloud Imperium Games or Roberts Space Industries.'],
  ];
  const dont = h('input', { type: 'checkbox', id: 'notice-dont' });
  return h(
    'div',
    { class: 'notice' },
    h('div', { class: 'detail-type in' }, 'Before you start'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Star Companion needs'),
    h(
      'div',
      { class: 'notice-list' },
      items.map(([title, text], i) => {
        const d = 140 + i * 70;
        return h('div', { class: 'fact notice-item' }, h('div', { class: 'scan', delay: d }), h('span', { class: 'fact-label in', delay: d }, title), h('p', { class: 'notice-text rise', delay: d + 60 }, text));
      }),
    ),
    h(
      'p',
      { class: 'notice-support rise', delay: 480 },
      'Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7',
      h('a', { class: 'coffee', onclick: () => companion.openLink(COFFEE_URL) }, 'Buy me a coffee ↗'),
    ),
    h(
      'div',
      { class: 'notice-actions rise', delay: 520 },
      h('label', { class: 'notice-check' }, dont, ' Don’t show this again'),
      h('button', { class: 'notice-ok', onclick: () => dismissNotice() }, 'Got it ', h('kbd', null, 'ENTER')),
    ),
  );
}

function showNotice() {
  notice = true;
  render();
  qEl.focus();
}

function dismissNotice() {
  if (!notice) return;
  companion.noticeDone(!!$('notice-dont')?.checked);
  notice = false;
  render();
  qEl.focus();
}

// ---------- Settings panel ----------
let settingsOpen = false;
let settings = null; // snapshot from the main process
let settingsDrawn = false; // animate the panel's entrance once, not on every change

async function openSettings() {
  recorder = null;
  notice = false;
  if (feedback) feedback.open = false;
  settings = await companion.getSettings();
  settingsOpen = true;
  settingsDrawn = false;
  render();
}

function closeSettings() {
  settingsOpen = false;
  render();
  qEl.focus();
}

async function changeSetting(key, value) {
  settings = await companion.setSetting(key, value);
  if (key === 'language') {
    CompanionI18n.setLanguage(settings.languageInUse);
    translateStatic();
  }
  render();
}

// Text written in index.html: elements marked data-i18n, plus the search box's placeholder.
function translateStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  qEl.placeholder = tr('Search items, ships, blueprints, missions, minerals…');
  $('settings-btn').title = $('settings-btn').ariaLabel = tr('Settings');
  $('suggest').title = tr('Send an idea, a bug or a data fix to the developer');
  $('coffee').title = tr('Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7');
}

async function settingsAction(action) {
  settings = await companion.settingsAction(action);
  if (action === 'notice') settingsOpen = false; // the notice takes the panel
  render();
}

function renderSettings() {
  const s = settings;
  const anim = !settingsDrawn;
  settingsDrawn = true;
  const cls = (c) => (anim ? c : c.replace(/\b(in|rise)\b/g, '').trim());
  const pct = (v) => `${Math.round(v * 100)}%`;
  const toggle = (key, on, disabled) =>
    h('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: disabled ? 'disabled' : null, onclick: () => changeSetting(key, !on) }, h('i'));
  const steps = (key, list, current, disabled, label = pct) =>
    h('span', { class: 'seg', role: 'group' }, list.map((v) => h('button', { class: `seg-btn${Math.abs(current - v) < 0.001 ? ' on' : ''}`, disabled: disabled ? 'disabled' : null, onclick: () => changeSetting(key, v) }, label(v))));
  const row = (label, hint, control, i) =>
    h('div', { class: cls('set-row rise'), delay: 120 + i * 35 }, h('div', { class: 'set-text' }, h('span', { class: 'set-label' }, tr(label)), hint && h('span', { class: 'set-hint' }, tr(hint))), h('div', { class: 'set-control' }, control));
  const group = (title) => h('div', { class: cls('set-group rise'), delay: 100 }, tr(title));
  const choice = (key, options, current) =>
    h('span', { class: 'seg', role: 'group' }, options.map(([v, label]) => h('button', { class: `seg-btn${current === v ? ' on' : ''}`, onclick: () => changeSetting(key, v) }, label)));
  let i = 0;
  return h(
    'div',
    { class: 'notice settings' },
    h('div', { class: 'detail-top' }, h('span', { class: cls('detail-type in') }, tr('Settings')), h('button', { class: 'back', onclick: closeSettings }, tr('Done '), h('kbd', null, 'ESC'))),
    h('div', { class: cls('detail-name in'), delay: 40 }, 'Star Companion'),
    group('Opening'),
    row('Shortcut', 'Opens and closes the search, even in game', h('span', { class: 'set-inline' }, h('kbd', null, s.hotkey), h('button', { class: 'set-btn', onclick: () => startRecorder(s.hotkey) }, tr('Change'))), i++),
    row(
      'Key listener',
      s.keys.listener
        ? tr('Active · {n} key presses seen{last}', { n: fmt(s.keys.seen ?? 0), last: s.keys.lastHitAt ? tr(' · shortcut last pressed {t}', { t: new Date(s.keys.lastHitAt).toLocaleTimeString() }) : '' })
        : tr('Not running: the shortcut only works outside the game'),
      h('button', { class: 'set-btn', onclick: () => settingsAction('showKeysLog') }, tr('Show log')),
      i++,
    ),
    row('Start with Windows', s.canStartWithWindows ? 'Launch quietly when you sign in' : 'Available in the installed app', toggle('startWithWindows', s.startWithWindows, !s.canStartWithWindows), i++),
    row('Click into the search box', 'When the shortcut opens it, so you can type at once in game', toggle('autoClick', s.autoClick), i++),
    row(
      'Pin beside the icon',
      'Radar signatures for scanning, the Executive Hangar timer or a zone map',
      choice('pinSignatures', [[false, tr('Off')], ['ship', tr('Ship ores')], ['fps', tr('Hand-mined')], ['vehicle', tr('ROC ores')], ...(s.pinMineral ? [['mineral', s.pinMineral]] : []), ['hangar', tr('Executive Hangar')], ...(s.pinMap ? [['map', tr('{name} map', { name: s.pinMap.name })]] : [])], s.pinSignatures || false),
      i++,
    ),
    row('Close when clicking the game', 'Fold back into the icon when the game gets focus', toggle('hideOnBlur', s.hideOnBlur), i++),
    group('Look'),
    row('Show icon when closed', 'A faint icon stays on screen; click it to open', toggle('dock', s.dock), i++),
    row('Icon opacity', 'How visible the icon is while you play', steps('dockOpacity', s.steps.dockOpacity, s.dockOpacity, !s.dock), i++),
    row('Transparency', 'Default is solid; 100% is as see-through as stays readable', steps('transparency', s.steps.transparency, s.transparency, false, (v) => (v === 0 ? tr('Default') : pct(v))), i++),
    row('Text size', 'Also Ctrl + = and Ctrl + -', steps('zoom', s.steps.zoom, s.zoom), i++),
    row('Language', 'Automatic follows Windows', choice('language', [['auto', tr('Automatic')], ['en', tr('English')], ['pt-BR', tr('Portuguese')]], s.language), i++),
    row('Position and size', 'Back to the default place and size', h('button', { class: 'set-btn', onclick: () => settingsAction('resetLayout') }, tr('Reset')), i++),
    group('Updates and help'),
    row('Check for updates at launch', tr('You have v{version}', { version: s.version }), h('span', { class: 'set-inline' }, toggle('checkUpdates', s.checkUpdates), h('button', { class: 'set-btn', onclick: () => settingsAction('checkUpdates') }, tr('Check now'))), i++),
    row('Startup notice', 'What the overlay needs to work', h('button', { class: 'set-btn', onclick: () => settingsAction('notice') }, tr('Show')), i++),
    row('Settings file', 'For advanced edits; opens its folder', h('button', { class: 'set-btn', onclick: () => settingsAction('showFile') }, tr('Show in folder')), i++),
    group('About Star Companion'),
    h('p', { class: cls('about-text rise'), delay: 120 + i++ * 35 }, tr(ABOUT_TEXT)),
    h(
      'div',
      { class: cls('about-links rise'), delay: 120 + i++ * 35 },
      h('span', { class: 'dim' }, `Star Companion v${s.version} · by Vorxen`),
      h('span', { class: 'set-inline' }, h('button', { class: 'set-btn', onclick: () => { settingsOpen = false; openFeedback(); } }, tr('Suggest')), h('button', { class: 'set-btn coffee-btn', onclick: () => companion.openLink(COFFEE_URL) }, tr('Buy me a coffee')), h('button', { class: 'set-btn', onclick: () => companion.openLink(REPO_URL) }, 'GitHub')),
    ),
  );
}

// ---------- Suggestions form ----------
// The draft survives closing the form; it is cleared only once sent.
const FEEDBACK_KINDS = ['Idea', 'Bug', 'Wrong or missing data', 'Other'];
let feedback = null; // { open, kind, message, name, email, includeInfo, status: '' | 'sending' | 'sent', error }

function openFeedback() {
  feedback = { ...(feedback?.status === 'sent' ? {} : feedback), open: true, status: '', error: '' };
  feedback.kind ||= 'Idea';
  feedback.includeInfo ??= true;
  recorder = null;
  notice = false;
  render();
  setTimeout(() => $('fb-message')?.focus(), 50);
}

function closeFeedback() {
  if (!feedback) return;
  feedback.open = false;
  render();
  qEl.focus();
}

async function submitFeedback() {
  const f = feedback;
  if (!f || f.status === 'sending') return;
  if ((f.message || '').trim().length < 10) {
    f.error = 'Please write at least a sentence.';
    return refreshFeedbackStatus();
  }
  f.status = 'sending';
  f.error = '';
  refreshFeedbackStatus();
  const res = await companion.sendFeedback({ kind: f.kind, message: f.message, name: f.name, email: f.email, includeInfo: f.includeInfo, gameVersion });
  if (res.ok) {
    feedback = { open: true, status: 'sent' };
    render();
    setTimeout(() => feedback?.status === 'sent' && closeFeedback(), 5000);
  } else {
    f.status = '';
    f.error = res.error;
    refreshFeedbackStatus();
  }
}

// Updates the status line and button without rebuilding the form (keeps focus and caret).
function refreshFeedbackStatus() {
  const el = $('fb-status');
  if (el) {
    el.textContent = feedback.status === 'sending' ? 'Sending…' : feedback.error || '';
    el.classList.toggle('err', !!feedback.error);
  }
  const btn = $('fb-send');
  if (btn) btn.disabled = feedback.status === 'sending';
}

function renderFeedback() {
  const f = feedback;
  if (f.status === 'sent') {
    return h(
      'div',
      { class: 'notice feedback' },
      h('div', { class: 'detail-type in' }, 'Suggestions'),
      h('div', { class: 'detail-name in', delay: 40 }, 'Thank you, citizen — o7'),
      h('p', { class: 'notice-text rise', delay: 120 }, 'Your message is on its way to the developer. Every idea is read.'),
      h('div', { class: 'notice-actions rise', delay: 200 }, h('span'), h('button', { class: 'notice-ok', onclick: closeFeedback }, 'Back to search ', h('kbd', null, 'ESC'))),
    );
  }
  const field = (id, label, input) => h('label', { class: 'fb-field', for: id }, h('span', { class: 'fact-label' }, label), input);
  const bind = (key) => (ev) => { f[key] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; if (key === 'message') $('fb-count').textContent = `${f.message.length}/4000`; };
  const message = h('textarea', { id: 'fb-message', class: 'fb-input fb-message', maxlength: '4000', rows: '5', placeholder: 'What would make Star Companion better? What broke, or what did you not find?', oninput: bind('message') });
  message.value = f.message || '';
  const name = h('input', { id: 'fb-name', class: 'fb-input', maxlength: '80', placeholder: 'e.g. Vorxen#1234', oninput: bind('name') });
  name.value = f.name || '';
  const email = h('input', { id: 'fb-email', class: 'fb-input', type: 'email', maxlength: '120', placeholder: 'you@example.com', oninput: bind('email') });
  email.value = f.email || '';
  const info = h('input', { type: 'checkbox', id: 'fb-info', onchange: bind('includeInfo') });
  info.checked = f.includeInfo;
  return h(
    'div',
    { class: 'notice feedback' },
    h('div', { class: 'detail-type in' }, 'Suggestions'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Help shape Star Companion'),
    h('p', { class: 'notice-text rise', delay: 100 }, 'Ideas, bugs, wrong prices or missing items: it goes straight to the developer.'),
    h(
      'div',
      { class: 'fb-kinds rise', delay: 140, role: 'group', 'aria-label': 'Kind of suggestion' },
      FEEDBACK_KINDS.map((k) =>
        h('button', { class: `fb-kind${f.kind === k ? ' on' : ''}`, 'aria-pressed': f.kind === k ? 'true' : 'false', onclick: (ev) => { f.kind = k; ev.currentTarget.parentElement.querySelectorAll('.fb-kind').forEach((b) => { const on = b.textContent === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); } }, k),
      ),
    ),
    h('div', { class: 'rise', delay: 180 }, field('fb-message', 'Your message', message), h('div', { class: 'fb-count', id: 'fb-count' }, `${(f.message || '').length}/4000`)),
    h('div', { class: 'fb-row rise', delay: 220 }, field('fb-name', 'Name or Discord · optional', name), field('fb-email', 'Email for a reply · optional', email)),
    h('label', { class: 'notice-check rise', delay: 260 }, info, ` Include app version and PU ${gameVersion || ''}`),
    h(
      'div',
      { class: 'notice-actions rise', delay: 300 },
      h('span', { class: 'fb-status', id: 'fb-status', role: 'status' }, f.error || ''),
      h('span', { class: 'fb-buttons' }, h('button', { class: 'back', onclick: closeFeedback }, 'Cancel ', h('kbd', null, 'ESC')), h('button', { class: 'notice-ok', id: 'fb-send', onclick: submitFeedback }, 'Send ', h('kbd', null, 'CTRL+ENTER'))),
    ),
  );
}

// ---------- Shortcut recorder ----------
function keyChips(accelerator) {
  return accelerator.split('+').map((k, i) => [i ? h('span', { class: 'rec-plus' }, '+') : null, h('kbd', { class: 'rec-key' }, k)]);
}

function renderRecorderKeys() {
  const r = recorder;
  const shown = r.pending || (r.partial?.length ? `${r.partial.join('+')}+…` : null);
  return h('div', { class: `rec-box${r.pending ? ' set' : ''}`, id: 'rec-box' }, shown ? keyChips(shown) : h('span', { class: 'rec-wait' }, 'Waiting for keys…'));
}

function renderRecorder() {
  const r = recorder;
  return h(
    'div',
    { class: 'notice recorder' },
    h('div', { class: 'detail-type in' }, 'Keyboard shortcut'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Press the new shortcut'),
    h('p', { class: 'notice-text rise', delay: 120 }, 'Press one key on its own (no Ctrl, Alt or Shift). It opens and closes Star Companion from anywhere, including in game, and still reaches the game, so pick one you don\'t use there: numpad keys work well.'),
    h('div', { class: 'rise', delay: 180 }, renderRecorderKeys()),
    h('div', { class: 'rec-meta rise', delay: 220 }, h('span', null, 'Current: ', h('kbd', null, r.current)), h('span', { class: 'rec-error', id: 'rec-error' }, r.error || '')),
    h(
      'div',
      { class: 'notice-actions rise', delay: 260 },
      h('button', { class: 'back', onclick: cancelRecorder }, 'Cancel ', h('kbd', null, 'ESC')),
      h('button', { class: 'notice-ok', id: 'rec-save', onclick: saveRecorder, disabled: r.pending ? null : 'disabled' }, 'Save ', h('kbd', null, 'ENTER')),
    ),
  );
}

// Updates only the keys, error and button, so the entrance animation doesn't replay on every key.
function refreshRecorder() {
  $('rec-box')?.replaceWith(renderRecorderKeys());
  const err = $('rec-error');
  if (err) err.textContent = recorder.error || '';
  const save = $('rec-save');
  if (save) save.disabled = !recorder.pending;
}

function startRecorder(current) {
  recorder = { current: current || $('hotkey').textContent, pending: null, partial: null, error: '' };
  notice = false;
  companion.hotkeyRecording(true);
  render();
}

function cancelRecorder() {
  if (!recorder) return;
  recorder = null;
  companion.hotkeyRecording(false);
  render();
  qEl.focus();
}

async function saveRecorder() {
  if (!recorder?.pending) return;
  const res = await companion.setHotkey(recorder.pending);
  if (!res.ok) {
    recorder.error = tr(res.error, res.vars);
    recorder.pending = null;
    companion.hotkeyRecording(true); // the failed attempt put the old shortcut back; keep it off while recording
    refreshRecorder();
    return;
  }
  $('hotkey').textContent = $('hotkey2').textContent = res.hotkey;
  recorder = null;
  if (settingsOpen) settings = await companion.getSettings(); // back to the settings, showing the new key
  render();
  qEl.focus();
}

function recorderKey(ev) {
  if (ev.key === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) return cancelRecorder();
  if (ev.key === 'Enter' && recorder.pending && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) return saveRecorder();
  const res = CompanionHotkey.fromEvent(ev);
  recorder.partial = res.partial || null;
  if (res.accelerator) {
    recorder.pending = res.accelerator;
    recorder.error = '';
  } else if (res.error) {
    recorder.pending = null;
    recorder.error = tr(res.error, res.vars);
  }
  refreshRecorder();
}

// ---------- State → screen ----------
function render() {
  const q = qEl.value.trim();
  filterEl.textContent = type === 'all' ? '' : tr('Filter · {name}', { name: tr(TYPES.find(([t]) => t === type)[1]) });
  if (recorder) {
    listKey = '';
    contentEl.replaceChildren(renderRecorder());
  } else if (settingsOpen) {
    listKey = '';
    contentEl.replaceChildren(renderSettings());
  } else if (feedback?.open) {
    listKey = '';
    contentEl.replaceChildren(renderFeedback());
  } else if (notice) {
    listKey = '';
    contentEl.replaceChildren(renderNotice());
  } else if (!q) {
    listKey = '';
    detail = null;
    contentEl.replaceChildren();
  } else if (detail) {
    listKey = '';
    contentEl.replaceChildren(renderDetail(detail));
  } else if (results.length) {
    // Same result set as on screen: keep the rows (and their finished animation), just move the highlight.
    const key = `${type}|${results.map((e) => e.id).join()}`;
    if (key !== listKey) contentEl.replaceChildren(renderList());
    else setIdx(idx, false);
    listKey = key;
  } else {
    listKey = '';
    contentEl.replaceChildren(
      h('div', { class: 'empty' }, h('span', { class: 'empty-tag in' }, tr('No signal')), h('span', { class: 'empty-text in', delay: 60 }, tr('Nothing matches “{q}”', { q }))),
    );
  }
  scrollEl.scrollTop = 0;
  widthPending = true;
  fit();
  remeasureSoon();
}

// Measured the instant it is drawn, text can still be settling (the reveal animation, the fonts):
// the width is measured once more after that, for whatever is on screen then.
let remeasureTimer;
function remeasureSoon() {
  clearTimeout(remeasureTimer);
  remeasureTimer = setTimeout(() => {
    widthPending = true;
    fit();
  }, 600);
}

// The panel's height animates in CSS; the window follows: it grows at once (the extra space is
// transparent) and shrinks only after the panel has finished closing.
let shrinkTimer;
let windowH = 0;
let widthPending = false; // new content on screen: measure the width it wants once
// Width the panel's tables need to keep every row on one line, in window px (0 = no tables).
// Each table is measured at its natural width, plus its offset from the left and the room to its right.
function tablesWidth() {
  let need = 0;
  for (const t of contentEl.querySelectorAll('table')) {
    const box = t.getBoundingClientRect();
    const rightGap = window.innerWidth - box.right;
    t.style.width = 'max-content';
    need = Math.max(need, box.left + t.offsetWidth + rightGap);
    t.style.width = '';
  }
  return need;
}

// Ask once, when new content appears, for the width that keeps table rows on one line; main caps it
// at half the screen and never goes below the player's chosen width. Narrower than that, cells wrap.
// Window resizes never measure again: measuring on resize fed back into itself (the window kept
// growing and shrinking).
function fitWidth() {
  const need = tablesWidth();
  companion.fitWidth(Math.ceil((need ? need + 8 : 0) * zoom));
}

window.addEventListener('resize', () => {
  if (!document.body.classList.contains('docked')) requestAnimationFrame(fit);
});

function fit() {
  // Docked, the window is the icon; folding, it is about to become the icon. Neither is laid out.
  if (document.body.classList.contains('docked') || document.body.classList.contains('folding')) return;
  if (widthPending && !gripping) {
    widthPending = false;
    fitWidth();
  }
  const open = contentEl.childElementCount > 0;
  // Everything except the panel: body padding, brand line, bar, key hints.
  const pad = parseFloat(getComputedStyle(document.body).paddingTop) + parseFloat(getComputedStyle(document.body).paddingBottom);
  const chrome = pad + document.querySelector('.brand').offsetHeight + document.querySelector('.bar').offsetHeight + document.querySelector('.hints').offsetHeight;
  // Content that must show whole (the notice, the suggestions form: their buttons are at the bottom) may exceed the max height.
  const whole = notice || settingsOpen || !!feedback?.open;
  const limit = whole ? screen.availHeight - 40 : maxHeight / zoom;
  const roomForPanel = limit - chrome - PANEL_GAP;
  const panelH = open ? Math.max(0, Math.min(contentEl.offsetHeight + 2, roomForPanel)) : 0;
  panelEl.classList.toggle('open', open);
  panelEl.style.height = `${panelH}px`;
  const target = Math.ceil((chrome + (open ? PANEL_GAP + panelH : 0)) * zoom);
  clearTimeout(shrinkTimer);
  // While the grip is dragged the panel tracks it live, so the window shrinks at once too.
  if (target >= windowH || gripping) {
    windowH = target;
    companion.fit(target, whole);
  } else {
    shrinkTimer = setTimeout(() => { windowH = target; companion.fit(target, whole); }, SHRINK_DELAY);
  }
}

function search() {
  results = CompanionSearch.search(index, qEl.value, { type, collapseVariants: true });
  idx = 0;
  detail = null;
  render();
}

function setIdx(i, scroll = true) {
  if (!results.length) return;
  idx = Math.max(0, Math.min(results.length - 1, i));
  const rows = contentEl.querySelectorAll('.row');
  rows.forEach((r, j) => r.classList.toggle('active', j === idx));
  if (scroll) rows[idx]?.scrollIntoView({ block: 'nearest' });
}

function open(i) {
  if (!results[i]) return;
  idx = i;
  detail = results[i];
  render();
}

function back() {
  detail = null;
  render();
  setIdx(idx);
  qEl.focus();
}

// Cross-links inside a detail jump straight to the named entry.
function goTo(query, t) {
  settingsOpen = false;
  qEl.value = query;
  type = t;
  results = CompanionSearch.search(index, query, { type });
  const exact = results.findIndex((e) => CompanionSearch.norm(e.n) === CompanionSearch.norm(query));
  idx = Math.max(0, exact);
  detail = results[idx] || null;
  render();
  qEl.focus();
}

// ---------- Input ----------
let timer;
qEl.addEventListener('input', () => {
  // Typing a search means the notice has been seen (it stays on for the next launch unless ticked off).
  if (notice) {
    notice = false;
    companion.noticeDone(false);
  }
  settingsOpen = false; // typing a search leaves the settings
  clearTimeout(timer);
  timer = setTimeout(search, 60);
});
document.addEventListener('keyup', (ev) => {
  // Letting go of modifiers without a key clears the "Ctrl+…" preview.
  if (recorder && !recorder.pending && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
    recorder.partial = null;
    refreshRecorder();
  }
});
document.addEventListener('keydown', (ev) => {
  if (recorder) {
    ev.preventDefault();
    return recorderKey(ev);
  }
  // The shortcut key is not typed into the overlay: it closes it (the key listener does the toggling).
  const pressed = CompanionHotkey.fromEvent(ev).accelerator;
  if (pressed && pressed.toLowerCase() === $('hotkey').textContent.trim().toLowerCase()) {
    ev.preventDefault();
    return;
  }
  if (settingsOpen) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeSettings(); }
    return;
  }
  // The form owns the keyboard: only Esc (cancel) and Ctrl+Enter (send) are taken; the rest types.
  if (feedback?.open) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeFeedback(); }
    else if (ev.key === 'Enter' && ev.ctrlKey && feedback.status !== 'sent') { ev.preventDefault(); submitFeedback(); }
    else if (ev.key === 'Enter' && feedback.status === 'sent') { ev.preventDefault(); closeFeedback(); }
    return;
  }
  // A quality slider keeps its arrow keys and Home/End.
  if (ev.target?.type === 'range' && /^(Arrow|Home$|End$|Page)/.test(ev.key)) return;
  if (ev.ctrlKey && (ev.key === '=' || ev.key === '+')) companion.zoom(1);
  else if (ev.ctrlKey && ev.key === '-') companion.zoom(-1);
  else if (ev.ctrlKey && ev.key === '0') companion.zoom(0);
  else if (notice && (ev.key === 'Enter' || ev.key === 'Escape')) dismissNotice();
  else if (ev.key === 'Escape') {
    // Detail → list → empty bar → hidden.
    if (detail) back();
    else if (qEl.value) { qEl.value = ''; type = 'all'; search(); }
    else companion.hide();
  } else if (ev.key === 'Enter') {
    if (!detail) open(idx);
  } else if (ev.key === 'ArrowDown' && !detail) setIdx(idx + 1);
  else if (ev.key === 'ArrowUp' && !detail) setIdx(idx - 1);
  else if (ev.key === 'PageDown') scrollEl.scrollBy(0, scrollEl.clientHeight * 0.8);
  else if (ev.key === 'PageUp') scrollEl.scrollBy(0, -scrollEl.clientHeight * 0.8);
  else if (ev.key === 'Tab') {
    const i = TYPES.findIndex(([t]) => t === type);
    type = TYPES[(i + (ev.shiftKey ? TYPES.length - 1 : 1)) % TYPES.length][0];
    search();
  } else return;
  ev.preventDefault();
});
companion.onFeedback(openFeedback);
companion.onSettings(openSettings);
$('settings-btn').addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
$('suggest').addEventListener('click', (ev) => {
  ev.preventDefault();
  openFeedback();
});
$('coffee').addEventListener('click', (ev) => {
  ev.preventDefault();
  companion.openLink(COFFEE_URL);
});
$('clear').addEventListener('click', () => {
  if (qEl.value) { qEl.value = ''; type = 'all'; search(); qEl.focus(); } else companion.hide();
});
// ---------- Icon ⇄ bar ----------
const body = document.body;
const wrapEl = $('wrap');

// Tell the main process where the bar sits in the open window (window px), so it can place the
// window with the bar's end on the icon. Measured with the layout briefly shown if docked.
function sendGeometry() {
  const docked = body.classList.contains('docked');
  if (docked) body.classList.remove('docked');
  const bar = document.querySelector('.bar').getBoundingClientRect();
  const input = qEl.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(body).paddingLeft);
  if (docked) body.classList.add('docked');
  // inputX/inputY: a point inside the search box, where the automatic click lands.
  companion.geometry({ inset: inset * zoom, barTop: bar.top * zoom, barHeight: bar.height * zoom, inputX: (input.left + Math.min(40, input.width / 2)) * zoom, inputY: (input.top + input.height / 2) * zoom });
}

function applyLayoutVars(dockOpacity) {
  body.style.setProperty('--zoom', zoom);
  if (dockOpacity != null) body.style.setProperty('--dock-opacity', dockOpacity);
}

// The clip that starts (or ends) the bar as just the icon's square, relative to .wrap.
function setIconClip({ iconX, iconY, iconSize }) {
  body.style.setProperty('--ix', `${iconX}px`);
  body.style.setProperty('--iy', `${iconY}px`);
  body.style.setProperty('--is', `${iconSize}px`);
  const w = wrapEl.getBoundingClientRect();
  const left = iconX - w.left;
  const top = iconY - w.top;
  body.style.setProperty('--cl', `${left}px`);
  body.style.setProperty('--ct', `${top}px`);
  body.style.setProperty('--cr', `${w.width - left - iconSize}px`);
  body.style.setProperty('--cb', `${w.height - top - iconSize}px`);
}

let lastIcon = null;
function remeasureWhenSized(tries = 0) {
  if (window.innerWidth * zoom < 200 && tries < 30) return requestAnimationFrame(() => remeasureWhenSized(tries + 1));
  widthPending = true;
  fit();
  remeasureSoon(); // and again once the unfold has finished
}

companion.onOpen((info) => {
  lastIcon = info;
  body.classList.remove('docked', 'folding');
  body.classList.toggle('side-right', info.side === 'right');
  windowH = 0; // the window was the icon; let the first fit size it
  fit();
  // The window reopens at the player's chosen width, so whatever is on screen is laid out again:
  // the width its tables need is measured anew, then the height. Only once the window really has
  // the bar's size: right after "open" it can still be the icon's 64 px square.
  remeasureWhenSized();
  setIconClip(info);
  body.classList.remove('unfolding');
  void body.offsetWidth; // restart the animation
  body.classList.add('unfolding');
  // The unfold takes 0.62 s; if it never reports its end (animations switched off in Windows, a
  // window that was hidden), "unfolding" still ends, so the icon's copy never stays over the bar.
  clearTimeout(unfoldTimer);
  unfoldTimer = setTimeout(() => body.classList.remove('unfolding'), 800);
  qEl.focus();
  qEl.select();
});
let unfoldTimer;
wrapEl.addEventListener('animationend', (ev) => {
  if (ev.target !== wrapEl) return;
  if (ev.animationName === 'unfold') body.classList.remove('unfolding');
  if (ev.animationName === 'fold') companion.closed();
});

// The automatic click that follows a shortcut open: whatever it lands on (the bar may still be
// unfolding), it only puts the caret in the search box.
let autoClickUntil = 0;
companion.onAutoClick(() => { autoClickUntil = Date.now() + 600; });
document.addEventListener('mousedown', (ev) => {
  if (Date.now() > autoClickUntil) return;
  autoClickUntil = 0;
  ev.preventDefault();
  ev.stopPropagation();
  qEl.focus();
}, true);
window.addEventListener('focus', () => {
  if (!body.classList.contains('docked') && !settingsOpen && !feedback?.open && !recorder && document.activeElement === document.body) qEl.focus();
});

companion.onClose(() => {
  if (recorder) cancelRecorder(); // never leave the global shortcut switched off
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !lastIcon) return companion.closed();
  clearTimeout(shrinkTimer);
  setIconClip(lastIcon);
  body.classList.remove('unfolding');
  body.classList.add('folding');
});

companion.onNotice(showNotice);
companion.onGameVersion(({ live }) => renderPu(live));
companion.onHotkeyRecorder(startRecorder);
// The hotkey shown in the bar opens the recorder too.
$('hotkey').addEventListener('click', () => startRecorder());

companion.onDocked(({ opacity }) => {
  body.classList.remove('unfolding', 'folding');
  body.classList.add('docked');
  applyLayoutVars(opacity);
});

// The icon: the main process decides click (open) or drag (move) from the real cursor.
const dockEl = $('dock');
dockEl.addEventListener('pointerdown', (ev) => {
  dockEl.setPointerCapture(ev.pointerId);
  companion.dockPointer('down');
  ev.preventDefault();
});
dockEl.addEventListener('pointerup', () => companion.dockPointer('up'));
dockEl.addEventListener('lostpointercapture', () => companion.dockPointer('up'));

// Resize grip: the main process follows the cursor while it is held; we only refit as the limits change.
const gripEl = $('grip');
gripEl.addEventListener('pointerdown', (ev) => {
  gripping = true;
  gripEl.classList.add('dragging');
  gripEl.setPointerCapture(ev.pointerId);
  companion.grip('start');
  ev.preventDefault();
});
const releaseGrip = () => {
  if (!gripping) return;
  gripping = false;
  gripEl.classList.remove('dragging');
  companion.grip('end');
};
gripEl.addEventListener('pointerup', releaseGrip);
gripEl.addEventListener('pointercancel', releaseGrip);
gripEl.addEventListener('lostpointercapture', releaseGrip);
companion.onLayout((layout) => {
  maxHeight = layout.maxHeight;
  if (layout.zoom !== zoom) widthPending = true; // new text size: the tables need a new width
  zoom = layout.zoom;
  body.classList.toggle('side-right', layout.side === 'right');
  applyLayoutVars(layout.dockOpacity);
  sendGeometry();
  fit();
});
companion.onDbUpdated(({ ok }) => {
  $('dbinfo').textContent = ok ? 'Database updated — reloading…' : 'Some sources failed to update; previous data kept.';
  load();
});

async function load() {
  const [raw, cfg] = await Promise.all([companion.loadDb(), companion.config()]);
  CompanionI18n.setLanguage(cfg.language);
  translateStatic();
  maxHeight = cfg.maxHeight;
  zoom = cfg.zoom || 1;
  applyLayoutVars(cfg.dockOpacity);
  sendGeometry();
  $('hotkey').textContent = $('hotkey2').textContent = cfg.hotkey;
  const db = JSON.parse(raw);
  index = CompanionSearch.buildIndex(db.entries);
  dbEntries = db.entries;
  applyLiveCommodities(await companion.commoditiesLive());
  itemByName = new Map(db.entries.filter((x) => x.t === 'item').map((x) => [x.n, x]));
  // The pinned signature lists: every mineral with its kind, signature and 1×–10× values.
  companion.pinRows(db.entries.filter((x) => x.t === 'mineral').map((x) => ({ n: x.n, tier: x.d.tier, category: x.d.category, sig: x.d.signature || 0, rs: x.d.rs })));
  const total = Object.values(db.meta.counts).reduce((a, b) => a + b, 0);
  const sources = Object.entries(db.meta.sources).filter(([, s]) => s);
  const oldest = sources.map(([, s]) => s.fetchedAt.slice(0, 10)).sort()[0];
  $('dbinfo').textContent = tr('{records} records · data {date}', { records: fmt(total), date: oldest });
  dataDate = oldest;
  gameVersion = db.meta.gameVersion || null;
  renderPu(cfg.liveGameVersion);
  $('dbinfo').title = sources.map(([k, s]) => `${k}: ${s.fetchedAt.slice(0, 10)}`).join('\n');
  search();
  qEl.focus();
}

fit();
load()
  .catch((err) => { $('dbinfo').textContent = `Could not load the database: ${err.message}`; })
  .finally(() => companion.ready());
