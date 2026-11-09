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
let notice = false; // the checklist (once "Before you start") is in the panel
let noticePage = 'checklist'; // 'thanks' first when the thank-you page is due
let recorder = null; // { current, pending, partial, error } while the shortcut recorder is in the panel
let dataDate = '';
let gameVersion = null; // the PU version the database was built for
let dataBuiltAt = null; // when that database was built (ISO), sent with a bug report

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
    else if (k === 'style') el.style.cssText = v; // the same: a style attribute would be blocked by the CSP
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
    // A cell given as { span, content } takes that many columns (the cells after it are left out).
    h('tbody', null, rows.map((cells) => {
      let col = 0;
      return h('tr', null, cells.map((c) => {
        const spans = c && typeof c === 'object' && !(c instanceof Node) && 'span' in c;
        const td = h('td', { class: headers[col][1], colspan: spans ? c.span : null }, spans ? c.content : c);
        col += spans ? c.span : 1;
        return td;
      }));
    })),
  );
}

function links(pairs) {
  const present = pairs.filter(([, url]) => url);
  return present.length ? h('div', { class: 'links' }, present.map(([label, url]) => link(`${tr(label)} ↗`, url))) : null;
}

// Where to buy or rent, in alphabetical order of the place (cheapest first when two read the same).
// The sources (cstone, UEX, the wiki) often list the same shop, spelled a little differently
// ("Area 18 - Astro Armada" / "Area18 - Retail bridges - Astro Armada", "New Deal Lorville" /
// "Teasa Spaceport - New Deal"). Same city, almost the same price, and one shop name inside the other (spaces
// ignored): one shop, shown once, with the most recent price.
const flat = (s) => CompanionSearch.norm(s).replace(/ /g, '');
function shopParts(s) {
  const parts = String(s.where || '').split(' - ');
  // system, body and city must all agree: the same shop name at another station is another shop
  // (a station at a Lagrange point has no city: the point is the place)
  const at = /-Ld/i.test(parts[1] || '') ? 2 : 3;
  const last = parts[parts.length - 1];
  return { city: flat(parts.slice(0, at).join(' ')), shop: flat(last), brand: flat(CompanionSearch.norm(last).split(' ')[0]) };
}
const sameShop = (a, z) => {
  // the sources round and update prices at different times: within 1 % is the same price
  if (Math.abs((a.price || 0) - (z.price || 0)) > 0.01 * Math.max(a.price || 0, z.price || 0)) return false;
  const x = shopParts(a);
  const y = shopParts(z);
  return x.city === y.city && x.shop && y.shop && (x.shop.includes(y.shop) || y.shop.includes(x.shop) || (x.brand.length >= 4 && x.brand === y.brand));
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
// Wikelo's recipe for a ship: what to bring to his emporium and what comes back, one block per contract.
function wikeloSection(d) {
  const line = (o) => `${o.qty}${o.unit === 'SCU' ? ' SCU' : '×'} ${o.name}`;
  return section('Wikelo exchange', d.wikelo.map((c) => h('div', { class: 'wikelo' },
    h('div', { class: 'wikelo-head' }, h('span', { class: 'wikelo-name' }, c.name), c.reputation && h('span', { class: 'wikelo-rep' }, tr(c.reputation))),
    table([['Bring', ''], ['Qty', 'num']], c.orders.map((o) => [o.name, `${fmt(o.qty)}${o.unit === 'SCU' ? ' SCU' : ''}`])),
    h('p', { class: 'note' }, `${tr('You get')}: ${c.rewards.map(line).join(', ')}`),
  )));
}
function shopsTable(shops) {
  const sorted = dedupeShops(shops).sort((a, z) => alpha((s) => s.where)(a, z) || (a.price || Infinity) - (z.price || Infinity));
  const sells = sorted.some((s) => s.sell);
  return table(
    [['Where', ''], ['Price', 'num'], ...(sells ? [['Sells for', 'num']] : [])],
    sorted.map((s) => [s.where, auec(s.price), ...(sells ? [s.sell ? auec(s.sell) : ''] : [])]),
    sells ? undefined : 't-price',
  );
}

// ---------- Detail views: { facts: [[label, value]], body: [nodes] } ----------
// "LaserCannon" → "Laser Cannon", "weaponMountUsable" → "Weapon Mount Usable".
const camelWords = (v) => String(v).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function viewItem(e) {
  const d = e.d;
  // The item's own Type, Size, Grade and Class lead the facts; the source's attribute list (cstone) repeats
  // them: the same value is dropped, and a different Type is the weapon's subtype (Laser Cannon, Magazine,
  // Active…) or, for a missile, what it tracks (Infrared, Electromagnetic, Cross Section), so it is named so.
  const own = { Type: d.type, Size: d.size, Grade: d.grade, Class: d.class };
  const attrs = Object.entries(d.attrs || {})
    .filter(([k]) => k !== 'MANUFACTURER')
    .map(([k, v]) => [k.charAt(0) + k.slice(1).toLowerCase(), v])
    .flatMap(([label, v]) => {
      const mine = own[label];
      if (mine == null || mine === '') return [[label, v]];
      if (String(mine) === String(v)) return [];
      if (label === 'Size' || String(v) === String(d.manufacturer)) return []; // a second size, or the maker again (gadgets)
      return label === 'Type' ? [[/^Missile/.test(d.type || '') ? 'Tracking signal' : 'Subtype', camelWords(v)]] : [[label, v]];
    });
  const cheapest = d.shops?.filter((s) => s.price > 0).sort((a, z) => a.price - z.price)[0];
  const m = d.market;
  const uexUrl = d.uexId && `https://uexcorp.space/marketplace/?id_item=${d.uexId}`;
  const w = d.weapon;
  const topDps = w && Math.max(0, ...w.modes.map((x) => x.dps || 0));
  // A ship weapon's damage, rate and range all come from the wiki's figures, which nearly all of them have: cstone
  // has them for some, and differs on a few, so two weapons side by side are always measured the same way.
  const shipFigures = w && kindKey(e) === 'ship-weapon';
  const shipRate = shipFigures && w.modes.length ? w.modes.map((x) => (x.rpm ? `${fmt(x.rpm)} rpm` : tr('continuous'))).join(' / ') : null;
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
      ...(shipFigures
        ? [
            ['Subtype', w.type || attrs.find(([label]) => label === 'Subtype')?.[1]],
            ['Fire rate', shipRate],
            ['Weapon range', w.range ? `${fmt(w.range)} m` : null],
            ...attrs.filter(([label]) => !['Alpha', 'Base dps', 'Firerate', 'Firerange', 'Subtype'].includes(label)),
          ]
        : attrs),
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

// ---------- Ship specifications ----------
// Grouped in small cards (size and mass, flight, quantum and fuel, defence, signatures, crew and storage,
// insurance), each with only the values the wiki has for that ship: a ground vehicle has no quantum drive.
const metres = (v) => `${fmt(v)} m`;
const kg = (v) => `${fmt(v)} kg`;
const secs = (v) => (v >= 120 ? `${Math.floor(v / 60)} min ${Math.round(v % 60)} s` : `${fmt(v)} s`);
const mins = (v) => (v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${fmt(v)} min`);
const per = (v, unit) => `${fmt(v)} ${unit}`;
const withBoost = (v, boost, unit) => `${fmt(v)} ${unit}${boost ? ` (${fmt(boost)} ${tr('boosted')})` : ''}`;
const minus = (v) => (v == null ? null : v === 0 ? '0%' : `−${v}%`);

function shipSpecCards(sp) {
  if (!sp) return [];
  const card = (title, rows) => {
    const shown = rows.filter(([, v]) => v != null && v !== false && v !== '');
    return shown.length ? h('div', { class: 'spec-card' }, h('div', { class: 'spec-title' }, tr(title)), shown.map(([label, value]) => h('div', { class: 'spec-row' }, h('span', { class: 'spec-label' }, tr(label)), h('span', { class: 'spec-value' }, value)))) : null;
  };
  const s = sp.speed || {};
  const t = sp.turn || {};
  const q = sp.quantum || {};
  const a = sp.armor || {};
  const sh = sp.shield || {};
  const sg = sp.signature || {};
  const c = sp.crew || {};
  const st = sp.seats || {};
  const ins = sp.insurance || {};
  const dm = sp.dims || {};
  const ms = sp.mass || {};
  const cards = [
    card('Size and mass', [['Length', dm.length && metres(dm.length)], ['Beam', dm.beam && metres(dm.beam)], ['Height', dm.height && metres(dm.height)], ['Hull mass', ms.hull && kg(ms.hull)], ['Loadout mass', ms.loadout && kg(ms.loadout)], ['Total mass', ms.total && kg(ms.total)]]),
    card('Flight', [
      ['SCM speed', s.scm && per(s.scm, 'm/s')], ['Max speed', s.max && per(s.max, 'm/s')],
      ['Boost forward', s.boostFwd && per(s.boostFwd, 'm/s')], ['Boost backward', s.boostBack && per(s.boostBack, 'm/s')],
      ['0 to SCM', s.toScm && secs(s.toScm)], ['0 to max', s.toMax && secs(s.toMax)], ['SCM to 0', s.stopScm && secs(s.stopScm)], ['Max to 0', s.stopMax && secs(s.stopMax)],
      ['Pitch', t.pitch && withBoost(t.pitch, t.pitchBoost, '°/s')], ['Yaw', t.yaw && withBoost(t.yaw, t.yawBoost, '°/s')], ['Roll', t.roll && withBoost(t.roll, t.rollBoost, '°/s')],
    ]),
    card('Quantum and fuel', [
      ['Quantum speed', q.speed && `${(q.speed / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} Mm/s`], ['Quantum range', q.range && `${(q.range / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })} Gm`], ['Spool time', q.spool && secs(q.spool)],
      ['Quantum fuel', sp.fuel?.quantum && fmt(sp.fuel.quantum)], ['Hydrogen fuel', sp.fuel?.hydrogen && fmt(sp.fuel.hydrogen)],
      ['Port Olisar to ArcCorp', q.trip?.time && secs(q.trip.time)],
    ]),
    card('Defence', [
      ['Armour hull', a.health && fmt(a.health)], ['Physical', minus(a.physical)], ['Energy', minus(a.energy)], ['Distortion', minus(a.distortion)], ['Thermal', minus(a.thermal)],
      ['Shield', sh.hp && fmt(sh.hp)], ['Shield regen', sh.regen && `${fmt(sh.regen)} /s`], ['Regen time', sh.regenTime && secs(sh.regenTime)], ['Shield faces', sh.face],
    ]),
    card('Signatures', [['Infrared', sg.ir && fmt(sg.ir)], ['EM idle', sg.emIdle && fmt(sg.emIdle)], ['EM maximum', sg.emMax && fmt(sg.emMax)], ['Cross section', sg.cross && fmt(sg.cross)]]),
    card('Crew and storage', [
      ['Crew', c.max && (c.min === c.max ? String(c.max) : `${c.min}–${c.max}`)], ['Gunners', c.weapon], ['Operators', c.operation],
      ['Ejection seats', st.ejection], ['Escape pods', st.pods], ['Jump seats', st.jump], ['Beds', st.beds], ['Medical beds', st.medBeds], ['Medical tier', sp.medTier],
      ['Personal storage', sp.storage && `${fmt(sp.storage)} SCU`], ['Ore capacity', sp.ore && `${fmt(sp.ore)} SCU`],
    ]),
    card('Insurance', [['Claim time', ins.claim && mins(ins.claim)], ['Expedited claim', ins.expedite && mins(ins.expedite)], ['Expedite fee', ins.fee && `${fmt(ins.fee)} aUEC`]]),
  ].filter(Boolean);
  return cards.length ? [section('Specifications', h('div', { class: 'spec-grid' }, cards)), sp.loaner?.length > 0 && note(`${tr('Loaner ships')}: ${sp.loaner.join(', ')}`)] : [];
}

// The modules a modular ship takes (Retaliator, Apollo, Aurora Mk II…): items of the Module kind named after it,
// each sold and fitted on its own. Matched on the ship's short name, or its first word for a family of ships
// that share modules ("Apollo Tier 1 Module Left" for the Apollo Medivac and Triage).
function shipModules(e) {
  const short = CompanionSearch.norm(e.d.shortName || e.n);
  const family = short.split(' ')[0];
  if (!family) return [];
  // A module that starts with another ship's longer short name is that ship's (Aurora Mk II's, not Mk I's).
  const others = dbEntries.filter((x) => x.t === 'ship' && x !== e).map((x) => CompanionSearch.norm(x.d.shortName || x.n)).filter((n) => n !== short && n.startsWith(`${family} `));
  return dbEntries.filter((x) => {
    if (x.t !== 'item' || !(/^Module\b/.test(x.d.type || '') || x.d.category === 'MODULE')) return false;
    const n = CompanionSearch.norm(x.n);
    return n.startsWith(`${short} `) || (n.startsWith(`${family} `) && !others.some((o) => n.startsWith(`${o} `)));
  });
}
function modulesSection(e) {
  const mods = sortedBy(shipModules(e), (m) => m.n);
  if (!mods.length) return null;
  const cheapest = (m) => (m.d.shops || []).filter((s) => s.price > 0).sort((a, z) => a.price - z.price)[0];
  return section('Modules',
    note('Sold separately and fitted to the ship; it flies with one in each place.'),
    table([['Module', ''], ['Lowest price', 'num'], ['Where', 'dim']], mods.map((m) => {
      const c = cheapest(m);
      const stock = !c && /\bUnladen\b/i.test(m.n); // the empty module the ship is sold with
      return [jump(m.n, m.n, 'item'), c ? auec(c.price) : stock ? '—' : tr('Not sold'), c ? c.where : stock ? tr('Comes with the ship') : ''];
    })));
}

function viewShip(e) {
  const d = e.d;
  const lo = shipLoadout(e);
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
      // Right after the overview: what the fitted components add up to, then the components, each one changeable.
      lo.stats,
      lo.components,
      modulesSection(e),
      ...shipSpecCards(d.specs),
      section(
        'Price in USD (RSI store)',
        !price
          ? note('No USD price (not sold in the RSI store).')
          : price.msrp
            ? h('p', { class: 'note' }, usd(price.usd), ' ', tr('MSRP — not listed in the store right now.'))
            : [
                table(
                  // The same columns as "Buy in game" below (place · price), so they line up; the
                  // listing's status sits beside its name.
                  [['Standalone ship', ''], ['USD', 'num']],
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
                  ]),
                  't-price',
                ),
                (price.warbond || warbondNow) && note('Warbond: a discounted offer that must be paid with new money (not store credit).'),
              ],
      ),
      section('Buy in game (aUEC)', d.buy?.length ? shopsTable(d.buy) : note('Not sold in any in-game shop.')),
      d.rent?.length > 0 && section('Rent in game', shopsTable(d.rent)),
      d.wikelo?.length > 0 && wikeloSection(d),
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
const CONTROLS = { pilot: 'Pilot', 'remote-pilot': 'Pilot / Gunner', manned: 'Crew turret', remote: 'Remote turret' };
// The tag's tooltip, for the short "Pilot / Gunner".
const CONTROL_HINTS = { 'remote-pilot': 'Remote turret: the pilot fires it while no gunner sits at it' };
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

// ---------- Components and loadout stats: change a ship's components in its own list, as erkul.games does ----------
// The components list keeps its look: each changeable component (guns, shields, power plants, coolers, quantum
// drive, radar, life support) is a link like the others, with a ▾ beside it that opens a menu of the components of
// the same kind and size; once one is picked, or the menu is left, it is a link again. The stats sit above, beside the
// stock figures. Up to three loadouts per ship can be saved under a name, on this PC.
let allComps = null;
let allCompsFrom = null;
function componentList() {
  if (allCompsFrom !== dbEntries) {
    allCompsFrom = dbEntries;
    allComps = dbEntries.filter((x) => x.t === 'item' && x.d.comp).map((x) => ({ name: x.n, ...x.d.comp }));
  }
  return allComps;
}
const CALC_FIGURES = [
  // [key, label, format, which way is better: 1 more, -1 less]
  ['alpha', 'Alpha damage', (v) => fmt(Math.round(v)), 1],
  ['burst', 'Burst DPS', (v) => fmt(Math.round(v)), 1],
  ['sustained', 'Sustained DPS (60 s)', (v) => fmt(Math.round(v)), 1],
  ['shieldHp', 'Shield HP', (v) => fmt(Math.round(v)), 1],
  ['shieldRegen', 'Shield regen', (v) => `${fmt(Math.round(v))} HP/s`, 1],
  ['em', 'EM signature', (v) => fmt(Math.round(v)), -1],
  ['ir', 'IR signature', (v) => fmt(Math.round(v)), -1],
  ['quantumSpeed', 'Quantum speed', (v) => `${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} Mm/s`, 1],
];
// Saved loadouts: { "<ship>": [{ name, picks: { "<row key>": "<component>" } }, …] } in this PC's storage, three
// per ship at most. The first version kept them as { "1": picks, … }: read as "Loadout 1"….
const LOADOUTS_KEY = 'ship-loadouts';
const LOADOUTS_MAX = 3;
function readLoadouts() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LOADOUTS_KEY)) || {}; } catch { /* none */ }
  for (const [ship, v] of Object.entries(all)) {
    if (!Array.isArray(v)) all[ship] = Object.entries(v).map(([n, picks]) => ({ name: `Loadout ${n}`, picks }));
  }
  return all;
}
const writeLoadouts = (all) => { try { localStorage.setItem(LOADOUTS_KEY, JSON.stringify(all)); } catch { /* kept for this visit only */ } };
const rowKey = (l) => `${l.type}|${l.item}|${l.mount || ''}|${l.control || ''}`;
// A component's class as a tag after its name in the menu: Blizzard [M]. Guns have none.
const CLASS_TAGS = { Military: 'M', Civilian: 'C', Industrial: 'I', Stealth: 'S', Competition: 'CO' };
const withClass = (c) => (CLASS_TAGS[c.class] ? `${c.name} [${CLASS_TAGS[c.class]}]` : c.name);
// The menu, as calculators show it: grouped by type (a gun's kind, Laser Repeater…; any other component's class,
// Military…), the group with the strongest component first, and inside a group grade A to D, then the strongest.
// "Strongest" is the figure that kind is chosen for; a radar has none, so its groups go by name.
const MENU_FIGURE = {
  WeaponGun: (c) => c.weapon?.burst,
  Shield: (c) => c.shield?.hp,
  PowerPlant: (c) => c.genPower,
  Cooler: (c) => c.genCoolant,
  QuantumDrive: (c) => c.quantum?.speed,
};
const GRADES = ['A', 'B', 'C', 'D'];
function menuGroups(slot, options) {
  const figure = MENU_FIGURE[slot] || (() => 0);
  const groupOf = (c) => (slot === 'WeaponGun' ? c.weapon?.type || 'Other' : c.class || 'Other');
  const grade = (c) => { const i = GRADES.indexOf(c.grade); return i < 0 ? GRADES.length : i; };
  const groups = new Map();
  for (const c of options) {
    const g = groupOf(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const best = (list) => Math.max(0, ...list.map((c) => figure(c) || 0));
  return [...groups]
    .map(([name, list]) => ({ name, list: list.sort((a, z) => grade(a) - grade(z) || (figure(z) || 0) - (figure(a) || 0) || a.name.localeCompare(z.name)) }))
    .sort((a, z) => best(z.list) - best(a.list) || a.name.localeCompare(z.name));
}
// What each ship's page has picked this session: kept when the page is left for a component's and Esc comes back.
const shipPicks = new Map(); // ship name → { picks: Map(row key → component), active: loadout name | null }

// Returns { stats, components }: the stats section and the components section of a ship's page.
function shipLoadout(e) {
  const loadout = (e.d.loadout || []).filter((l) => !LOADOUT_HIDDEN.has(l.type));
  if (!loadout.length) return { stats: null, components: null };
  const comps = componentList();
  const byName = new Map(comps.map((c) => [c.name, c]));
  const calc = (l) => CompanionLoadout.SLOTS.includes(l.type) && comps.length > 0;
  if (!shipPicks.has(e.n)) shipPicks.set(e.n, { picks: new Map(), active: null });
  const state = shipPicks.get(e.n);
  const picks = state.picks;
  const pickOf = (l) => picks.get(rowKey(l)) || l.item;
  const parts = () => loadout.filter(calc).map((l) => ({ slot: l.type, control: l.control, name: pickOf(l), comp: byName.get(pickOf(l)) || null }));
  const base = CompanionLoadout.totals(loadout.filter(calc).map((l) => ({ slot: l.type, control: l.control, name: l.item, comp: byName.get(l.item) || null })));

  // ----- Stats -----
  const tiles = h('div', { class: 'calc-totals' });
  const missing = h('p', { class: 'note' });
  const paintStats = () => {
    const t = CompanionLoadout.totals(parts());
    const tile = (label, value, ...more) => h('div', { class: 'calc-tile' }, h('span', { class: 'calc-label' }, tr(label)), h('span', { class: 'calc-value' }, value), ...more);
    const diff = (v, b, better, show) => {
      const d = v - b;
      if (!d || Math.abs(d) < 0.5) return null;
      return h('span', { class: `calc-delta ${d * better > 0 ? 'up' : 'down'}` }, `${d > 0 ? '+' : '−'}${show(Math.abs(d))}`);
    };
    // What the components draw, from all at their least to all at their most, against what is generated.
    const budget = (label, rawMin, rawMax, rawGen, bMin, bMax, bGen) => {
      const [min, max, gen] = [rawMin, rawMax, rawGen].map(Math.round);
      const st = CompanionLoadout.budget(min, max, gen);
      const pct = (v) => (gen ? Math.min(100, (v / gen) * 100) : 100);
      const words = { ok: tr('Headroom of {n} at full draw', { n: fmt(gen - max) }), tight: tr('Full draw is {n} over generation', { n: fmt(max - gen) }), over: tr('Least draw is already {n} over generation', { n: fmt(min - gen) }) };
      const changed = min !== Math.round(bMin) || max !== Math.round(bMax) || gen !== Math.round(bGen);
      return h('div', { class: `calc-tile calc-budget ${st}` },
        h('span', { class: 'calc-label' }, tr(label)),
        h('span', { class: 'calc-value' }, `${fmt(min)}–${fmt(max)} / ${fmt(gen)}`),
        h('span', { class: 'calc-bar' }, h('b', { style: `width: ${pct(max)}%` }), h('i', { style: `width: ${pct(min)}%` })),
        h('span', { class: 'calc-note' }, words[st]),
        changed ? h('span', { class: 'calc-was' }, tr('stock {use} / {gen}', { use: `${fmt(Math.round(bMin))}–${fmt(Math.round(bMax))}`, gen: fmt(Math.round(bGen)) })) : null);
    };
    tiles.replaceChildren(
      ...CALC_FIGURES.filter(([k]) => t[k] || base[k]).map(([k, label, show, better]) => tile(label, show(t[k] || 0), diff(t[k] || 0, base[k] || 0, better, show),
        // The ship pools two shield generators at most: said when it fits more.
        k === 'shieldHp' && t.shieldsFitted > t.shieldsActive ? h('span', { class: 'calc-note' }, tr('{n} of {m} generators active', { n: t.shieldsActive, m: t.shieldsFitted }))
          : k === 'alpha' && t.guns ? h('span', { class: 'calc-note' }, tr('{n} guns, turrets included', { n: t.guns })) : null)),
      budget('Power (segments)', t.powerMin, t.powerMax, t.powerGen, base.powerMin, base.powerMax, base.powerGen),
      budget('Cooling (segments)', t.coolMin, t.coolMax, t.coolGen, base.coolMin, base.coolMax, base.coolGen),
    );
    missing.textContent = t.missing.length ? tr('No figures for: {names}. They are left out of the totals.', { names: [...new Set(t.missing)].join(', ') }) : '';
  };

  // ----- Components list: the same table as before; a changeable component is a link with a ▾ that opens a menu -----
  const rows = groupLoadout(loadout);
  const label = (t) => tr((LOADOUT_GROUPS.find(([g]) => g === t) || [t, t])[1]);
  const refreshers = [];
  const gradeCell = (c) => (c?.grade ? h('span', { class: `grade grade-${c.grade.toLowerCase()}` }, c.grade) : '');
  const tableRows = rows.map((l, i) => {
    const extra = [l.count > 1 ? ` ×${l.count}` : '', l.mount && h('span', { class: 'dim' }, ` · ${tr('on {mount}', { mount: l.mount })}`)];
    const tail = (cells) => (!l.grade && !l.class && CONTROLS[l.control]
      ? [{ span: 2, content: h('span', { class: `control control-${l.control}`, title: CONTROL_HINTS[l.control] ? tr(CONTROL_HINTS[l.control]) : null }, tr(CONTROLS[l.control])) }]
      : cells);
    const slotCell = i === 0 || rows[i - 1].type !== l.type ? label(l.type) : '';
    const size = l.size != null ? `S${l.size}` : '';
    if (!calc(l)) return [slotCell, h('span', null, jump(l.item, l.item, 'item'), ...extra), size, ...tail([gradeCell(l), l.class ? tr(l.class) : ''])];
    const options = sortedBy(CompanionLoadout.choices(l.type, l.size, comps), (c) => c.name);
    const stockComp = byName.get(l.item);
    if (stockComp && !options.includes(stockComp)) options.unshift(stockComp);
    const link = h('span', { class: 'link comp-link' });
    link.addEventListener('click', () => goTo(pickOf(l), 'item'));
    const sel = h('select', { class: 'comp-select', hidden: 'hidden', 'aria-label': `${label(l.type)}: ${l.item}` },
      !stockComp && h('option', { value: l.item }, `${l.item} — ${tr('no figures')}`),
      // Only the components of this slot's kind and size: the header says which size, and how many fit.
      // Which size, and how many fit; then the groups.
      h('option', { disabled: 'disabled', class: 'menu-head' }, tr('Size {size} · {n} that fit', { size: l.size, n: options.length })),
      menuGroups(l.type, options).map((g) => h('optgroup', { label: tr(g.name) }, g.list.map((c) => h('option', { value: c.name }, [withClass(c), c.grade ? ` · ${c.grade}` : ''].join(''))))));
    const edit = h('button', { class: 'comp-edit', title: tr('Change this component'), 'aria-label': tr('Change this component') }, '▾');
    const grade = h('span');
    const cls = h('span');
    const show = () => {
      const pick = pickOf(l);
      const c = byName.get(pick);
      link.textContent = pick;
      link.classList.toggle('changed', pick !== l.item);
      link.title = pick !== l.item ? tr('Stock: {name}', { name: l.item }) : '';
      grade.replaceChildren(gradeCell(c || l));
      cls.textContent = (c ? c.class : l.class) ? tr(c ? c.class : l.class) : '';
    };
    // The menu shows only while it is used: picking a component, or leaving it, turns it back into the link.
    const closeMenu = () => { sel.hidden = true; link.hidden = false; edit.hidden = false; };
    edit.addEventListener('click', () => {
      sel.value = pickOf(l);
      sel.hidden = false;
      link.hidden = true;
      edit.hidden = true;
      sel.focus();
      try { sel.showPicker(); } catch { /* the menu is focused; the arrows open it */ }
    });
    sel.addEventListener('change', () => {
      if (sel.value === l.item) picks.delete(rowKey(l));
      else picks.set(rowKey(l), sel.value);
      show();
      paintStats();
      markSaved();
      closeMenu();
    });
    sel.addEventListener('blur', closeMenu);
    sel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); closeMenu(); edit.focus(); } });
    refreshers.push(show);
    show();
    return [slotCell, h('span', { class: 'comp-cell' }, link, sel, edit, ...extra), size, ...tail([grade, cls])];
  });
  const apply = (saved) => {
    picks.clear();
    for (const [k, v] of Object.entries(saved || {})) if (rows.some((l) => rowKey(l) === k)) picks.set(k, v);
    refreshers.forEach((f) => f());
    paintStats();
  };

  // ----- Saved loadouts: a button each, by its name, beside the title; Save and Stock at the right -----
  const mine = () => readLoadouts()[e.n] || [];
  const store = (list) => {
    const all = readLoadouts();
    if (list.length) all[e.n] = list;
    else delete all[e.n];
    writeLoadouts(all);
  };
  const named = h('span', { class: 'loadout-names' });
  const nameInput = h('input', { class: 'loadout-name', type: 'text', maxlength: '24', placeholder: tr('Loadout name'), hidden: 'hidden', 'aria-label': tr('Loadout name') });
  const save = h('button', { class: 'slot-act' }, tr('Save'));
  const stock = h('button', { class: 'slot-act', onclick: () => { state.active = null; apply({}); markSaved(); } }, tr('Stock'));
  const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
  function markSaved() {
    const list = mine();
    if (state.active && !list.some((x) => x.name === state.active)) state.active = null;
    named.replaceChildren(...list.map((x) => {
      const btn = h('button', { class: `slot-btn${state.active === x.name ? ' active' : ''}`, title: tr('Load {name}: {k} changed', { name: x.name, k: Object.keys(x.picks).length }), onclick: () => {
        // A second click on the loaded one lets go of it: Save then makes a new loadout.
        if (state.active === x.name) { state.active = null; markSaved(); return; }
        state.active = x.name;
        apply(x.picks);
        markSaved();
      } }, x.name);
      const del = h('button', { class: 'slot-del', title: tr('Delete {name}', { name: x.name }), 'aria-label': tr('Delete {name}', { name: x.name }), onclick: () => {
        store(mine().filter((y) => y.name !== x.name));
        if (state.active === x.name) state.active = null;
        markSaved();
      } }, '×');
      return h('span', { class: 'slot-wrap' }, btn, del);
    }));
    const current = list.find((x) => x.name === state.active);
    const full = list.length >= LOADOUTS_MAX && !current;
    save.disabled = full || (!current && !picks.size);
    save.classList.toggle('pending', current ? !same(Object.fromEntries(picks), current.picks) : picks.size > 0 && !full);
    save.textContent = current ? tr('Save {name}', { name: current.name }) : tr('Save');
    save.title = full ? tr('Three loadouts at most: delete one to save another') : current ? tr('Save these components as {name}', { name: current.name }) : tr('Save these components under a name');
  }
  const finishName = (ok) => {
    const name = nameInput.value.trim().slice(0, 24);
    nameInput.hidden = true;
    save.hidden = false;
    if (!ok || !name) return;
    const list = mine().filter((x) => x.name !== name);
    if (list.length >= LOADOUTS_MAX) return markSaved();
    store([...list, { name, picks: Object.fromEntries(picks) }]);
    state.active = name;
    markSaved();
  };
  save.addEventListener('click', () => {
    const current = mine().find((x) => x.name === state.active);
    if (current) {
      store(mine().map((x) => (x.name === current.name ? { name: x.name, picks: Object.fromEntries(picks) } : x)));
      return markSaved();
    }
    nameInput.value = tr('Loadout {n}', { n: mine().length + 1 });
    nameInput.hidden = false;
    save.hidden = true;
    nameInput.focus();
    nameInput.select();
  });
  nameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finishName(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finishName(false); }
  });
  nameInput.addEventListener('blur', () => { if (!nameInput.hidden) finishName(true); });
  markSaved();
  paintStats();

  const head = h('div', { class: 'sec-title sec-head' },
    h('span', { class: 'sec-head-left' }, h('span', null, tr('Components')), named),
    h('span', { class: 'loadout-slots', role: 'group', 'aria-label': tr('Saved loadouts') }, nameInput, save, stock));
  return {
    stats: [h('div', { class: 'sec-title' }, tr('Loadout stats')), tiles, missing],
    components: [h('div', { id: 'ship-components' }), head, table([['Slot', 'dim'], ['Component', ''], ['Size', 'num'], ['Grade', 'grade-col'], ['Class', 'dim']], tableRows, 't-loadout'),
      note('▾ changes every slot of its row; the stats above follow, beside the stock figures. Power and cooling are in game segments, from every component at its least to every one at its most.')],
  };
}
function loadoutTable(loadout) {
  const rows = groupLoadout(loadout.filter((l) => !LOADOUT_HIDDEN.has(l.type)));
  const label = (t) => tr((LOADOUT_GROUPS.find(([g]) => g === t) || [t, t])[1]);
  return table(
    [['Slot', 'dim'], ['Component', ''], ['Size', 'num'], ['Grade', 'grade-col'], ['Class', 'dim']],
    rows.map((l, i) => [
      i === 0 || rows[i - 1].type !== l.type ? label(l.type) : '',
      h('span', null, jump(l.item, l.item, 'item'), l.count > 1 ? ` ×${l.count}` : '', l.mount && h('span', { class: 'dim' }, ` · ${tr('on {mount}', { mount: l.mount })}`)),
      l.size != null ? `S${l.size}` : '',
      // Weapons have no grade or class: those two columns say who fires them, from where the grade starts.
      ...(!l.grade && !l.class && CONTROLS[l.control]
        ? [{ span: 2, content: h('span', { class: `control control-${l.control}`, title: CONTROL_HINTS[l.control] ? tr(CONTROL_HINTS[l.control]) : null }, tr(CONTROLS[l.control])) }]
        : [l.grade ? h('span', { class: `grade grade-${l.grade.toLowerCase()}` }, l.grade) : '', l.class ? tr(l.class) : '']),
    ]),
    't-loadout',
  );
}

// The lowest reputation level a blueprint's mission asks for: from scmdb.net's contracts, else the wiki's
// minimum. A title can be several missions, so it looks only at those that reward this blueprint.
let missionsByTitle = null;
let missionsFrom = null;
function missionRank(title, blueprint) {
  if (missionsFrom !== dbEntries) {
    missionsFrom = dbEntries;
    missionsByTitle = new Map();
    for (const x of dbEntries) if (x.t === 'mission') missionsByTitle.set(x.n, [...(missionsByTitle.get(x.n) || []), x]);
  }
  const ranks = (missionsByTitle.get(title) || [])
    .filter((m) => m.d.blueprints?.some((b) => b.name === blueprint))
    .map((m) => m.d.scm?.minRank || (m.d.minStanding ? { name: m.d.minStanding } : null))
    .filter(Boolean);
  return ranks.sort((a, z) => (a.min ?? Infinity) - (z.min ?? Infinity))[0] || null;
}
const rankCell = (r) => (r ? h('span', { title: r.min != null ? tr('{n} reputation points', { n: fmt(r.min) }) : null }, r.name) : '—');

function viewBlueprint(e) {
  const d = e.d;
  const mins = Math.round((d.craftTime || 0) / 60);
  // Real missions first; the game's reward tables (no mission a player sees) come after, without a link.
  const real = d.missions.filter((m) => !m.internal);
  const tables = d.missions.filter((m) => m.internal);
  const best = real[0];
  const kinds = (m) => (m.kinds || []).map((k) => tr(k)).join(', ');
  return {
    facts: [
      ['Craft time', d.craftTime ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : `${mins} min`) : null],
      ['Materials', d.ingredients.length],
      ['Missions', real.length || tr(d.defaultOwned ? 'Default blueprint' : tables.length ? 'Reward table only' : 'None known')],
    ],
    body: [
      // The mission most likely to give it, all in one place: its name, the odds, who offers it, what kind
      // of job it is and where.
      best && section('Best mission drop', h('div', { class: 'best-drop' },
        h('div', { class: 'best-drop-name' }, jump(best.name, best.name, 'mission')),
        h('div', { class: 'best-drop-facts' }, [
          ['Drop chance', h('span', { class: 'best-drop-chance' }, `${Math.round(best.chance * 100)}%`)],
          ['Faction', best.factions?.join(', ')],
          ['Minimum reputation', missionRank(best.name, e.n) && rankCell(missionRank(best.name, e.n))],
          ['Mission type', kinds(best)],
          ['Systems', best.systems?.join(', ')],
        ].filter(([, v]) => v).map(([label, v]) => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, tr(label)), h('span', { class: 'fact-value' }, v)))),
      )),
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
          ? [
              !real.length && note('This blueprint comes from a reward table in the game files: the missions that use it are not known.'),
              table(
                [['Mission', ''], ['Faction', ''], ['Minimum reputation', ''], ['Type', 'dim'], ['Drop chance', 'num']],
                [
                  ...sortedBy(real, (m) => m.name).map((m) => [jump(m.name, m.name, 'mission'), m.factions?.join(', ') || '', rankCell(missionRank(m.name, e.n)), kinds(m), `${Math.round(m.chance * 100)}%`]),
                  ...sortedBy(tables, (m) => m.name).map((m) => [h('span', { class: 'dim' }, `${tr('Reward table')}: ${m.name}`), '', '', '', `${Math.round(m.chance * 100)}%`]),
                ],
              ),
            ]
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

// Minutes as a player reads them: "45 min", "1 h 30 min", "2 days"; a range of them.
function minutesText(n) {
  if (n >= 1440 && n % 1440 === 0) return `${n / 1440} ${tr(n === 1440 ? 'day' : 'days')}`;
  if (n >= 60) return `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
  return `${n} min`;
}
const rangeText = (r, f = minutesText) => (!r ? null : r.min === r.max ? f(r.min) : `${f(r.min)} – ${f(r.max)}`);
const ENEMY_ROLE = { Reinforcments: 'Reinforcements' }; // the game's own spelling
// "SalvageSpawnDescription" → "Salvage": the game's internal group names, as words.
const enemyRole = (role) => ENEMY_ROLE[role] || String(role || 'Enemies').replace(/SpawnDescription$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Enemies';
const rankText = (min, max) => (!min ? null : !max || max.name === min.name ? min.name : `${min.name} – ${max.name}`);

// What scmdb.net adds to a mission, from the game's contract files (see scripts/collect-scmdb.js): its
// reputation, where it starts and ends, the enemies, the cargo, the item rewards and the missions around it.
function scmSections(d) {
  const s = d.scm;
  if (!s) return [];
  const none = (list) => !list || !list.length;
  const places = (p) => (p?.names?.length ? `${p.names.join(', ')}${p.count > p.names.length ? ` ${tr('+{n} more', { n: p.count - p.names.length })}` : ''}` : null);
  const repRows = s.rep.map((r) => {
    const fail = s.repFail.find((f) => f.faction === r.faction);
    return [r.faction, r.track, `+${rangeText(r, fmt)}`, fail ? `−${rangeText(fail, fmt)}` : ''];
  });
  const where = [[tr('Starts at'), places(s.from)], [tr('Delivers to'), places(s.to)]].filter(([, v]) => v);
  const cargoLine = (orders) => orders.map((o) => `${o.what}${o.max || o.min ? ` (${o.min === o.max || !o.max ? o.min : `${o.min}–${o.max}`} ${o.unit === 'SCU' ? 'SCU' : '×'})` : ''}`).join(', ');
  return [
    !none(s.items) && section('Rewards', h('div', null, s.items.map((i) => h('span', { class: 'pill' }, `${i.name}${i.amount > 1 ? ` ×${fmt(i.amount)}` : ''}`)))),
    !none(repRows) && section('Reputation', [
      table([['Faction', ''], ['Track', 'dim'], ['On completion', 'num'], ['On failure', 'num']], repRows),
      s.rep.some((r) => r.starStrings) && note('This reputation comes from the StarStrings add-on: scmdb.net lists none for this mission.'),
    ]),
    s.blueprintHint && note('The StarStrings add-on marks this mission as able to give a blueprint; which one is not known.'),
    !none(where) && section('Where', table([['', 'dim'], ['', '']], where)),
    !none(s.enemies) && section(
      'Enemies',
      table(
        [['Group', ''], ['Ships', 'num'], ['Which ships', '']],
        s.enemies.map((g) => [
          `${tr(enemyRole(g.role))}${g.kind ? ` · ${g.kind}` : ''}`,
          g.min === g.max ? String(g.max) : `${g.min}–${g.max}`,
          `${g.ships.join(', ')}${g.shipCount > g.ships.length ? ` ${tr('+{n} more', { n: g.shipCount - g.ships.length })}` : ''}`,
        ]),
      ),
    ),
    s.cargo && section(
      'Cargo',
      s.cargo.either
        ? h('div', null, h('p', { class: 'note' }, tr('One of these sets:')), s.cargo.either.map((set) => h('div', { class: 'cargo-set' }, cargoLine(set))))
        : h('div', { class: 'cargo-set' }, cargoLine(s.cargo.all)),
    ),
    (!none(s.after) || !none(s.next)) && section('Mission chain', table([['', 'dim'], ['', '']], [[tr('Comes after'), s.after.join(', ')], [tr('Leads to'), s.next.join(', ')]].filter(([, v]) => v))),
    s.knownIssue && h('p', { class: 'note known-issue' }, `${tr('Known issue')}: ${s.knownIssue}`),
    s.contracts > 1 && note('Some values are ranges: this mission comes in several variants (systems and difficulties).'),
  ];
}

function viewMission(e) {
  const d = e.d;
  const s = d.scm;
  const reward = d.rewardMin ? `${fmt(d.rewardMin)}${d.rewardMax > d.rewardMin ? ` – ${fmt(d.rewardMax)}` : ''} ${d.currency === 'UEC' ? 'aUEC' : d.currency || ''}` : null;
  return {
    facts: [
      ['Contractor', d.giver],
      ['Faction', (d.faction ?? d.factions?.join(', ')) === d.giver ? null : d.faction || d.factions?.join(', ')], // not twice when the contractor is the faction
      ['Mission type', d.kinds?.map((k) => tr(k)).join(', ')],
      ['Systems', d.systems?.join(', ')],
      ['Legality', d.legal],
      ['Reward', reward],
      // From scmdb.net when it has the mission: the wait before taking it again, the time it gives you, the
      // group it takes and the ranks that can do it; else the wiki's minimum.
      ['Cooldown', s?.cooldown && h('span', null, rangeText(s.cooldown), s.abandonCooldown && h('span', { class: 'headline-where' }, `${tr('after abandoning')}: ${rangeText(s.abandonCooldown)}`))],
      ['Time limit', rangeText(s?.timeLimit)],
      ['Group size', s?.maxPlayers ? (s.maxPlayers > 1 ? tr('Up to {n} players', { n: s.maxPlayers }) : tr('Solo')) : null],
      ['Rank needed', rankText(s?.minRank, s?.maxRank) || d.minStanding],
      ['New in patch', s?.isNew ? s.firstSeen : null],
      ['Blueprints', d.blueprints?.length],
      ['Combat', d.combat],
      ['Cargo hauling', d.hauling],
      ['Shareable', s?.maxPlayers ? null : d.shareable],
      ['One-time only', d.onceOnly],
    ],
    body: [
      // How the mission is done first (reputation, where, enemies, cargo), then the blueprints it can give:
      // their list is long.
      ...scmSections(d),
      d.blueprints?.length > 0 &&
        section(
          'Blueprints it can reward',
          table([['Blueprint', ''], ['Chance', 'num']], sortedBy(d.blueprints, (b) => b.name).map((b) => [jump(b.name, b.name, 'blueprint'), `${Math.round(b.chance * 100)}%`])),
        ),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      s && note('Mission details from scmdb.net, which reads the game\'s own contract files.'),
      links([['Wiki', d.url], ['SCMDB', s ? 'https://scmdb.net' : null]]),
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
  // Refinery prices as players report them; one under a tenth of the median is a typo ("1 aUEC") and is left out.
  const refineryAll = (d.refinery || []).slice().sort((a, z) => z.sell - a.sell);
  const median = refineryAll.length ? refineryAll[Math.floor(refineryAll.length / 2)].sell : 0;
  const refinery = refineryAll.filter((l) => l.sell >= median / 10);
  const at = (price, where) => h('span', null, auec(price), h('span', { class: 'headline-where' }, shortWhere(where)));
  return {
    facts: [
      ['Best sale', sells[0] && at(sells[0].sell, sells[0].where)],
      ['Cheapest buy', buys[0] && at(buys[0].buy, buys[0].where)],
      ['Refinery pays', refinery[0] && at(refinery[0].sell, refinery[0].where)],
      ['Code', d.code],
      ['Sell at', sells.length ? `${sells.length} terminals` : 'Nowhere listed'],
      ['Buy at', buys.length ? `${buys.length} terminals` : 'Nowhere listed'],
      ['Auto load/unload', d.locations.length ? `${d.locations.filter((l) => l.autoLoad).length} of ${d.locations.length} locations` : null],
      ['Legality', d.illegal ? 'Illegal — scanned cargo is contraband' : null],
    ],
    body: [
      d.mineral && section('Mining', jump(`Where to mine ${e.n} →`, e.n, 'mineral')),
      !d.locations.length && !refinery.length && section('Where to trade', note(tr('UEX has no terminal price for it yet: no terminal trades it, or no player has reported one.'))),
      d.locations.length > 0 && section(
        'Sell here · demand per location',
        sells.length
          ? table(
              [['Location', ''], ['Pays / SCU', 'num'], ['Demand', '']],
              sortedBy(sells, (l) => l.where).map((l) => [placeCell(l), auec(l.sell), demandMeter(l.inventory)]),
            )
          : note('No terminal buys it.'),
      ),
      d.locations.length > 0 && section(
        'Buy here · stock per location',
        buys.length
          ? table(
              [['Location', ''], ['Costs / SCU', 'num'], ['Stock', '']],
              sortedBy(buys, (l) => l.where).map((l) => [placeCell(l), auec(l.buy), stockMeter(l.stock)]),
            )
          : note('No terminal sells it.'),
      ),
      refinery.length > 0 && section(
        'Sell at a refinery · raw',
        table([['Refinery', ''], ['Pays / SCU', 'num']], refinery.map((l) => [l.where, auec(l.sell)])),
        note(tr('What refinery terminals pay for it raw, as players report it to UEX.')),
      ),
      d.locations.length > 0 && note('Demand and stock are UEX inventory levels reported by players; they move as people trade. AUTO LOAD: cargo is loaded and unloaded for you; ELEVATOR / DOCK: you move it by hand.'),
      liveAt && note(tr('Live from UEX: updated at {time}, again every 30 minutes.', { time: new Date(liveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })),
      links([['UEX', d.url], ['Wiki', d.wikiUrl]]),
    ],
  };
}

// Fresh demand, stock and prices from UEX (fetched by the main process at launch and every 30 min)
// replace each commodity's terminal list; an open commodity page is drawn again with them.
function applyLiveCommodities(data) {
  if (!data?.commodities?.length || !dbEntries.length) return;
  const byName = new Map(data.commodities.map((c) => [CompanionSearch.norm(c.name), c]));
  for (const e of dbEntries) {
    if (e.t !== 'commodity') continue;
    const live = byName.get(CompanionSearch.norm(e.n));
    if (live) {
      e.d.locations = live.locations;
      if (live.refinery) e.d.refinery = live.refinery;
    }
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

// The source says "Information Blocked" where it has nothing to show.
const realValue = (v) => (/^information blocked$/i.test(String(v ?? '').trim()) ? null : v);

function viewFaction(e) {
  const d = e.d;
  const ranks = d.ranks || [];
  return {
    facts: [
      ['Type', d.type],
      ['Area', d.area],
      ['Focus', d.focus],
      ['Leadership', realValue(d.leadership)],
      ['Headquarters', d.headquarters],
      ['Founded', realValue(d.founded)],
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
      links([['Wiki', d.url], ['Logo', d.logo?.page]]),
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

// ---------- Mining Assistant ----------
// The scan's switch, what it reads now, what it has read since it started (each ore links to its mineral
// page) and whether this PC can do it. The reading itself sits in the pin beside the icon, over the game.
const MINING_ENTRY = {
  t: 'activity', n: 'Mining Assistant', id: 'mining-assistant', s: 'Reads the radar signature on screen and names the ore',
  d: { kind: 'mining', aliases: ['Mining', 'Mining scan', 'Mineração', 'Assistente de mineração', 'RS scanner', 'Radar signature'] },
};
const MINING_NAMES = { Aluminum: 'Aluminium' }; // the signature table's spelling and the database's
const miningListeners = new Set();
companion.onMining((s) => { for (const fn of miningListeners) fn(s); });
const onMiningState = (node, fn) => {
  const listener = (s) => (node.isConnected ? fn(s) : miningListeners.delete(listener));
  miningListeners.add(listener);
  companion.mining().then(fn);
};
const miningWord = (name) => jump(name, MINING_NAMES[name] || name, 'mineral');

// The switch beside the version: on or off in one click. If it cannot start, the page says why.
let miningButtonState = null;
function renderMiningButton() {
  const on = !!miningButtonState?.on;
  $('mine-label').textContent = tr('Mining Assistant');
  $('mine-btn').classList.toggle('on', on);
  $('mine-btn').setAttribute('aria-pressed', String(on));
  $('mine-btn').title = tr(on ? 'Mining Assistant is on: it reads the radar signature while the bar is closed. Click to stop.' : 'Turn on the Mining Assistant: it reads the radar signature while the bar is closed.');
}
function setupMiningButton() {
  if ($('mine-btn').onclick) return;
  $('mine-btn').onclick = async () => {
    const s = await companion.setMining(!miningButtonState?.on);
    if (s.error) goTo(MINING_ENTRY.n, 'all');
  };
  onMiningState($('mine-btn'), (s) => { miningButtonState = s; renderMiningButton(); });
}

function miningPanel() {
  const big = h('div', { class: 'mpanel-big' });
  const line = h('div', { class: 'mpanel-line' });
  const panel = h('div', { class: 'mpanel' }, big, line);
  onMiningState(panel, (s) => {
    const shown = s.reading && s.reading.kind !== 'idle' ? s.reading : s.last;
    const v = CompanionMining.view(shown, tr);
    panel.dataset.tone = shown ? v.tone : 'idle';
    panel.classList.toggle('held', shown !== s.reading);
    big.textContent = shown ? v.headline : tr(s.on ? 'Nothing read yet: close the bar and point the scanner at a rock.' : 'Nothing read yet.');
    line.replaceChildren(...(shown ? [v.rs, v.count && ` · ${v.count}`, v.status && h('span', { class: 'mpanel-status' }, v.status), v.alternatives.length ? ` ${v.alternatives.map((a) => `${a.label} ${a.share}`).join(' · ')}` : ''].filter(Boolean) : []));
  });
  return panel;
}

function miningStatus() {
  const el = h('span');
  onMiningState(el, (s) => {
    const bad = s.error && { missing: 'The reading engine is not installed', ocr: 'Windows OCR is missing', failed: 'The reading engine could not start', fatal: 'The reading engine stopped', scan: 'Could not read the screen' }[s.error.code];
    el.className = bad ? 'mstatus-bad' : s.on ? 'mstatus-on' : 'mstatus-off';
    el.textContent = tr(bad || (!s.on ? 'Off' : s.scanning ? 'Scanning' : 'On: it reads when you close the bar'));
  });
  return el;
}

function miningButton() {
  const btn = h('button', { class: 'set-btn copy-btn', onclick: async () => { await companion.setMining(btn.dataset.on !== '1'); } });
  onMiningState(btn, (s) => {
    btn.dataset.on = s.on ? '1' : '';
    btn.textContent = tr(s.on ? 'Stop scan' : 'Start scan');
    btn.classList.toggle('done', s.on);
  });
  return btn;
}

function miningContext() {
  const seg = h('span', { class: 'seg', role: 'group' });
  onMiningState(seg, (s) => {
    seg.replaceChildren(...[['auto', 'Automatic'], ['space', 'Space'], ['surface', 'Surface']].map(([v, label]) => h('button', { class: `seg-btn${s.context === v ? ' on' : ''}`, onclick: () => companion.miningContext(v) }, tr(label))));
  });
  return seg;
}

function miningHistory() {
  const box = h('div');
  onMiningState(box, (s) => {
    box.replaceChildren(s.history.length
      ? table([['Time', ''], ['Reading', ''], ['Count', ''], ['RS', 'num']], s.history.map((r) => {
        const v = CompanionMining.view(r, tr);
        return [localTime(r.at / 1000), v.name ? miningWord(v.name) : v.headline, v.count || v.alternatives.map((a) => a.label).join(' · '), CompanionMining.rsText(r.rs)];
      }))
      : note('What the scan reads shows here, each ore linked to its page.'));
  });
  return box;
}

function miningChecks() {
  const box = h('div');
  onMiningState(box, (s) => {
    const m = s.ready?.monitor;
    const row = (what, value) => [tr(what), value];
    box.replaceChildren(table([['Needs', ''], ['This PC', '']], [
      row('Borderless or windowed game', tr('Set it in the game')),
      row('Windows text recognition (OCR)', s.ready ? s.ready.ocr : tr('Checked when the scan starts')),
      row('Screen at 1080p or more', m ? `${m.width} × ${m.height}${m.height < 1080 ? ` · ${tr('too small to read')}` : ''}` : tr('Checked when the scan starts')),
    ]));
  });
  return box;
}

function viewMining() {
  return {
    actions: [miningButton()],
    facts: [
      ['Scan', miningStatus()],
      ['Where you are', miningContext(), { wide: true }],
    ],
    body: [
      section('Reading', miningPanel()),
      section('This scan', miningHistory()),
      section('Before you start', miningChecks()),
      note('It only looks at the screen, like a screenshot, and only while the bar is closed. It never touches the game, sends keys or uses the network; everything stays on this PC.'),
    ],
  };
}

function viewActivity(e) {
  if (e.d.kind === 'mining') return viewMining();
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
      ['Compboards', tr('7 (boards 1–7)')],
      ['Cycle', tr('2 h closed · 1 h open · 5 min reset'), { wide: true }],
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

// The item's picture, by preference: one chosen by hand (SHIP_PHOTOS), cstone's render, the wiki page's picture (never a
// player's photo from a UEX offer: those are theirs). All are tried at once (a missing cstone picture can take a while to fail): the
// first to arrive shows at once and a more preferred one replaces it when it arrives; the box goes
// away if none loads.
// Pictures chosen by hand where the others are poor, shipped with the app (ship-photos/, about 640 px wide, WebP):
// the entry's exact name → the file. They come before every other source.
const SHIP_PHOTOS = {
  'Drake Ironclad': 'drake-ironclad.webp',
};
function imageFor(e) {
  const id = e.d.cstoneUrl?.split('/').pop();
  const own = SHIP_PHOTOS[e.n] && `ship-photos/${SHIP_PHOTOS[e.n]}`;
  const urls = [own, id && `https://cstone.space/uifimages/${id}.png`, e.d.image, e.d.wikiImage].filter(Boolean);
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

// A faction's logo, on a light or dark tile (whichever shows it), from the wiki's own file. Nothing is
// shown for a faction without one, and the box goes away if the picture does not load.
function logoFor(e) {
  const logo = e.d.logo;
  if (!logo) return null;
  const img = h('img', { class: `detail-img logo logo-${logo.tile}`, alt: '', referrerpolicy: 'no-referrer', title: tr('Logo from starcitizen.tools') });
  img.addEventListener('error', () => { img.remove(); fit(); });
  img.addEventListener('load', fit);
  img.src = logo.url;
  return img;
}

// The one or two facts worth reading first; they sit beside the name, the rest go in the grid below.
const HEADLINE = {
  item: ['Lowest price', 'UEX market price', 'DPS'],
  ship: ['Store price', 'Warbond', 'In-game price'],
  blueprint: ['Craft time'],
  mission: ['Reward', 'Cooldown'],
  mineral: ['Server base', 'Radar signature', 'Volatile'],
  commodity: ['Best sale', 'Cheapest buy', 'Refinery pays'],
  faction: ['Type', 'Area', 'Founded', 'Ranks'], // the short facts; Focus, Leadership and Headquarters get a row of their own
  location: ['System', 'Star'],
  activity: ['Hangar', 'Scan'],
};

// ---------- Compare: two ships or two weapons side by side ----------
// A button under the picture opens a second search bar beside the card; the one picked opens in a second card.
const CAN_COMPARE = new Set(['ship', 'item']);
const CMP_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 7.5h8.2V4.8l5 4.1-5 4.1v-2.7H2.5z" fill="currentColor" opacity="0.92"/><path d="M21.5 16.5h-8.2v-2.7l-5 4.1 5 4.1v-2.7h8.2z" fill="currentColor" opacity="0.92" transform="translate(0 -3)"/></svg>';
function pictureColumn(e, opts) {
  const pic = e.t === 'faction' ? logoFor(e) : imageFor(e);
  if (!CAN_COMPARE.has(e.t) || opts.side === 'right') return pic;
  const btn = h('button', { class: 'cmp-btn', title: tr('Compare with another one'), onclick: () => startCompare(e) });
  btn.innerHTML = CMP_ICON;
  btn.append(h('span', null, tr('Compare')));
  return h('div', { class: 'img-col' }, pic, btn);
}
let cmp = null; // { left, el, input, content, panel, results, idx, detail }
// What an item is compared against: hand and ship weapons carry their kind in `category` on some records and only in
// `type` ("FPS Weapon / Medium", "Weapon Gun / Gun") on others, so both spellings land in one group; anything else
// groups by category or type.
const kindKey = (e) => {
  const cat = e.d?.category || '', type = (e.d?.type || '').split(' / ')[0];
  if (/^FPS (RANGED )?WEAPON$/i.test(cat) || /^FPS Weapon$/i.test(type)) return 'fps-weapon';
  if (/^VEHICLE WEAPON$/i.test(cat) || /^Weapon Gun$/i.test(type)) return 'ship-weapon';
  return (cat || type).toLowerCase();
};
const sameKind = (a, z) => a.t === z.t && (a.t !== 'item' || (kindKey(a) !== '' && kindKey(a) === kindKey(z)));
function startCompare(left) {
  if (cmp) return cmp.input.focus();
  const corners = ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `corner ${c}` }));
  const input = h('input', { id: 'q2', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: tr(left.t === 'ship' ? 'Ship to compare with…' : 'Item to compare with…') });
  const content = h('div', { class: 'panel-content' });
  const panel = h('div', { class: 'panel open' }, h('div', { class: 'panel-scroll' }, content));
  const close = h('button', { class: 'icon-btn', 'aria-label': tr('Close comparison'), title: tr('Close comparison'), onclick: () => closeCompare() });
  close.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" /></svg>';
  const el = h('div', { class: 'wrap2' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-name cmp-title' }, tr('Compare')), h('span', { class: 'brand-filter' }, left.n)),
    h('div', { class: 'bar' }, corners, input, close),
    panel,
  );
  cmp = { left, el, input, content, panel, results: [], idx: 0, detail: null };
  // Both cards scroll as one while a second card is open: each mirrors the other's position.
  const mine = panel.firstChild;
  let syncing = false;
  const follow = (from, to) => () => {
    if (!cmp?.detail) return;
    if (syncing) { syncing = false; return; }
    if (Math.round(to.scrollTop) !== Math.round(from.scrollTop)) { syncing = true; to.scrollTop = from.scrollTop; }
  };
  mine.addEventListener('scroll', follow(mine, scrollEl));
  cmp.scrollMain = follow(scrollEl, mine);
  scrollEl.addEventListener('scroll', cmp.scrollMain);
  body.classList.add('comparing');
  document.body.append(el);
  companion.compare(true);
  input.addEventListener('input', () => { cmp.detail = null; searchCompare(); });
  el.addEventListener('keydown', compareKey);
  searchCompare();
  fit();
  setTimeout(() => input.focus(), 60);
}
// Every item the main search can find can be picked here too, each colour on its own row. Those of the same kind as
// the one on the left come first: they are the likely choice, not the only one.
function compareResults(left, q) {
  if (!q.trim()) return [];
  const found = CompanionSearch.search(index, q, { type: left.t, limit: 300 }).filter((e) => e !== left);
  return [...found.filter((e) => sameKind(left, e)), ...found.filter((e) => !sameKind(left, e))];
}
function searchCompare() {
  const q = cmp.input.value;
  cmp.results = compareResults(cmp.left, q);
  cmp.idx = 0;
  paintCompare();
}
function paintCompare() {
  if (!cmp) return;
  if (cmp.detail) {
    cmp.content.replaceChildren(renderDetail(cmp.detail, { side: 'right', back: () => { cmp.detail = null; paintCompare(); cmp.input.focus(); } }));
  } else if (!cmp.input.value.trim()) {
    cmp.content.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'empty-tag in' }, tr('Compare')), h('span', { class: 'empty-text in', delay: 60 }, tr(cmp.left.t === 'ship' ? 'Type the name of the ship to compare with {name}' : 'Type the name of the item to compare with {name}', { name: cmp.left.n }))));
  } else if (!cmp.results.length) {
    cmp.content.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'empty-tag in' }, tr('No signal')), h('span', { class: 'empty-text in', delay: 60 }, tr('Nothing matches “{q}”', { q: cmp.input.value }))));
  } else {
    cmp.content.replaceChildren(h('div', { class: 'list' }, cmp.results.map((e, i) => h('button', { class: `row${i === cmp.idx ? ' active' : ''}`, onclick: () => pickCompare(i), onmousemove: () => { cmp.idx = i; markCompare(); } },
      h('span', { class: 'row-type' }, tr(TYPE_LABEL[e.t])),
      missileTags(e, 0),
      h('span', { class: 'row-name' }, e.n),
      h('span', { class: 'row-meta' }, missileMeta(e) || armorMeta(e) || e.s || ''),
      rowArrow(),
    ))));
  }
  if (cmp.detail) alignCompare();
  cmp.panel.firstChild.scrollTop = 0;
  fit();
}

// Lines the two cards up, so the same stat sits at the same height on both sides: facts, headline facts and page
// sections are put in one shared order (the left card's, then what only the right one has), and whatever one card
// lacks becomes a dimmed "—" placeholder; matching sections then get the height of the taller one.
const ghostOf = (node, valueSel) => {
  const g = node.cloneNode(true);
  g.classList.add('cmp-gap');
  g.querySelectorAll('.scan').forEach((s) => s.remove());
  g.querySelectorAll('.in').forEach((s) => s.classList.remove('in')); // no entrance animation: it would leave the clone hidden
  const v = g.querySelector(valueSel);
  if (v) v.textContent = '—';
  return g;
};
function sharedOrder(ka, kb) {
  const order = [...ka];
  kb.forEach((k, i) => { if (!order.includes(k)) order.splice(i ? order.indexOf(kb[i - 1]) + 1 : 0, 0, k); });
  return order;
}
// Keys repeat now and then (two "Damage" blocks), so each carries its occurrence number.
const keyed = (nodes, keyOf) => {
  const seen = {};
  return nodes.map((n) => { const k = keyOf(n); seen[k] = (seen[k] || 0) + 1; return [`${k}#${seen[k]}`, n]; });
};
function alignChildren(ca, cb, keyOf, ghost) {
  if (!ca || !cb) return;
  const ma = new Map(keyed([...ca.children].filter((n) => !n.classList.contains('cmp-gap')), keyOf));
  const mb = new Map(keyed([...cb.children], keyOf));
  for (const k of sharedOrder([...ma.keys()], [...mb.keys()])) {
    const na = ma.get(k) || ghost(mb.get(k)), nb = mb.get(k) || ghost(ma.get(k));
    ca.append(na);
    cb.append(nb);
  }
}
function alignCompare() {
  const a = contentEl.querySelector('.detail'), b = cmp.content.querySelector('.detail');
  if (!a || !b) return;
  a.querySelectorAll('.cmp-gap').forEach((g) => g.remove());
  const [ha, hb] = [a, b].map((d) => d.querySelector('.detail-head'));
  if (ha && hb) { // the original's COMPARE button makes its head taller; both heads take the taller height
    ha.style.minHeight = hb.style.minHeight = '';
    ha.style.minHeight = hb.style.minHeight = `${Math.max(ha.offsetHeight, hb.offsetHeight)}px`;
  }
  const factKey = (n) => n.querySelector('.fact-label')?.textContent || '';
  const factGhost = (n) => ghostOf(n, '.fact-value, .headline-value');
  alignChildren(a.querySelector('.headline'), b.querySelector('.headline'), factKey, factGhost);
  alignChildren(a.querySelector('.facts:not(.facts-bars)'), b.querySelector('.facts:not(.facts-bars)'), factKey, factGhost);
  alignChildren(a.querySelector('.facts-bars'), b.querySelector('.facts-bars'), factKey, factGhost);
  const ra = a.querySelector('.rise'), rb = b.querySelector('.rise');
  if (!ra || !rb) return;
  for (const r of [ra, rb]) wrapSections(r);
  const blockKey = (n) => n.dataset.key;
  const blockGhost = (n) => {
    const g = h('div', { class: 'sec-block cmp-gap' });
    const t = n.querySelector('.sec-title');
    if (t) g.append(t.cloneNode(true), h('p', { class: 'note' }, '—'));
    return g;
  };
  alignChildren(ra, rb, blockKey, blockGhost);
  const ba = [...ra.children], bb = [...rb.children];
  ba.forEach((n) => { n.style.minHeight = ''; });
  bb.forEach((n) => { n.style.minHeight = ''; });
  ba.forEach((n, i) => {
    const m = Math.max(n.offsetHeight, bb[i].offsetHeight);
    n.style.minHeight = bb[i].style.minHeight = `${m}px`;
  });
}
// A page's sections as blocks (a title and what follows it up to the next title), so they can be lined up by title.
function wrapSections(rise) {
  if (rise.firstElementChild?.classList.contains('sec-block')) return;
  const blocks = [];
  for (const n of [...rise.children]) {
    if (n.classList.contains('sec-title') || !blocks.length) blocks.push(h('div', { class: 'sec-block', 'data-key': n.classList.contains('sec-title') ? n.textContent : '' }));
    blocks[blocks.length - 1].append(n);
  }
  rise.replaceChildren(...blocks);
}
function markCompare() {
  cmp.content.querySelectorAll('.row').forEach((r, j) => r.classList.toggle('active', j === cmp.idx));
}
function pickCompare(i) {
  if (!cmp?.results[i]) return;
  cmp.detail = cmp.results[i];
  paintCompare();
}
function compareKey(ev) {
  ev.stopPropagation(); // the main search's keys (arrows, Tab, typing) are not for this card
  if (ev.key === 'Escape') { ev.preventDefault(); if (cmp.detail) { cmp.detail = null; paintCompare(); cmp.input.focus(); } else closeCompare(); }
  else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    if (!cmp.results.length || cmp.detail) return;
    cmp.idx = Math.max(0, Math.min(cmp.results.length - 1, cmp.idx + (ev.key === 'ArrowDown' ? 1 : -1)));
    markCompare();
    cmp.content.querySelectorAll('.row')[cmp.idx]?.scrollIntoView({ block: 'nearest' });
  } else if (ev.key === 'Enter') { ev.preventDefault(); if (!cmp.detail) pickCompare(cmp.idx); }
  else if (ev.key === 'Tab') ev.preventDefault();
}
function closeCompare(silent) {
  if (!cmp) return;
  scrollEl.removeEventListener('scroll', cmp.scrollMain);
  cmp.el.remove();
  cmp = null;
  contentEl.querySelectorAll('.detail .cmp-gap').forEach((g) => g.remove()); // the placeholders that lined the card up
  contentEl.querySelectorAll('.detail .sec-block').forEach((n) => { n.style.minHeight = ''; });
  body.classList.remove('comparing');
  companion.compare(false);
  if (!silent) { fit(); qEl.focus(); }
}

function renderDetail(e, opts = {}) {
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
      pictureColumn(e, opts),
      h(
        'div',
        { class: 'detail-main' },
        h(
          'div',
          { class: 'detail-top' },
          h('span', { class: 'detail-type in' }, tr(TYPE_LABEL[e.t])),
          h('button', { class: 'back', onclick: opts.back || back }, 'Back ', h('kbd', null, 'ESC')),
        ),
        h('div', { class: 'detail-name in', delay: 40 }, e.n),
        // A faction's subtitle (type · area · focus) is the same as its Type, Area and Focus facts below.
        e.t !== 'faction' && h('div', { class: 'detail-meta in', delay: 110 }, armorMeta(e) || e.s || ''),
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
    rest.length > 0 && h('div', { class: e.t === 'faction' ? 'facts facts-fit' : 'facts' }, rest.map(fact)),
    barRow.length > 0 && h('div', { class: 'facts facts-bars' }, barRow.map((b, i) => fact(b, rest.length + i))),
    h('div', { class: 'rise', delay: 420 }, body),
    // At the foot of every page: a bug report about this very page.
    h('div', { class: 'report-foot rise', delay: 460 }, h('button', { class: 'report-btn', title: tr('Tell the developer what is wrong on this page'), onclick: () => openFeedback(pageRef(e)) }, tr('Report a bug on this page'))),
  );
}

// What identifies a result page in a bug report: its kind, name and the source's own id.
function pageRef(e) {
  return { type: TYPE_LABEL[e.t] || e.t, name: e.n, sub: e.s || '', id: e.id || '', ref: e.d?.debugName || e.d?.uuid || e.d?.id || '' };
}

// A missile's size (S1, S2…) and how it finds its target (IR, EM, CS) as two coloured tags before its name, so
// "missile" alone sorts out what fits a hardpoint and what the target's signature has to be.
const MISSILE_SEEKER = {
  Infrared: ['IR', 'Infrared tracking: locks on to the heat a ship gives off'],
  Electromagnetic: ['EM', 'Electromagnetic tracking: locks on to the electromagnetic signature of a ship'],
  CrossSection: ['CS', 'Cross section tracking: locks on to the cross section of a ship'],
};
// A missile or torpedo, also when its source gave no category: the name ends in Missile or Torpedo ("Calamity
// XII-IR Torpedo"); a launcher or a rack is not one. The roman numeral in the name is its size, a suffix its seeker.
const ROMAN = { I: 1, V: 5, X: 10 };
const romanValue = (r) => [...r].reduce((n, c, i, a) => n + (ROMAN[c] < (ROMAN[a[i + 1]] || 0) ? -ROMAN[c] : ROMAN[c]), 0);
function missileInfo(e) {
  if (e.t !== 'item') return null;
  const a = e.d?.attrs || {};
  const named = /\b([IVX]+)(?:-([A-Z]+))?\s+(?:Missile|Torpedo)$/.exec(e.n);
  if (e.d?.category !== 'MISSILE' && !(named && !/Launcher|Rack/i.test(e.n))) return null;
  const size = parseInt(a.SIZE, 10) || (named ? romanValue(named[1]) : NaN);
  const bySuffix = { IR: 'Infrared', EM: 'Electromagnetic', CS: 'CrossSection' }[named?.[2]];
  return { size, seeker: MISSILE_SEEKER[a.TYPE] || MISSILE_SEEKER[bySuffix], attrs: a, classification: e.d?.classification };
}
function missileTags(e, delay) {
  const m = missileInfo(e);
  if (!m) return null;
  const { size, seeker } = m;
  return h('span', { class: 'mtags in', delay },
    Number.isFinite(size) && h('span', { class: `mtag msize msize-${Math.min(size, 12)}`, title: tr('Size {n}', { n: size }) }, `S${size}`),
    seeker && h('span', { class: `mtag mseek mseek-${seeker[0].toLowerCase()}`, title: tr(seeker[1]) }, seeker[0]),
  );
}
// What sets one missile apart in the list: its class, damage and lock time.
const armorMeta = (e) => (e.armor ? e.armor.map((w) => tr(w)).join(' · ') : null);

function missileMeta(e) {
  const m = missileInfo(e);
  if (!m) return null;
  const a = m.attrs;
  return [m.classification, a.DAMAGE && `${tr('lock')} ${a['LOCK TIME']}`, a.SPEED].filter(Boolean).join(' · ') || null;
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
        missileTags(e, d),
        h('span', { class: 'row-name in', delay: d }, e.n),
        h('span', { class: 'row-meta in', delay: d }, `${missileMeta(e) || armorMeta(e) || e.s || ''}${more}`),
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
  path.setAttribute('stroke', 'currentColor'); // the theme's accent (.row-arrow)
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('fill', 'none');
  svg.append(path);
  return svg;
}

// ---------- Checklist: what the overlay needs to work, checked where the app can ----------
// Shown at the first launch (and from Settings or the tray), and at every launch while something on it is wrong. The
// main process reads the game's window mode and looks for the helpers an antivirus may remove; the key is tested by
// pressing it here; the connection and the database are the bar's own state.
let checks = null; // { game: { channels: [{ channel, dir, mode }], picked }, keys: { exe, ready, hotkey }, mining: { exe } | null }
let keyTested = false;
let recordsTotal = 0; // the footer's count, set when the database loads
let checklistShown = false; // what the main process was last told
const README_ANTIVIRUS = 'https://github.com/VorxenSC/StarCompanion#if-an-antivirus-warns';
async function refreshChecks() {
  checks = await companion.checklist?.();
  if (notice) render();
}
companion.onChecklistHit?.(() => {
  keyTested = true;
  if (notice) render();
});
const WINDOW_MODES = { 0: 'Windowed', 1: 'Fullscreen', 2: 'Borderless' };
// Each line: [status, title, text, action?]; status is ok, warn, bad, todo (yours to do) or wait.
function checkItems() {
  const key = $('hotkey').textContent;
  const items = [];
  const pick = h('button', { class: 'set-btn', onclick: async () => { checks = await companion.pickGameFolder(); render(); } }, tr('Find the game folder'));
  // The game's window mode.
  const channels = checks?.game?.channels || [];
  const names = (list) => list.map((c) => c.channel).join(', ');
  if (!checks) items.push(['wait', 'Borderless window', tr('Looking for Star Citizen…')]);
  else if (!channels.length) items.push(['todo', 'Borderless window', tr('Star Citizen was not found on this PC. In game, open Options → Graphics → Window Mode and choose Borderless: no overlay can show over Fullscreen.'), pick]);
  else if (channels.some((c) => c.mode === 1)) items.push(['bad', 'Borderless window', tr('{channels} is in Fullscreen, and no overlay can show over it. In game: Options → Graphics → Window Mode → Borderless.', { channels: names(channels.filter((c) => c.mode === 1)) })]);
  else if (channels.every((c) => !(c.mode in WINDOW_MODES))) items.push(['todo', 'Borderless window', tr('Found {channels}, but its graphics settings were never saved. In game: Options → Graphics → Window Mode → Borderless.', { channels: names(channels) })]);
  else items.push(['ok', 'Borderless window', channels.filter((c) => c.mode in WINDOW_MODES).map((c) => `${c.channel}: ${tr(WINDOW_MODES[c.mode])}`).join(' · ') + (channels.some((c) => c.mode === 0) ? ` · ${tr('Windowed works too; Borderless is smoother.')}` : '')]);
  // The shortcut key.
  if (checks && !checks.keys.exe) items.push(['bad', tr('{key} to open', { key }), tr('The shortcut key helper (StarCompanionKeys.exe) is missing: an antivirus may have removed it. Restore it from the quarantine, add the Star Companion folder to the exceptions, then reinstall.'), h('button', { class: 'set-btn', onclick: () => companion.openLink(README_ANTIVIRUS) }, tr('How to'))]);
  else if (keyTested) items.push(['ok', tr('{key} to open', { key }), tr('{key} works. It opens and closes the bar from anywhere, in game too; the o7 icon does the same.', { key })]);
  else items.push(['todo', tr('{key} to open', { key }), tr('Press {key} now to test it. It opens and closes the bar from anywhere, in game too. To use another key, click {key} in the search bar.', { key })]);
  // The Mining Assistant's reader, where the app has it.
  if (checks?.mining) {
    if (checks.mining.exe) items.push(['ok', 'Mining Assistant', tr('Ready. It reads the radar signature on screen, so it needs Borderless too.')]);
    else items.push(['bad', 'Mining Assistant', tr('Its reader (MiningSidecar.exe) is missing: an antivirus may have removed it. Restore it from the quarantine, add the Star Companion folder to the exceptions, then reinstall.'), h('button', { class: 'set-btn', onclick: () => companion.openLink(README_ANTIVIRUS) }, tr('How to'))]);
  }
  // The connection and the database.
  if (!navigator.onLine || barState.offline) items.push(['warn', 'Internet', tr('Offline. Search still works; prices, pictures and updates come back with the connection.')]);
  else items.push(['ok', 'Internet', tr('Connected. Search works offline too; prices, pictures and updates need the connection.')]);
  if (barState.error) items.push(['bad', 'Database', tr('The database did not load. Close Star Companion and open it again; if it keeps failing, reinstall it.')]);
  else if (barState.loading) items.push(['wait', 'Database', tr('Loading…')]);
  else items.push(['ok', 'Database', tr('{records} records for PU {version}.', { records: fmt(recordsTotal), version: gameVersion || '?' })]);
  return items;
}
const CHECK_MARK = { ok: '✓', warn: '!', bad: '✕', todo: '→', wait: '…' };
// ---------- Thanks: the sites the data comes from, before the checklist ----------
const THANKS = [
  ['Star Citizen Wiki', 'https://starcitizen.tools', 'starcitizen.tools', 'Ships, items, weapons, loadouts, factions, missions and locations.'],
  ['Cornerstone Finder', 'https://finder.cstone.space', 'finder.cstone.space', 'Shops, prices and item pictures.'],
  ['UEX Corp', 'https://uexcorp.space', 'uexcorp.space', 'Commodity and terminal prices, the player marketplace and the live PU version.'],
  ['SC Craft Tools', 'https://sc-craft.tools', 'sc-craft.tools', 'Blueprints, their materials and crafting quality.'],
  ['SCMDB', 'https://scmdb.net', 'scmdb.net', 'Mission details: cooldowns, ranks and reputation.'],
  ['SC Miner', 'https://scminer.rocks', 'scminer.rocks', 'Minerals, radar signatures and where to find them.'],
  ['Contested Zone Timers', 'https://contestedzonetimers.com', 'contestedzonetimers.com', 'The Executive Hangar timer, and the zone maps by Terada and u/Kerast.'],
  ['EXP Carry and The Orbital Ledger', 'https://expcarry.com', 'expcarry.com', 'Contested zone routes, doors and keycards.'],
  ['StarStrings', 'https://github.com/MrKraken/StarStrings', 'github.com/MrKraken/StarStrings', 'Mission tags that fill the gaps.'],
  ['Roberts Space Industries', 'https://robertsspaceindustries.com', 'robertsspaceindustries.com', 'The game we all love, and the ship store prices.'],
  ['Eclipse', 'https://eclipsegaming.net', 'eclipsegaming.net', 'A community of friends who raid, explore and play together, in Star Citizen and World of Warcraft. Thank you for the support with the design and for testing the app.'],
];
function renderThanks() {
  return h(
    'div',
    { class: 'notice thanks' },
    h('div', { class: 'detail-type in' }, tr('Thank you')),
    h('div', { class: 'detail-name in', delay: 40 }, tr('Built on the community’s work')),
    h('p', { class: 'thanks-intro rise', delay: 100 }, tr('Star Companion only exists because of people who spent countless hours gathering, checking and sharing what they know about Star Citizen, freely, for everyone. Every price, blueprint, mission and signature you find here started with them. I am deeply grateful, and I try to credit and link back to each of them.')),
    h(
      'div',
      { class: 'thanks-list' },
      THANKS.map(([name, url, shown, what], i) => h('button', { class: 'thanks-card rise', delay: 160 + i * 40, title: tr('Open {site}', { site: shown }), onclick: () => companion.openLink(url) },
        h('span', { class: 'thanks-name' }, name),
        h('span', { class: 'thanks-what' }, tr(what)),
        h('span', { class: 'thanks-url' }, `${shown} ↗`))),
    ),
    h('p', { class: 'thanks-outro rise', delay: 600 }, tr('And thank you, citizen, for every bug report and idea. If you enjoy what these sites do, visit them, use them and support them: they keep the ’verse mapped for all of us. o7')),
    h(
      'div',
      { class: 'notice-actions rise', delay: 640 },
      h('span', { class: 'dim' }, tr('Next: a quick checklist')),
      h('button', { class: 'notice-ok', onclick: () => thanksDone() }, tr('Continue'), ' ', h('kbd', null, 'ENTER')),
    ),
  );
}
// From the thank-you page to the checklist; seen once is enough.
function thanksDone() {
  companion.thanksDone?.();
  noticePage = 'checklist';
  keyTested = false;
  render();
  scrollEl.scrollTop = 0;
  qEl.focus();
}

function renderNotice() {
  if (noticePage === 'thanks') return renderThanks();
  const items = checkItems();
  const ready = items.filter(([st]) => st === 'ok').length;
  const dont = h('input', { type: 'checkbox', id: 'notice-dont' });
  const help = [
    'Check that the game is in Borderless, above: it is the most common cause.',
    'Click the o7 icon. If the icon opens the bar but the key does not, another program may be using the key: pick another one.',
    'If you run Star Citizen as administrator, run Star Companion as administrator too.',
    'If an antivirus warned about Star Companion, add its folder to the exceptions.',
  ];
  return h(
    'div',
    { class: 'notice checklist' },
    h('div', { class: 'detail-type in' }, tr('Checklist')),
    h('div', { class: 'detail-name in', delay: 40 }, tr('Ready to fly?')),
    h('p', { class: 'check-sum in', delay: 80 }, tr('{n} of {m} ready', { n: ready, m: items.length })),
    h(
      'div',
      { class: 'check-list' },
      items.map(([st, title, text, action], i) => {
        const d = 140 + i * 60;
        return h('div', { class: `check-item ${st} rise`, delay: d },
          h('span', { class: 'check-mark', 'aria-hidden': 'true' }, CHECK_MARK[st]),
          h('div', { class: 'check-words' }, h('span', { class: 'check-title' }, tr(title)), h('p', { class: 'check-text' }, text)),
          action ? h('span', { class: 'check-action' }, action) : null);
      }),
    ),
    h(
      'div',
      { class: 'check-help rise', delay: 480 },
      h('span', { class: 'check-help-title' }, tr('The bar does not show in game?')),
      h('ol', null, help.map((t) => h('li', null, tr(t))), h('li', null, tr('Still stuck? '), h('a', { class: 'link', onclick: () => { notice = false; companion.checklistOpen?.(false); openFeedback(); } }, tr('Report it')), tr(': it reaches the developer.'))),
    ),
    h('p', { class: 'check-fine rise', delay: 520 }, tr('A fan-made tool, not affiliated with Cloud Imperium Games or Roberts Space Industries. Prices, shops and locations come from community sites and can lag behind a new patch.')),
    h(
      'p',
      { class: 'notice-support rise', delay: 540 },
      tr('Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7'),
      h('a', { class: 'coffee', onclick: () => companion.openLink(COFFEE_URL) }, tr('Buy me a coffee =) ↗')),
    ),
    h(
      'div',
      { class: 'notice-actions rise', delay: 580 },
      h('label', { class: 'notice-check' }, dont, ' ', tr('Don’t show this again')),
      h('span', { class: 'fb-buttons' },
        h('button', { class: 'back', onclick: () => { checks = null; render(); refreshChecks(); } }, tr('Check again')),
        h('button', { class: 'notice-ok', onclick: () => dismissNotice() }, tr('Got it '), h('kbd', null, 'ENTER'))),
    ),
  );
}

function showNotice(opts) {
  notice = true;
  noticePage = opts?.thanks ? 'thanks' : 'checklist';
  keyTested = false;
  refreshChecks();
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
  renderMiningButton();
  qEl.placeholder = tr('Search items, ships, blueprints, missions, minerals…');
  $('settings-btn').title = $('settings-btn').ariaLabel = tr('Settings');
  $('report-bug').title = $('report-bug').ariaLabel = tr('Report a bug');
  $('coffee').title = tr('Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7');
}

async function settingsAction(action) {
  settings = await companion.settingsAction(action);
  if (action === 'notice' || action === 'thanks') settingsOpen = false; // the notice takes the panel
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
    row('Icon transparency', 'How see-through the icon is while you play; 0% is solid', steps('dockTransparency', s.steps.dockTransparency, s.dockTransparency, !s.dock), i++),
    row('Transparency', '0% is solid; 100% is as see-through as stays readable', steps('transparency', s.steps.transparency, s.transparency), i++),
    row('Text size', 'Also Ctrl + = and Ctrl + -', steps('zoom', s.steps.zoom, s.zoom), i++),
    row('Theme', 'Colours and fonts', choice('theme', [['default', 'Star Companion'], ['eclipse', 'Eclipse']], s.theme || 'eclipse'), i++),
    row('Language', 'Automatic follows Windows', choice('language', [['auto', tr('Automatic')], ['en', tr('English')], ['pt-BR', tr('Portuguese')]], s.language), i++),
    row('Position and size', 'Back to the default place and size', h('button', { class: 'set-btn', onclick: () => settingsAction('resetLayout') }, tr('Reset')), i++),
    group('Updates and help'),
    row('Check for updates at launch', tr('You have v{version}', { version: s.version }), h('span', { class: 'set-inline' }, toggle('checkUpdates', s.checkUpdates), h('button', { class: 'set-btn', onclick: () => settingsAction('checkUpdates') }, tr('Check now'))), i++),
    row('Thanks', 'The sites the data comes from', h('button', { class: 'set-btn', onclick: () => settingsAction('thanks') }, tr('Show')), i++),
    row('Checklist', 'What the overlay needs to work, checked', h('button', { class: 'set-btn', onclick: () => settingsAction('notice') }, tr('Show')), i++),
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

// page: from a result page's bug button (its kind, name and ids, which go with the message); none for the
// general suggestion form.
function openFeedback(page) {
  const about = page && typeof page === 'object' && page.name ? page : null;
  feedback = { ...(feedback?.status === 'sent' ? {} : feedback), open: true, status: '', error: '', page: about };
  feedback.kind ||= 'Idea';
  if (about) feedback.kind = 'Bug';
  feedback.includeInfo ??= true;
  recorder = null;
  notice = false;
  render();
  setTimeout(() => $('fb-message')?.focus(), 50);
}

// The footer's Report: the form set to Bug, about the page on screen if there is one. Its other kinds stay a click away.
function openBugReport() {
  openFeedback(detail ? pageRef(detail) : null);
  feedback.kind = 'Bug';
  render();
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
  const res = await companion.sendFeedback({ kind: f.kind, message: f.message, name: f.name, email: f.email, includeInfo: f.includeInfo, gameVersion, page: f.page ? { ...f.page, data: `PU ${gameVersion || '?'} · data built ${(dataBuiltAt || '').slice(0, 10) || '?'}` } : null });
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
  const message = h('textarea', { id: 'fb-message', class: 'fb-input fb-message', maxlength: '4000', rows: '5', placeholder: f.page ? tr('What is wrong on this page? What did you expect to see?') : 'What would make Star Companion better? What broke, or what did you not find?', oninput: bind('message') });
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
    h('div', { class: 'detail-type in' }, f.page || f.kind === 'Bug' ? tr('Bug report') : 'Suggestions'),
    h('div', { class: 'detail-name in', delay: 40 }, f.page ? tr('Report a bug') : 'Help shape Star Companion'),
    f.page
      ? h('div', { class: 'fb-page rise', delay: 100 }, h('span', { class: 'fact-label' }, tr('About this page')), h('span', { class: 'fb-page-name' }, `${tr(f.page.type)} · ${f.page.name}`), h('span', { class: 'dim' }, tr('The page is sent with your message, so the developer knows which one it is.')))
      : h('p', { class: 'notice-text rise', delay: 100 }, 'Ideas, bugs, wrong prices or missing items: it goes straight to the developer.'),
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
  const checking = notice && noticePage === 'checklist';
  if (checking !== checklistShown) { checklistShown = checking; companion.checklistOpen?.(checking); }
  const q = qEl.value.trim();
  // Always shown, "All" included, so Tab's filter is never a guess.
  filterEl.textContent = tr('Filter · {name}', { name: tr(TYPES.find(([t]) => t === type)[1]) });
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
  } else if (barState.loading) {
    listKey = '';
    contentEl.replaceChildren(h('div', { class: 'list' }, [150, 110, 180].map((w) => h('div', { class: 'row skel-row', 'aria-hidden': 'true' }, h('i', { class: 'skel', style: 'width: 70px; height: 12px' }), h('i', { class: 'skel', style: `width: ${w}px; height: 18px` }), h('i', { class: 'skel skel-fill', style: 'height: 12px' })))));
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
  stateLead(q);
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
  if (cmp) cmp.panel.style.height = `${panelH}px`;
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
  closeCompare(true);
  trail = [];
  ahead = [];
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
  ahead = [];
  idx = i;
  detail = results[i];
  render();
}

// The pages opened by links from other pages (a ship's component, a blueprint's mission…), so Esc and Back go back
// to the page the link was on, scrolled where it was. A new search starts afresh.
let trail = [];
// The pages Back left, for the mouse's Forward button; newest last.
let ahead = [];
const snapshot = () => ({ query: qEl.value, type, results, idx, detail, scroll: scrollEl.scrollTop });
function restore(prev) {
  qEl.value = prev.query;
  type = prev.type;
  results = prev.results;
  idx = prev.idx;
  detail = prev.detail;
  render();
  // After the page is laid out: its own scroll position, not the top.
  requestAnimationFrame(() => requestAnimationFrame(() => { scrollEl.scrollTop = prev.scroll; }));
  qEl.focus();
}
function back() {
  closeCompare(true);
  if (detail) ahead.push(snapshot());
  const prev = trail.pop();
  if (prev) {
    restore(prev);
    return;
  }
  detail = null;
  render();
  setIdx(idx);
  qEl.focus();
}

// Cross-links inside a detail jump straight to the named entry.
// The mouse's Forward: the page Back left. From a page, that page goes on the trail, so Back returns to it.
function forward() {
  const next = ahead.pop();
  if (!next) return;
  closeCompare(true);
  if (detail) trail.push(snapshot());
  restore(next);
}

function goTo(query, t) {
  if (detail && !settingsOpen) trail.push(snapshot());
  ahead = [];
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

// The mouse's side buttons (Back is button 3, Forward 4), over the panel. Not while a panel of its own is open
// (settings, the report form, the shortcut recorder, the first notice): those close with Esc.
window.addEventListener('mouseup', (ev) => {
  if (ev.button !== 3 && ev.button !== 4) return;
  ev.preventDefault();
  if (settingsOpen || feedback?.open || recorder || notice) return;
  if (ev.button === 3) { if (detail) back(); } else forward();
});
// Chromium would otherwise read them as the page's own Back and Forward.
window.addEventListener('mousedown', (ev) => { if (ev.button === 3 || ev.button === 4) ev.preventDefault(); });

// ---------- Input ----------
let timer;
qEl.addEventListener('input', () => {
  // Typing a search means the notice has been seen (it stays on for the next launch unless ticked off).
  if (notice) {
    if (noticePage === 'thanks') companion.thanksDone?.();
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
  else if (notice && noticePage === 'thanks' && (ev.key === 'Enter' || ev.key === 'Escape')) thanksDone();
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
$('report-bug').addEventListener('click', (ev) => {
  ev.preventDefault();
  openBugReport();
});
$('coffee').addEventListener('click', (ev) => {
  ev.preventDefault();
  companion.openLink(COFFEE_URL);
});
$('clear').addEventListener('click', () => {
  if (qEl.value) { qEl.value = ''; type = 'all'; search(); qEl.focus(); } else companion.hide();
});
// ---------- The bar's state: offline, updating, the database not loaded (the design's States board) ----------
const STATE_ICONS = {
  offline: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 5 Q7 0 13 5 M3.5 8 Q7 5 10.5 8 M7 11.5 L7 11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 13 L12 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  updating: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M12 7 A5 5 0 1 1 9.5 2.7 M12 1.5 L12 4.5 L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5 L13 12 H1 Z M7 5.5 V8.5 M7 10.3 V10.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const STATE_WORDS = {
  offline: ['Offline', 'No connection: the data shown is the last saved. Live prices and the PU version wait for the connection.'],
  updating: ['Updating', 'The database is updating: results may be out of date until it finishes.'],
  error: ['Error', 'The database could not be loaded.'],
};
const barState = { offline: !navigator.onLine, updating: false, error: false, loading: true };
function paintBarState() {
  const which = barState.error ? 'error' : barState.updating ? 'updating' : barState.offline ? 'offline' : null;
  const el = $('bar-state');
  el.hidden = !which;
  document.querySelector('.bar').classList.toggle('err', which === 'error');
  $('bar-run').hidden = !barState.loading;
  if (!which) return;
  el.className = `bar-state${which === 'error' ? ' err' : ''}`;
  el.innerHTML = STATE_ICONS[which];
  el.append(tr(STATE_WORDS[which][0]));
  el.title = tr(STATE_WORDS[which][1]);
}
window.addEventListener('online', () => { barState.offline = false; paintBarState(); });
window.addEventListener('offline', () => { barState.offline = true; paintBarState(); });
companion.onDbUpdating?.(() => { barState.updating = true; paintBarState(); render(); });
paintBarState();

// What the bar's state means, over the results (the design's States board): offline and a database that did not
// load say so in a panel with Retry; while the database updates, a line says the results may be out of date.
function stateLead(q) {
  contentEl.querySelector('.state-lead')?.remove();
  if (recorder || settingsOpen || feedback?.open || notice) return;
  let lead = null;
  if (barState.error) {
    lead = statePanel('err', 'The database did not load', 'Something went wrong while loading the data. Try again in a moment.', retryLoad);
  } else if (q && barState.offline) {
    lead = statePanel('warn', 'No connection', 'Showing the last saved data: live prices and the PU version may be out of date.', retryNet);
  } else if (q && barState.updating) {
    lead = h('div', { class: 'state-lead state-note' }, tr('Data may be out of date while it updates.'));
  }
  if (lead) contentEl.prepend(lead);
}
function statePanel(kind, title, text, retry) {
  const btn = h('button', { class: 'state-retry', onclick: async () => { btn.disabled = true; btn.textContent = tr('Retrying…'); await retry(); } }, tr('Retry'));
  return h('div', { class: `state-lead state-panel ${kind}` },
    h('div', { class: 'state-words' }, h('span', { class: 'state-title' }, tr(title)), h('span', { class: 'state-text' }, tr(text))),
    btn);
}
// Offline: ask for the live data again; the panel goes once the connection is back.
async function retryNet() {
  await companion.retryNet?.();
  barState.offline = !navigator.onLine;
  paintBarState();
  render();
}
// The database did not load: load it again.
async function retryLoad() {
  barState.error = false;
  barState.loading = true;
  paintBarState();
  render();
  try {
    await load();
  } catch (err) {
    barState.loading = false;
    barState.error = true;
    paintBarState();
    $('dbinfo').textContent = `Could not load the database: ${err.message}`;
  }
  render();
}
window.addEventListener('online', () => render());
window.addEventListener('offline', () => render());

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

// What was typed does not stay: if the bar was closed for two minutes or more, it opens empty.
const FORGET_AFTER_MS = 2 * 60 * 1000;
let closedAt = 0;
function forgetSearch() {
  closeCompare(true);
  settingsOpen = false;
  qEl.value = '';
  type = 'all';
  detail = null;
  results = [];
  idx = 0;
  render();
}
companion.onOpen((info) => {
  if (closedAt && Date.now() - closedAt >= FORGET_AFTER_MS && (qEl.value || detail || cmp)) forgetSearch();
  stopIconShake(); // the bar is open: the icon has been found
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
// The theme: its colours and fonts are in the stylesheet; the icons are pictures, so each theme has its own.
const THEME_ICONS = { eclipse: { icon: 'icon-eclipse.png', mining: 'mining-icon-eclipse.svg' } };
function applyTheme(theme) {
  document.body.classList.toggle('theme-eclipse', theme === 'eclipse');
  const icons = THEME_ICONS[theme] || { icon: 'icon.png', mining: 'mining-icon.svg' };
  for (const id of ['dock', 'ghost']) {
    const img = id === 'dock' ? $('dock').querySelector('img') : $('ghost');
    if (img && !img.src.endsWith(icons.icon)) img.src = icons.icon;
  }
  const mine = $('mine-btn')?.querySelector('img');
  if (mine && !mine.src.endsWith(icons.mining)) mine.src = icons.mining;
  // Text widths change with the fonts: measure again.
  widthPending = true;
  fit();
}
applyTheme(new URLSearchParams(location.search).get('theme'));
companion.onTheme?.(applyTheme);
companion.onGameVersion(({ live }) => renderPu(live));
companion.onHotkeyRecorder(startRecorder);
// The hotkey shown in the bar opens the recorder too.
$('hotkey').addEventListener('click', () => startRecorder());

// The icon shakes to be noticed: a ring every few seconds until the player opens the bar by hand, with a
// steady glow too if they have never opened it ('unseen'), without it on later launches ('launch').
let shakeTimer = null;
function stopIconShake() {
  clearInterval(shakeTimer);
  shakeTimer = null;
  dockEl.classList.remove('shake', 'attract');
}
function shakeIcon() {
  dockEl.classList.remove('shake');
  void dockEl.offsetWidth; // restart the animation
  dockEl.classList.add('shake');
}
companion.onDocked(({ opacity, attention }) => {
  closedAt = Date.now();
  closeCompare(true);
  body.classList.remove('unfolding', 'folding');
  body.classList.add('docked');
  applyLayoutVars(opacity);
  stopIconShake();
  if (!attention) return;
  dockEl.classList.toggle('attract', attention === 'unseen');
  setTimeout(shakeIcon, 600);
  shakeTimer = setInterval(shakeIcon, 2800);
});

// The icon: the main process decides click (open) or drag (move) from the real cursor.
const dockEl = $('dock');
dockEl.addEventListener('animationend', (ev) => { if (ev.animationName === 'iconShake') dockEl.classList.remove('shake'); });
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
  barState.updating = false;
  paintBarState();
  render();
  $('dbinfo').textContent = ok ? 'Database updated — reloading…' : 'Some sources failed to update; previous data kept.';
  load();
});

async function load() {
  const [raw, cfg] = await Promise.all([companion.loadDb(), companion.config()]);
  CompanionI18n.setLanguage(cfg.language);
  translateStatic();
  setupMiningButton();
  maxHeight = cfg.maxHeight;
  zoom = cfg.zoom || 1;
  applyLayoutVars(cfg.dockOpacity);
  sendGeometry();
  $('hotkey').textContent = $('hotkey2').textContent = cfg.hotkey;
  const db = JSON.parse(raw);
  db.entries.push({ ...MINING_ENTRY, s: tr(MINING_ENTRY.s) }); // part of the app, not of the data: it works with any database
  CompanionSearch.labelArmors(db.entries);
  index = CompanionSearch.buildIndex(db.entries);
  dbEntries = db.entries;
  applyLiveCommodities(await companion.commoditiesLive());
  itemByName = new Map(db.entries.filter((x) => x.t === 'item').map((x) => [x.n, x]));
  // The pinned signature lists: every mineral with its kind, signature and 1×–10× values.
  companion.pinRows(db.entries.filter((x) => x.t === 'mineral').map((x) => ({ n: x.n, tier: x.d.tier, category: x.d.category, sig: x.d.signature || 0, rs: x.d.rs })));
  const total = Object.values(db.meta.counts).reduce((a, b) => a + b, 0);
  const sources = Object.entries(db.meta.sources).filter(([, s]) => s);
  const oldest = sources.map(([, s]) => s.fetchedAt.slice(0, 10)).sort()[0];
  barState.loading = false;
  barState.error = false;
  paintBarState();
  recordsTotal = total;
  $('dbinfo').textContent = tr('{records} records', { records: fmt(total) });
  dataDate = oldest;
  gameVersion = db.meta.gameVersion || null;
  dataBuiltAt = db.meta.builtAt || null;
  renderPu(cfg.liveGameVersion);
  $('dbinfo').title = sources.map(([k, s]) => `${k}: ${s.fetchedAt.slice(0, 10)}`).join('\n');
  search();
  qEl.focus();
}

fit();
load()
  .catch((err) => { barState.loading = false; barState.error = true; paintBarState(); $('dbinfo').textContent = `Could not load the database: ${err.message}`; })
  .finally(() => companion.ready());
