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
const commodityNames = new Set((commodities?.commodities || []).map((c) => norm(c.name)));

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
  if (c.attrs && Object.keys(c.attrs).length) it.d.attrs = c.attrs;
  if (c.description) it.d.description = c.description;
  for (const s of c.shops || []) it.d.shops.push({ where: s.location, price: s.price, verified: realDate(s.verified), src: 'cstone' });
}

// Placeholders and raw class names (e.g. "paint_cutlass_black_procyon") are not player-facing items.
const JUNK_WIKI = /^(<=|PLACEHOLDER|\[)|^[a-z0-9]+(_[a-z0-9]+)+$/i;
for (const w of wiki?.items || []) {
  if (!w.name || JUNK_WIKI.test(w.name)) continue;
  const it = itemFor(w.name);
  it.d.sources.push('wiki');
  it.d.wikiUrl = w.url;
  if (w.uuid) it.d.uuid = w.uuid; // game uuid: matches UEX items exactly
  it.d.classification = w.classification;
  it.d.type = [w.type, w.subType].filter(Boolean).join(' / ') || undefined;
  if (w.manufacturer) it.d.manufacturer = w.manufacturer;
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

for (const ship of new Set(shipByName.values())) {
  ship.d.buy.sort((a, z) => (a.price || 0) - (z.price || 0));
  ship.d.rent.sort((a, z) => (a.price || 0) - (z.price || 0));
  add(ship);
}

// UEX player marketplace: every item with a UEX id links to its filtered marketplace page; items
// listed right now also get the approximate asking price. Matched by game uuid, else by name.
const uexByUuid = new Map();
const uexByName = new Map();
for (const u of market?.items || []) {
  if (u.uuid) uexByUuid.set(u.uuid, u);
  if (!uexByName.has(norm(u.name))) uexByName.set(norm(u.name), u);
}

for (const it of items.values()) {
  if (shipByName.has(norm(it.n))) continue; // wiki lists ships as items too; the ship entry wins
  // The wiki's cargo item for a commodity ("Laranite", Cargo / Cargo) is replaced by the commodity entry.
  if (commodityNames.has(norm(it.n)) && /cargo/i.test(it.d.type || '') && !it.d.shops?.length) continue;
  const uex = (it.d.uuid && uexByUuid.get(it.d.uuid)) || uexByName.get(norm(it.n));
  if (uex) {
    it.d.uexId = uex.id;
    if (market.market[uex.id]) it.d.market = market.market[uex.id];
  }
  delete it.d.uuid;
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
    n: m.title,
    s: [m.giver || m.faction, (m.systems || []).join(', ')].filter(Boolean).join(' · '),
    d: { ...m, blueprints: rewards || undefined },
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
  if (!l.name) continue;
  add({ t: 'location', n: l.name, s: [l.type, l.parent, l.system].filter(Boolean).join(' · '), d: l });
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
    'uexcorp.space marketplace': market && { fetchedAt: market.fetchedAt },
  },
  counts: entries.reduce((acc, e) => ((acc[e.t] = (acc[e.t] || 0) + 1), acc), {}),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ meta, entries }));
console.log(meta.counts, `${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB -> ${OUT}`);
