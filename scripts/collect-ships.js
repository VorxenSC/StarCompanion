// Ships and components: specs + default loadout from the Star Citizen Wiki API, in-game
// buy/sell/rent prices per terminal from UEX Corp (the public price API spviewer.eu also uses).
const { getJson, pool, writeRaw, progress } = require('./lib/http');

const WIKI = 'https://api.star-citizen.wiki/api/v2';
const UEX = 'https://api.uexcorp.uk/2.0';
const en = (d) => (d && typeof d === 'object' ? d.en_EN || Object.values(d)[0] : d) || null;

async function wikiVehicles() {
  const url = (n) => `${WIKI}/vehicles?page%5Bsize%5D=50&page%5Bnumber%5D=${n}`;
  const first = await getJson(url(1));
  const pages = Array.from({ length: (first.meta?.last_page || 1) - 1 }, (_, i) => i + 2);
  const rest = await pool(pages, 3, (n) => getJson(url(n)), { delayMs: 100, onProgress: progress('vehicles') });
  if (rest.some((r) => r.error)) throw new Error('vehicles: some pages failed');
  return [first, ...rest].flatMap((r) => r.data);
}

function flattenPorts(ports, out = []) {
  for (const p of ports || []) {
    const it = p.equipped_item;
    if (it && it.name && !/^(<=|PLACEHOLDER)/.test(it.name)) {
      out.push({ port: p.category_label || p.type, item: it.name, type: it.type, size: it.size, grade: it.grade, manufacturer: it.manufacturer?.name });
    }
    flattenPorts(p.ports, out);
  }
  return out;
}

// RSI pledge store listings (USD), as imported daily by the wiki from robertsspaceindustries.com.
// The standalone-ship SKU is the one the store's "Standalone Ships" page shows; others are upgrades/packs.
function rsiStore(v) {
  const skus = (v.skus || []).filter((s) => s.source === 'pledge_store' && s.price != null);
  if (!skus.length) return null;
  const rank = (s) => (/\/Standalone-Ships\//i.test(s.url) ? 0 : s.is_warbond ? 1 : s.is_package ? 3 : 2);
  skus.sort((a, z) => rank(a) - rank(z) || a.price - z.price);
  return skus.slice(0, 4).map((s) => ({
    title: s.title,
    usd: s.price,
    discountedUsd: s.discounted_price,
    warbond: !!s.is_warbond,
    pack: !!s.is_package,
    available: !!s.available,
    url: s.url,
    checked: s.imported_at?.slice(0, 10),
  }));
}

const LOADOUT_TYPES = /WeaponGun|Shield|PowerPlant|Cooler|QuantumDrive|Turret|MissileLauncher|Radar|WeaponMining|TractorBeam|SalvageHead|Missile/;

async function main() {
  const [vehicles, itemPrices, buyPrices, rentPrices, terminals] = await Promise.all([
    wikiVehicles(),
    getJson(`${UEX}/items_prices_all`),
    getJson(`${UEX}/vehicles_purchases_prices_all`),
    getJson(`${UEX}/vehicles_rentals_prices_all`),
    getJson(`${UEX}/terminals`),
  ]);

  const termById = new Map(
    terminals.data.map((t) => [
      t.id,
      [t.star_system_name, t.planet_name, t.moon_name, t.city_name || t.space_station_name || t.outpost_name].filter(Boolean),
    ]),
  );
  // Terminal path (system - planet - moon - city/station) followed by the shop name from the price row.
  const where = (id, shop) => {
    const parts = [...(termById.get(id) || []), shop].filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(' - ');
  };

  const ships = vehicles
    .filter((v) => !/_Display$|_Template|_AI_|_PU_AI|Unmanned/i.test(v.class_name || ''))
    .map((v) => ({
      uuid: v.uuid,
      name: v.game_name || v.name,
      shortName: v.name,
      manufacturer: v.manufacturer?.name,
      career: v.career,
      role: v.role,
      size: en(v.size),
      sizeClass: v.size_class,
      crew: v.crew,
      cargo: v.cargo_capacity,
      health: v.health,
      shieldHp: v.shield_hp,
      speed: v.speed && { scm: v.speed.scm, max: v.speed.max },
      pilotDps: v.weaponry?.pilot_dps,
      quantumRange: v.quantum?.quantum_range,
      msrp: v.msrp,
      pledgeUrl: v.pledge_url,
      store: rsiStore(v),
      status: en(v.production_status),
      isVehicle: v.is_vehicle,
      description: en(v.description) || en(v.game_description),
      loadout: flattenPorts(v.ports).filter((p) => LOADOUT_TYPES.test(p.type || '')),
    }));

  const shipBuy = buyPrices.data.map((p) => ({ name: p.vehicle_name, where: where(p.id_terminal, p.terminal_name), price: p.price_buy, updated: p.date_modified }));
  const shipRent = rentPrices.data.map((p) => ({ name: p.vehicle_name, where: where(p.id_terminal, p.terminal_name), price: p.price_rent, updated: p.date_modified }));
  const items = itemPrices.data.map((p) => ({
    name: p.item_name,
    uuid: p.item_uuid,
    where: where(p.id_terminal, p.terminal_name),
    buy: p.price_buy || null,
    sell: p.price_sell || null,
    updated: p.date_modified,
  }));

  writeRaw('ships.json', {
    source: 'https://api.star-citizen.wiki + https://uexcorp.space',
    fetchedAt: new Date().toISOString(),
    ships,
    shipBuy,
    shipRent,
    itemPrices: items,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
