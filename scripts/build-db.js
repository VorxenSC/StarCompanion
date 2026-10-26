// Merge the raw source dumps in data/raw into one searchable database: app/data/db.json.
// Entry shape: { id, t: type, n: name, s: subtitle, d: details }
const fs = require('fs');
const path = require('path');

const { RAW_DIR: RAW } = require('./lib/http');
const OUT = process.env.SC_DATA_DIR ? path.join(process.env.SC_DATA_DIR, 'db.json') : path.join(__dirname, '..', 'app', 'data', 'db.json');

const load = (f) => {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) {
    console.warn(`missing ${f} — skipped (run its collector)`);
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"'`’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const craft = load('craft.json');
const miner = load('miner.json');
const cstone = load('cstone.json');
const wiki = load('wiki.json');
const ships = load('ships.json');
const market = load('market.json');
const commodities = load('commodities.json');
const factions = load('factions.json');
const wikiImages = load('images.json')?.images || {};
// Hand-written notes (where players find things, systems): scripts/curated/*.json, shipped with the app.
const CURATED = path.join(__dirname, 'curated');
const curated = (f) => (fs.existsSync(path.join(CURATED, f)) ? JSON.parse(fs.readFileSync(path.join(CURATED, f), 'utf8')) : null);
const tips = curated('tips.json');
const commodityNames = new Set((commodities?.commodities || []).map((c) => norm(c.name)));

// Placeholder text the game files carry where a real value is missing ("<= PLACEHOLDER =>", "[PH] …").
const isJunk = (v) => typeof v === 'string' && /PLACEHOLDER|UNINITIALIZED|^\s*<=|^\s*\[PH\]/i.test(v);
const clean = (v) => (isJunk(v) ? undefined : v);
// Medals come in three conditions; only the Pristine one is worth showing (the others are worn copies).
const isWornMedal = (name) => /\bmedal\b/i.test(name) && /\((worn|damaged)\)\s*$/i.test(name);
// A colour or edition in quotes marks a variant: Parallax "Sunstone" Energy Assault Rifle → Parallax Energy Assault Rifle.
const baseName = (name) => name.replace(/\s*["“][^"”]+["”]\s*/, ' ').replace(/\s+/g, ' ').trim();

// Mission texts keep the game's fill-in tokens ([TargetName], [Location|Address], <EM4>…). In game they
// become the contract's real target and place; here they read as plain words.
const MISSION_TOKENS = [
  [/^(targetname\d*|ambushtarget|target)$/, 'the target'],
  [/^(location\d*|defendlocationwrapperlocation|location\|target)$/, 'the contract location'],
  [/^nearbylocation$/, 'a nearby location'],
  [/^(destination\d*|destination\|target)$/, 'the destination'],
  [/^dropoff\d*$/, 'the drop-off point'],
  [/^pickup\d*$/, 'the pickup point'],
  [/^item\d*$/, 'the item'],
  [/^system$/, 'the system'],
  [/^ship$/, 'the ship'],
  [/^creature$/, 'the creature'],
  [/^contractor$/, 'the contractor'],
  [/^scripamount$/, 'the scrip'],
  [/^approvalcode$/, 'the approval code'],
  [/^(amounttoscan\d*)$/, 'the required number of'],
  [/^missingpersonlist$/, 'the missing people'],
  [/^(hydrogenfuel|qtfuelrate|fuelrate)$/, 'the requested fuel'],
  [/^hint_(\w+)$/, null],
];
function cleanMissionText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<\/?EM\d*>|<None>|<= ?UNINITIALIZED ?=>/gi, '')
    .replace(/~\w+\(([^)]*)\)/g, 'the requester')
    .replace(/\[([^\]]+)\]/g, (whole, inner) => {
      const parts = inner.toLowerCase().split('|');
      const key = parts.length > 2 ? parts.slice(0, 2).join('|') : parts[0];
      if (parts.includes('serialnumber')) return 'the serial number';
      if (parts.includes('signoff')) return '';
      if (parts[0] === 'contractor' && parts[1]) return 'the details in the contract';
      if (parts.includes('listall')) return 'each listed destination';
      for (const [re, words] of MISSION_TOKENS) {
        const m = re.exec(key) || re.exec(parts[0]);
        if (m) return words ?? m[1].replace(/_/g, ' ').toLowerCase();
      }
      return inner.includes('|') || /^[A-Z][A-Za-z0-9_]+$/.test(inner) ? inner.split('|')[0].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase() : whole;
    })
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const entries = [];
const add = (e) => { e.id = `${e.t}:${entries.length}`; entries.push(e); return e; };
// cstone dates use the in-game calendar, 930 years ahead of the real one (2956 = 2026).
const realDate = (d) => (d && /^\d{4}-/.test(d) && +d.slice(0, 4) > 2900 ? `${+d.slice(0, 4) - 930}${d.slice(4)}` : d);
const isoDay = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : undefined);

// ---------- Ships (wiki specs + UEX buy/rent prices + cstone shops) ----------
const shipByName = new Map();
for (const s of ships?.ships || []) {
  const e = {
    t: 'ship',
    n: s.name,
    s: [s.manufacturer, s.career, s.role].filter(Boolean).join(' · '),
    d: { ...s, buy: [], rent: [], wikiUrl: `https://starcitizen.tools/${encodeURIComponent(s.shortName.replace(/ /g, '_'))}` },
  };
  for (const k of [s.name, s.shortName]) if (!shipByName.has(norm(k))) shipByName.set(norm(k), e);
}
for (const p of ships?.shipBuy || []) shipByName.get(norm(p.name))?.d.buy.push({ where: p.where, price: p.price, verified: isoDay(p.updated), src: 'uex' });
for (const p of ships?.shipRent || []) shipByName.get(norm(p.name))?.d.rent.push({ where: p.where, price: p.price, verified: isoDay(p.updated), src: 'uex' });

// ---------- Items: cstone (shops) + wiki (metadata) + scminer mining gear, merged by name ----------
const items = new Map();
const itemFor = (name) => {
  const key = norm(name);
  if (!key) return null;
  if (!items.has(key)) items.set(key, { t: 'item', n: name, s: '', d: { shops: [], sources: [] } });
  return items.get(key);
};

for (const c of cstone?.items || []) {
  if (isWornMedal(c.name)) continue;
  const ship = shipByName.get(norm(c.name));
  if (ship) {
    ship.d.cstoneUrl = `https://finder.cstone.space/Search/${c.id}`;
    const known = new Set(ship.d.buy.map((b) => norm(b.where)));
    for (const s of c.shops || []) if (!known.has(norm(s.location))) ship.d.buy.push({ where: s.location, price: s.price, verified: realDate(s.verified), src: 'cstone' });
    continue;
  }
  const it = itemFor(c.name);
  if (!it) continue;
  it.d.sources.push('cstone');
  it.d.cstoneUrl = `https://finder.cstone.space/Search/${c.id}`;
  if (c.category) it.d.category = c.category;
  const attrs = Object.fromEntries(Object.entries(c.attrs || {}).filter(([, v]) => !isJunk(v)));
  if (Object.keys(attrs).length) it.d.attrs = attrs;
  if (c.description) it.d.description = c.description;
  for (const s of c.shops || []) it.d.shops.push({ where: s.location, price: s.price, verified: realDate(s.verified), src: 'cstone' });
}

// Placeholders and raw class names (e.g. "paint_cutlass_black_procyon") are not player-facing items.
const JUNK_WIKI = /^(<=|PLACEHOLDER|\[)|^[a-z0-9]+(_[a-z0-9]+)+$/i;
for (const w of wiki?.items || []) {
  if (!w.name || JUNK_WIKI.test(w.name) || isWornMedal(w.name)) continue;
  const it = itemFor(w.name);
  it.d.sources.push('wiki');
  it.d.wikiUrl = w.url;
  if (w.uuid) it.d.uuid = w.uuid; // game uuid: matches UEX items exactly
  it.d.classification = w.classification;
  it.d.type = [w.type, w.subType].filter(Boolean).join(' / ') || undefined;
  if (clean(w.manufacturer)) it.d.manufacturer = w.manufacturer;
  if (w.weapon) it.d.weapon = w.weapon;
  if (w.size != null) it.d.size = w.size;
  if (w.grade) it.d.grade = w.grade;
  if (w.class) it.d.class = w.class;
  if (w.craftable) it.d.craftable = true;
  if (w.lootable) it.d.lootable = true;
  if (!it.d.description && w.description) it.d.description = w.description;
  for (const s of w.shops || []) it.d.shops.push({ where: [s.name, s.location].filter(Boolean).join(' - '), price: s.price, src: 'wiki' });
}

// UEX terminal prices: only for items that already exist, so commodity rows don't become items.
for (const p of ships?.itemPrices || []) {
  const it = items.get(norm(p.name));
  if (!it) continue;
  it.d.sources.push('uex');
  it.d.shops.push({ where: p.where, price: p.buy, sell: p.sell, verified: isoDay(p.updated), src: 'uex' });
}

const gear = miner?.market ? [...miner.market.miningHeads, ...miner.market.modules, ...miner.market.gadgets] : [];
for (const g of gear) {
  const it = itemFor(g.name);
  it.d.sources.push('scminer');
  it.d.minerUrl = 'https://scminer.rocks/data/' + (g.type === 'Gadget' ? 'gadgets' : 'mining-heads');
  if (!it.d.manufacturer && g.manufacturer) it.d.manufacturer = g.manufacturer;
  if (!it.d.category) it.d.category = g.type || 'Mining Laser';
  const cstoneWhere = new Set(it.d.shops.map((s) => norm(s.where)));
  for (const s of g.shops || []) {
    const where = `${s.systemName} - ${s.shopName}`;
    if (!cstoneWhere.has(norm(where))) it.d.shops.push({ where, price: s.buyPrice, verified: s.updatedAt?.slice(0, 10), src: 'scminer' });
  }
}

// ---------- Blueprints (sc-craft.tools) ----------
const bpByName = new Map();
const bpByMission = new Map();
const bpByResource = new Map();
for (const b of craft?.blueprints || []) {
  const e = add({
    t: 'blueprint',
    n: b.name,
    s: b.category,
    d: {
      craftTime: b.craftTime,
      defaultOwned: b.defaultOwned,
      ingredients: b.ingredients,
      itemStats: b.itemStats || undefined,
      missions: b.missions.sort((a, z) => z.chance - a.chance),
      url: `https://sc-craft.tools/?search=${encodeURIComponent(b.name)}`,
    },
  });
  bpByName.set(norm(b.name), e);
  for (const m of b.missions) {
    const k = norm(m.name);
    if (!bpByMission.has(k)) bpByMission.set(k, { name: m.name, bps: [] });
    bpByMission.get(k).bps.push({ name: b.name, chance: m.chance });
  }
  for (const ing of b.ingredients) for (const o of ing.options) {
    const k = norm(o.name);
    if (!bpByResource.has(k)) bpByResource.set(k, new Set());
    bpByResource.get(k).add(b.name);
  }
}

// RSI's Ship Matrix fills components the wiki page leaves out (life support, a radar…); grade and class
// come from the wiki's data for that item. Generic names ("radar", "power plant") are RSI placeholders.
const wikiItemByName = new Map((wiki?.items || []).map((w) => [norm(w.name), w]));
const matrixByName = new Map();
for (const r of ships?.rsiMatrix || []) for (const k of [r.name, `${r.manufacturer} ${r.name}`]) matrixByName.set(norm(k), r);
const GENERIC_PART = /^(radar|power plants?|coolers?|shield generators?|quantum drives?|jump modules?|life support|tbd)$/;
for (const ship of new Set(shipByName.values())) {
  const m = matrixByName.get(norm(ship.d.shortName)) || matrixByName.get(norm(ship.n));
  if (!m) continue;
  const have = new Set((ship.d.loadout || []).map((l) => `${l.type}|${norm(l.item)}`));
  for (const c of m.components) {
    if (GENERIC_PART.test(norm(c.name)) || have.has(`${c.type}|${norm(c.name)}`)) continue;
    const w = wikiItemByName.get(norm(c.name));
    for (let i = 0; i < c.count; i++) {
      (ship.d.loadout ||= []).push({ type: c.type, item: c.name, size: c.size ?? w?.size ?? null, grade: w?.grade || null, class: w?.class || null, manufacturer: w?.manufacturer || null, mount: null, src: 'rsi' });
    }
    have.add(`${c.type}|${norm(c.name)}`);
  }
}

for (const ship of new Set(shipByName.values())) {
  ship.d.wikiImage = wikiImages[ship.d.shortName] || wikiImages[ship.n];
  ship.d.buy.sort((a, z) => (a.price || 0) - (z.price || 0));
  ship.d.rent.sort((a, z) => (a.price || 0) - (z.price || 0));
  add(ship);
}

// UEX player marketplace: every item with a UEX id links to its filtered marketplace page; items
// listed right now also get the approximate asking price. Matched by game uuid, else by name.
// Community notes on where to find things: matched by exact name, or by the base name for variants.
const tipsByName = new Map((tips?.tips || []).flatMap((t) => t.names.map((n) => [norm(n), t])));
const tipFor = (name) => {
  const t = tipsByName.get(norm(name)) || tipsByName.get(norm(baseName(name)));
  return t ? t.notes : undefined;
};
// UEX sometimes lists one game item twice: an older entry without the game uuid, spelled a little
// differently ("Torrent Compensator 2"), and a newer one with it ("Torrent Compensator2"). Players may
// list under either, so all entries whose names match once spaces are ignored count as the same item.
const flat = (s) => norm(s).replace(/ /g, '');
const uexByUuid = new Map();
const uexByFlatName = new Map();
for (const u of market?.items || []) {
  if (u.uuid) uexByUuid.set(u.uuid, u);
  const k = flat(u.name);
  if (!uexByFlatName.has(k)) uexByFlatName.set(k, []);
  uexByFlatName.get(k).push(u);
}
// The entry to use for an item: the one with the most open sell offers, else the uuid match, else the
// first name match. Its id is what the marketplace link opens.
function uexFor(it) {
  const byUuid = it.d.uuid && uexByUuid.get(it.d.uuid);
  const candidates = [...new Set([byUuid, ...(uexByFlatName.get(flat(it.n)) || []), ...(byUuid ? uexByFlatName.get(flat(byUuid.name)) || [] : [])].filter(Boolean))];
  const listed = candidates.filter((u) => market.market[u.id]).sort((a, z) => market.market[z.id].sellCount - market.market[a.id].sellCount);
  return { uex: listed[0] || byUuid || candidates[0], all: candidates };
}

for (const it of items.values()) {
  if (shipByName.has(norm(it.n))) continue; // wiki lists ships as items too; the ship entry wins
  // The wiki's cargo item for a commodity ("Laranite", Cargo / Cargo) is replaced by the commodity entry.
  if (commodityNames.has(norm(it.n)) && /cargo/i.test(it.d.type || '') && !it.d.shops?.length) continue;
  const { uex, all } = uexFor(it);
  if (uex) {
    it.d.uexId = uex.id;
    const company = all.map((u) => clean(u.company)).find(Boolean);
    if (!it.d.manufacturer && company) it.d.manufacturer = company;
    if (uex.image) it.d.image = uex.image; // shown when cstone has no picture
    if (market.market[uex.id]) it.d.market = market.market[uex.id];
  }
  delete it.d.uuid;
  if (isJunk(it.d.manufacturer)) delete it.d.manufacturer;
  // Pictures when cstone has none: the wiki page's image, then a player's photo from a UEX offer.
  if (wikiImages[it.n]) it.d.wikiImage = wikiImages[it.n];
  if (it.d.market?.photo) it.d.playerPhoto = it.d.market.photo;
  if (it.d.market) delete it.d.market.photo;
  const tip = tipFor(it.n);
  if (tip) it.d.tips = tip;
  const bp = bpByName.get(norm(it.n));
  if (bp) it.d.blueprint = bp.id;
  // Same shop reported by several sources: keep the first (cstone > wiki > uex > scminer order of insertion).
  const seen = new Set();
  it.d.shops = it.d.shops.filter((s) => {
    const k = norm(s.where);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  it.d.sources = [...new Set(it.d.sources)];
  it.s = it.d.category || it.d.classification || it.d.type || '';
  if (!it.d.shops.length) delete it.d.shops;
  add(it);
}

// ---------- Missions: wiki missions + blueprint rewards from sc-craft ----------
const seenMission = new Set();
for (const m of wiki?.missions || []) {
  const k = norm(m.title);
  const rewards = bpByMission.get(k)?.bps;
  const dupKey = `${k}|${m.giver}|${m.rewardMin}`;
  if (seenMission.has(dupKey)) continue;
  seenMission.add(dupKey);
  add({
    t: 'mission',
    n: cleanMissionText(m.title),
    s: [m.giver || m.faction, (m.systems || []).join(', ')].filter(Boolean).join(' · '),
    d: { ...m, description: cleanMissionText(m.description), faction: clean(m.faction), giver: clean(m.giver), minStanding: clean(m.minStanding), blueprints: rewards || undefined },
  });
}
const wikiMissionKeys = new Set((wiki?.missions || []).map((m) => norm(m.title)));
for (const [k, v] of bpByMission) {
  if (wikiMissionKeys.has(k)) continue;
  add({ t: 'mission', n: v.name, s: 'Blueprint reward', d: { blueprints: v.bps } });
}

// ---------- Minerals (scminer.rocks) ----------
const priceByMineral = new Map((miner?.market?.minerals || []).map((m) => [norm(m.name), m]));
for (const m of miner?.minerals || []) {
  const market = priceByMineral.get(norm(m.name));
  add({
    t: 'mineral',
    n: m.name,
    s: `${m.tier} · ${m.category === 'ship' ? 'Ship mining' : m.category === 'vehicle' ? 'ROC / vehicle' : m.category === 'fps' ? 'Hand mining' : m.category}`,
    d: {
      tier: m.tier,
      category: m.category,
      signature: m.scanSignature,
      props: m.props,
      locations: m.locations,
      bestSell: market ? { price: market.bestSellPricePerScu, where: market.bestTerminal } : undefined,
      commodity: commodityNames.has(norm(m.name)) || undefined, // trade prices and demand per terminal
      usedIn: bpByResource.has(norm(m.name)) ? [...bpByResource.get(norm(m.name))].slice(0, 60) : undefined,
      usedInCount: bpByResource.get(norm(m.name))?.size,
      url: `https://scminer.rocks/data/mineral-directory?search=${encodeURIComponent(m.name)}`,
    },
  });
}

// ---------- Commodities (UEX): price, stock and demand per trade terminal ----------
const mineralNames = new Set((miner?.minerals || []).map((m) => norm(m.name)));
for (const c of commodities?.commodities || []) {
  const tags = [c.kind, c.illegal && 'illegal', c.volatile && 'volatile', c.explosive && 'explosive'].filter(Boolean);
  add({
    t: 'commodity',
    n: c.name,
    s: tags.join(' · '),
    d: {
      code: c.code,
      illegal: c.illegal,
      mineral: mineralNames.has(norm(c.name)), // links to the mining entry
      locations: c.locations.map((l) => ({ ...l, updated: isoDay(l.updated) })),
      wikiUrl: c.wiki,
      url: `https://uexcorp.space/commodities/info/name/${encodeURIComponent(c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}/`,
    },
  });
}

// ---------- Locations (wiki) ----------
for (const l of wiki?.locations || []) {
  if (!l.name || isJunk(l.name)) continue;
  add({ t: 'location', n: l.name, s: [l.type, l.parent, l.system].filter(Boolean).join(' · '), d: l });
}

// ---------- Factions (wiki): who they are and their reputation ladder ----------
for (const f of factions?.factions || []) {
  add({
    t: 'faction',
    n: f.name,
    s: [f.type, f.area, f.focus].filter(Boolean).join(' · '),
    d: { ...f, url: `https://starcitizen.tools/${encodeURIComponent(f.name.replace(/ /g, '_'))}` },
  });
}

// ---------- Systems: hand-written overviews (the map comes with the overview) ----------
// Each planet with its moons and landing zones, from the wiki's location tree.
const childrenOf = (parent, re) => (wiki?.locations || []).filter((l) => l.parent === parent && re.test(l.type || '') && !isJunk(l.name)).map((l) => l.name);
for (const sys of curated('systems.json')?.systems || []) {
  const overview = {
    star: sys.star,
    summary: sys.summary,
    bodies: sys.planets.map((name) => ({ name, moons: childrenOf(name, /^Moon$/), zones: childrenOf(name, /^LandingZone$/) })),
    stations: [...new Set(childrenOf(sys.name, /^Manmade$/))].filter((n) => !/^(Asteroid|RSI Event)/.test(n)),
    jumpPoints: childrenOf(sys.name, /^Anomaly$/).map((n) => n.replace(new RegExp(`^${sys.name} - `), '').replace(/ ?Jump Point ?/g, ' ').trim()),
  };
  const existing = entries.find((e) => e.t === 'location' && norm(e.n) === norm(sys.name));
  if (existing) {
    existing.d.overview = overview;
    existing.s = `Star system · ${sys.planets.length} planets`;
  } else add({ t: 'location', n: sys.name, s: 'Star system', d: { type: 'Star system', overview } });
}

// ---------- Variants: items and blueprints that differ only by a quoted colour or edition ----------
const families = new Map();
for (const e of entries) {
  if (e.t !== 'item' && e.t !== 'blueprint') continue;
  const base = baseName(e.n);
  const k = `${e.t}|${norm(base)}`;
  if (!families.has(k)) families.set(k, { base, members: [] });
  families.get(k).members.push(e);
}
for (const { base, members } of families.values()) {
  if (members.length < 2) continue;
  const names = members.map((m) => m.n).sort((a, z) => (a === base ? -1 : z === base ? 1 : a.localeCompare(z)));
  for (const m of members) {
    m.d.base = base;
    m.d.variants = names;
  }
}

// ---------- Write ----------
const meta = {
  builtAt: new Date().toISOString(),
  // The Star Citizen PU version the data is for, as UEX reports it (sc-craft/scminer agree on it).
  gameVersion: commodities?.gameVersion || craft?.version?.match(/\d+\.\d+(\.\d+)?/)?.[0] || null,
  sources: {
    'sc-craft.tools': craft && { version: craft.version, fetchedAt: craft.fetchedAt },
    'scminer.rocks': miner && { version: miner.version, fetchedAt: miner.fetchedAt },
    'finder.cstone.space': cstone && { fetchedAt: cstone.fetchedAt },
    'starcitizen.tools': wiki && { fetchedAt: wiki.fetchedAt },
    'uexcorp.space (prices, as used by spviewer)': ships && { fetchedAt: ships.fetchedAt },
    'robertsspaceindustries.com ship matrix': ships?.rsiMatrix?.length ? { fetchedAt: ships.fetchedAt } : undefined,
    'uexcorp.space marketplace': market && { fetchedAt: market.fetchedAt },
  },
  counts: entries.reduce((acc, e) => ((acc[e.t] = (acc[e.t] || 0) + 1), acc), {}),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ meta, entries }));
console.log(meta.counts, `${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB -> ${OUT}`);
