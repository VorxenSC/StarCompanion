// starcitizen.tools: the Star Citizen Wiki. Its structured data is served by api.star-citizen.wiki.
// Collects items, missions, locations and commodities.
const { getJson, pool, writeRaw, progress } = require('./lib/http');

const API = 'https://api.star-citizen.wiki/api/v2';
const PAGE_SIZE = 200;

async function fetchAll(endpoint) {
  const url = (n) => `${API}/${endpoint}?page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${n}`;
  const first = await getJson(url(1));
  const last = first.meta?.last_page || 1;
  const pages = Array.from({ length: last - 1 }, (_, i) => i + 2);
  const rest = await pool(pages, 3, (n) => getJson(url(n)), { delayMs: 100, onProgress: progress(endpoint) });
  const failed = rest.filter((r) => r.error);
  if (failed.length) throw new Error(`${endpoint}: ${failed.length} pages failed (${failed[0].error})`);
  return [first, ...rest].flatMap((r) => r.data);
}

const en = (d) => (d && typeof d === 'object' ? d.en_EN || Object.values(d)[0] : d) || null;
const realName = (s) => (s && !/PLACEHOLDER|^<=|^\[/.test(s) ? s : null);

// Damage and fire modes of a personal or ship weapon, as the wiki reads them from the game files.
function weaponStats(w) {
  if (!w) return null;
  const damages = (w.damages || []).filter((d) => d.damage > 0).map((d) => ({ kind: d.name, damage: Math.round(d.damage * 100) / 100 }));
  const modes = (w.modes || []).map((m) => ({
    mode: m.mode,
    rpm: m.rpm ?? m.rounds_per_minute ?? null,
    dps: m.damage_per_second ?? null,
    pellets: m.pellets_per_shot ?? null,
  })).filter((m) => m.rpm || m.dps);
  const out = {
    class: w.class || null,
    type: w.type || null,
    perShot: w.damage_per_shot || damages.reduce((a, d) => a + d.damage, 0) || null,
    damages,
    modes,
    magazine: w.magazine_size ?? w.capacity ?? null,
    range: w.effective_range ?? w.range ?? null,
  };
  return out.perShot || modes.length ? out : null;
}

const wikiUrl = (title) => `https://starcitizen.tools/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function main() {
  const items = (await fetchAll('items')).map((i) => ({
    uuid: i.uuid,
    name: i.name,
    className: i.class_name,
    classification: i.classification_label || i.classification,
    type: i.type_label || i.type,
    subType: i.sub_type_label || i.sub_type,
    // Some items carry a placeholder manufacturer; the description data names the real one.
    manufacturer: realName(i.manufacturer?.name) || realName(i.manufacturer_description) || null,
    size: i.size,
    grade: i.grade,
    class: i.class,
    craftable: !!i.is_craftable,
    lootable: !!i.is_lootable,
    description: en(i.description),
    shops: (i.shops || []).map((s) => ({
      name: s.name_raw || s.name,
      location: s.position || s.location || null,
      price: s.items?.[0]?.price_calculated ?? s.price ?? null,
    })),
    uex: i.uex_prices || null,
    weapon: weaponStats(i.personal_weapon || i.vehicle_weapon),
    baseVariant: i.is_base_variant ?? null,
    url: wikiUrl(i.name),
  }));

  const missions = (await fetchAll('missions'))
    .filter((m) => !m.not_for_release && m.title && !m.title.startsWith('['))
    .map((m) => ({
      uuid: m.uuid,
      title: m.title,
      description: m.description,
      giver: m.mission_giver?.name || m.mission_giver || null,
      faction: m.faction?.name || m.faction || null,
      legal: m.legality_label,
      rewardMin: m.reward_min,
      rewardMax: m.reward_max,
      currency: m.reward_currency,
      systems: m.star_systems,
      hasBlueprints: m.has_blueprints,
      combat: m.has_combat,
      hauling: m.has_hauling,
      shareable: m.shareable,
      onceOnly: m.once_only,
      minStanding: m.min_standing_name,
      url: wikiUrl(m.title),
    }));

  const locations = (await fetchAll('locations')).map((l) => ({
    uuid: l.uuid,
    name: l.name,
    type: l.type?.name || l.type || null,
    parent: l.parent?.name || null,
    system: l.star_system?.name || l.system || null,
    description: en(l.description),
    missionCount: l.mission_count,
    url: wikiUrl(l.name),
  }));

  const commodities = (await fetchAll('commodities')).map((c) => ({
    uuid: c.uuid,
    name: c.name,
    kind: c.type?.name || c.type || null,
    description: c.description,
    url: wikiUrl(c.name),
  }));

  writeRaw('wiki.json', { source: 'https://starcitizen.tools', fetchedAt: new Date().toISOString(), items, missions, locations, commodities });
}

main().catch((e) => { console.error(e); process.exit(1); });
