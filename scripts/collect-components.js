// Ship components in full, for the loadout calculator: what each one draws and generates (power and coolant
// segments), its signatures, and its own figures (a shield's HP and regeneration, a gun's alpha and burst and
// 60-second DPS, a quantum drive's speed). One api.star-citizen.wiki item page per component, listed from the
// wiki dump (collect-wiki.js), so this runs after it.
const fs = require('fs');
const path = require('path');
const { getJson, pool, writeRaw, progress, RAW_DIR } = require('./lib/http');

const API = 'https://api.star-citizen.wiki/api';
// The kinds a ship's loadout slots hold, as the wiki's item type names them.
const TYPES = ['Weapon Gun', 'Shield', 'Power Plant', 'Cooler', 'Quantum Drive', 'Radar', 'Life Support Generator'];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// The few fields the calculator uses, out of a page of several hundred.
function compact(j) {
  const rn = j.resource_network || {};
  const use = rn.usage || {};
  const gen = rn.generation || {};
  const em = j.emission || {};
  const out = {
    uuid: j.uuid,
    name: j.name,
    type: j.type,
    size: num(j.size),
    grade: j.grade || null,
    class: j.class || null,
    power: use.power ? { min: num(use.power.min), max: num(use.power.max) } : null,
    coolant: use.coolant ? { min: num(use.coolant.min), max: num(use.coolant.max) } : null,
    genPower: num(gen.power),
    genCoolant: num(gen.coolant),
    em: num(em.em_max),
    emMin: num(em.em_min),
    ir: num(em.ir),
  };
  if (j.shield) {
    out.shield = { hp: num(j.shield.max_health), regen: num(j.shield.regen_rate), damagedDelay: num(j.shield.regen_delay?.damage), downedDelay: num(j.shield.regen_delay?.downed) };
  }
  const w = j.vehicle_weapon;
  if (w) {
    const dmg = w.damage || {};
    out.weapon = {
      type: w.type || null,
      alpha: num(dmg.alpha_total) ?? num(w.damage_per_shot),
      burst: num(dmg.burst),
      sustained: num(dmg.sustained_60s),
      rpm: num(w.rpm),
      range: num(w.range),
      ammo: num(w.capacity) || null,
    };
  }
  const q = j.quantum_drive;
  if (q) {
    out.quantum = { speed: num(q.standard_jump?.drive_speed), spool: num(q.standard_jump?.spool_up_time), cooldown: num(q.standard_jump?.cooldown_time), fuel: num(q.quantum_fuel_requirement) };
  }
  return out;
}

async function main() {
  const wiki = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'wiki.json'), 'utf8'));
  const list = (wiki.items || []).filter((i) => TYPES.includes(i.type) && i.uuid);
  console.log(`components to read: ${list.length}`);
  const pages = await pool(list, 2, (i) => getJson(`${API}/items/${i.uuid}`), { delayMs: 300, onProgress: progress('components') });
  const components = [];
  let failed = 0;
  for (const p of pages) {
    if (!p?.data) { failed++; continue; }
    components.push(compact(p.data));
  }
  console.log(`read ${components.length}, failed ${failed}`);
  if (!components.length) throw new Error('no component read');
  writeRaw('components.json', { source: API, fetchedAt: new Date().toISOString(), components });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
