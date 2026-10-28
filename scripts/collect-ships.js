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

// RSI pledge store listings (USD), as imported daily by the wiki from robertsspaceindustries.com.
// The standalone-ship SKU is the one the store's "Standalone Ships" page shows; others are upgrades/packs.
// Warbond = a discounted offer that can only be paid with new money (not store credit); it is the
// standalone page's "-Warbond" twin. All offers are kept (on sale first) so a live warbond is never cut.
function rsiStore(v) {
  const skus = (v.skus || []).filter((s) => s.source === 'pledge_store' && s.price != null);
  if (!skus.length) return null;
  const standalone = (s) => /\/Standalone-Ships\//i.test(s.url);
  const rank = (s) => (s.available ? 0 : 10) + (standalone(s) ? 0 : s.is_package ? 3 : 2) + (s.is_warbond ? 1 : 0);
  skus.sort((a, z) => rank(a) - rank(z) || a.price - z.price);
  return skus.slice(0, 12).map((s) => ({
    title: s.title,
    usd: s.price,
    discountedUsd: s.discounted_price,
    warbond: !!s.is_warbond,
    pack: !!s.is_package,
    standalone: standalone(s),
    available: !!s.available,
    url: s.url,
    checked: s.imported_at?.slice(0, 10),
  }));
}

// The default loadout as erkul.games and the RSI ship page show it: guns (with the mount they sit on),
// missiles and bombs (with their rack), and the components with size, grade (A–D) and class. It comes
// from each ship's own wiki page (the vehicle list leaves out what sits inside turrets and racks).
const LOADOUT_KEEP = /^(WeaponGun|Missile|Bomb|Shield|PowerPlant|Cooler|QuantumDrive|JumpDrive|Radar|LifeSupportGenerator|TractorBeam|WeaponMining|SalvageHead|WeaponDefensive|EMP|QuantumInterdictionGenerator)$/;
const MOUNTS = /^(Turret|TurretBase|MissileLauncher|BombLauncher|ToolArm|UtilityTurret)$/;
const junkName = (n) => !n || /PLACEHOLDER|^<=|^\[|_subitem_/.test(n);

// Who fires a weapon, from the ship's top-level port it hangs under: the pilot's guns and missile racks
// ("Turrets", "Weapons", "Missile & Bomb Racks"), a crew member in a manned turret, or a crew member
// operating a remote turret from a seat inside. Ports the wiki files under "Other" fall back on the
// hardpoint's name: wing and nose guns are the pilot's, turrets and door guns ("weapon") a crew member's.
function controlOf(category, port) {
  if (/manned turret/i.test(category || '')) return 'manned';
  if (/remote turret/i.test(category || '')) return 'remote';
  if (/turret|weapon|gun|missile|bomb/i.test(category || '')) return 'pilot';
  if (/turret/i.test(port || '') || port === 'weapon') return 'manned';
  if (/^hardpoint_(weapon|gun|missile)/i.test(port || '')) return 'pilot';
  return null;
}

function loadoutOf(ports, mount = null, out = [], control = undefined) {
  for (const p of ports || []) {
    const it = p.equipped_item;
    if (!it) continue;
    const named = !junkName(it.name);
    const by = control === undefined ? controlOf(p.category_label, p.name) : control; // null: let inner ports decide
    if (named && LOADOUT_KEEP.test(it.type || '')) {
      out.push({
        type: it.type,
        item: it.name,
        size: it.size ?? null,
        // Grades are letters for ship components; weapons carry a meaningless default, so only
        // components that also have a class (Civilian, Military…) keep theirs.
        grade: it.class && /^[A-D]$/.test(String(it.grade)) ? String(it.grade) : null,
        class: it.class || null,
        manufacturer: junkName(it.manufacturer?.name) || it.manufacturer?.name === 'Unknown' ? null : it.manufacturer.name,
        mount,
        control: /WeaponGun|Missile|Bomb|EMP/.test(it.type || '') ? by : undefined,
      });
    }
    loadoutOf(p.ports || it.ports, named && MOUNTS.test(it.type || '') ? it.name : mount, out, by ?? undefined);
  }
  return out;
}

// RSI's Ship Matrix: the specs the RSI ship pages show, all ships in one public JSON file. It names the
// components (not the guns inside turrets, nor grades), so it only fills what the wiki page lacks.
const RSI_MATRIX = 'https://robertsspaceindustries.com/ship-matrix/index';
const MATRIX_TYPES = { shield_generators: 'Shield', power_plants: 'PowerPlant', coolers: 'Cooler', quantum_drives: 'QuantumDrive', jump_modules: 'JumpDrive', radar: 'Radar', life_support: 'LifeSupportGenerator' };
async function rsiMatrix() {
  try {
    const res = await getJson(RSI_MATRIX);
    return (res.data || []).map((r) => ({
      name: r.name,
      manufacturer: r.manufacturer?.name || null,
      components: Object.values(r.compiled || {}).flatMap((group) => Object.entries(group).flatMap(([key, list]) =>
        MATRIX_TYPES[key] ? list.filter((c) => c.name).map((c) => ({ type: MATRIX_TYPES[key], name: c.name, size: Number(c.size) || null, count: (Number(c.mounts) || 1) * (Number(c.quantity) || 1) })) : [])),
    }));
  } catch (err) {
    console.warn(`RSI ship matrix unavailable (${err.message}); loadouts come from the wiki alone`);
    return [];
  }
}

// The wiki's vehicle detail beyond the loadout, kept compact and without empty values: size and mass, crew and
// seats, speed and turn rates, fuel, the quantum drive, insurance, signatures, armour and shield. Units as the
// wiki's own pages give them: metres, kg, m/s, °/s, minutes for the insurance, Mm/s and Gm for quantum.
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const prune = (o) => {
  for (const k of Object.keys(o)) if (o[k] == null || (typeof o[k] === 'object' && !Array.isArray(o[k]) && !Object.keys(o[k]).length) || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return Object.keys(o).length ? o : undefined;
};
function shipSpecs(d) {
  const sz = d.sizes || d.dimension || {};
  const s = d.speed || {};
  const a = d.agility || {};
  const q = d.quantum || {};
  const f = d.fuel || {};
  const ins = d.insurance || {};
  const ar = d.armor || {};
  const sh = d.shield || {};
  const em = d.emission || {};
  // The wiki shows the signatures with the armour's multiplier applied.
  const times = (v, m) => num(typeof v === 'number' ? v * (typeof m === 'number' ? m : 1) : null);
  const cut = (m) => (typeof m === 'number' ? num((1 - m) * 100) : null); // damage multiplier → % taken off
  return prune({
    dims: prune({ length: num(sz.length, 1), beam: num(sz.beam ?? sz.width, 1), height: num(sz.height, 1) }),
    mass: prune({ hull: num(d.mass_hull ?? d.mass), loadout: num(d.mass_loadout), total: num(d.mass_total) }),
    crew: prune({ min: d.crew?.min, max: d.crew?.max, weapon: d.crew?.weapon, operation: d.crew?.operation }),
    seats: prune({ ejection: d.seating?.ejection_seats || null, pods: d.seating?.escape_pods || null, jump: d.seating?.jump_seats || null, beds: d.seating?.beds || null, medBeds: d.seating?.medical_beds || null }),
    medTier: d.max_medical_tier || null,
    ore: num(d.ore_capacity, 1) || null,
    storage: num((d.vehicle_inventory || 0) / 1e6, 2) || null, // µSCU → SCU
    speed: prune({ scm: num(s.scm), max: num(s.max), boostFwd: num(s.boost_forward), boostBack: num(s.boost_backward), toScm: num(s.zero_to_scm, 1), toMax: num(s.zero_to_max, 1), stopScm: num(s.scm_to_zero, 1), stopMax: num(s.max_to_zero, 1) }),
    turn: prune({ pitch: num(a.pitch), yaw: num(a.yaw), roll: num(a.roll), pitchBoost: num(a.pitch_boosted), yawBoost: num(a.yaw_boosted), rollBoost: num(a.roll_boosted) }),
    fuel: prune({ hydrogen: num(f.capacity, 1) || null, quantum: num(q.quantum_fuel_capacity, 2) || null }),
    quantum: prune({ speed: num(q.quantum_speed), range: num(q.quantum_range), spool: num(q.quantum_spool_time, 1), trip: prune({ time: num(q.port_olisar_to_arccorp_time), fuel: num(q.port_olisar_to_arccorp_fuel) }) }),
    insurance: prune({ claim: num(ins.claim_time, 1), expedite: num(ins.expedite_time, 1), fee: num(ins.expedite_cost) }),
    signature: prune({ ir: times(em.ir, ar.signal_infrared), emIdle: times(em.em_idle, ar.signal_electromagnetic), emMax: times(em.em_max, ar.signal_electromagnetic), cross: times(d.cross_section_max, ar.signal_cross_section) }),
    armor: prune({ health: num(ar.health), physical: cut(ar.damage_physical), energy: cut(ar.damage_energy), distortion: cut(ar.damage_distortion), thermal: cut(ar.damage_thermal) }),
    shield: prune({ hp: num(sh.hp), regen: num(sh.regeneration), regenTime: num(sh.regeneration_time, 1), face: sh.face_type || null }),
    loaner: Array.isArray(d.loaner) ? d.loaner.map((l) => (typeof l === 'string' ? l : l?.name || l?.shortName || l?.vehicle?.name)).filter(Boolean) : undefined,
  });
}

async function wikiVehicleDetails(vehicles) {
  const results = await pool(vehicles, 3, (v) => getJson(`${WIKI}/vehicles/${encodeURIComponent(v.slug || v.uuid)}`), { delayMs: 150, onProgress: progress('ship loadouts') });
  const byUuid = new Map();
  results.forEach((r, i) => { if (r?.data) byUuid.set(vehicles[i].uuid, r.data); });
  const failed = results.filter((r) => r?.error).length;
  if (failed) console.warn(`${failed} ship pages failed; their loadout falls back to the vehicle list`);
  return byUuid;
}

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

  const kept = vehicles.filter((v) => !/_Display$|_Template|_AI_|_PU_AI|Unmanned/i.test(v.class_name || ''));
  const [details, matrix] = await Promise.all([wikiVehicleDetails(kept), rsiMatrix()]);
  const ships = kept
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
      loadout: loadoutOf((details.get(v.uuid) || v).ports),
      specs: shipSpecs(details.get(v.uuid) || v),
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
    rsiMatrix: matrix,
    itemPrices: items,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
