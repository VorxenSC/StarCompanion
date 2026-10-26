// sc-craft.tools: crafting blueprints, ingredients, quality effects and mission drops.
const { getJson, writeRaw } = require('./lib/http');

const BASE = 'https://sc-craft.tools/api';

async function main() {
  const stats = await getJson(`${BASE}/stats`);
  const version = stats.version;
  const blueprints = [];
  for (let page = 1; ; page++) {
    const res = await getJson(`${BASE}/blueprints?page=${page}&limit=100&version=${encodeURIComponent(version)}`);
    blueprints.push(...res.items);
    process.stdout.write(`\rblueprints: ${blueprints.length}/${res.pagination.total}   `);
    if (page >= res.pagination.pages) break;
  }
  process.stdout.write('\n');

  const compact = blueprints.map((b) => ({
    id: b.id,
    bpId: b.blueprint_id,
    name: b.name,
    category: b.category,
    craftTime: b.craft_time_seconds,
    tiers: b.tiers,
    itemStats: b.item_stats || null, // base fire rates, mass… the crafting simulator starts from
    defaultOwned: !!b.default_owned,
    ingredients: (b.ingredients || []).map((ing) => ({
      slot: ing.slot,
      options: (ing.options || []).map((o) => ({
        name: o.name,
        qty: o.quantity_scu ?? o.quantity,
        unit: o.unit,
        minQuality: o.min_quality,
      })),
      effects: (ing.quality_effects || []).map((q) => ({
        stat: q.stat,
        min: q.modifier_at_min,
        max: q.modifier_at_max,
        qMin: q.quality_min ?? 0, // the quality range the modifier is spread over
        qMax: q.quality_max ?? 1000,
        kind: q.type || 'multiplicative',
      })),
    })),
    missions: (b.missions || []).map((m) => ({ name: m.name, chance: Number(m.drop_chance) })),
  }));

  writeRaw('craft.json', { source: 'https://sc-craft.tools', version, fetchedAt: new Date().toISOString(), blueprints: compact });
}

main().catch((e) => { console.error(e); process.exit(1); });
