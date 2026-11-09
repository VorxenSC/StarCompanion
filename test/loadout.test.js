const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { totals, budget, choices, SLOTS } = require('../app/renderer/loadout.js');

const gun = (name, alpha, burst, sustained, power = 2, extra = {}) => ({ name, type: 'WeaponGun', size: 3, power: { min: 0, max: power }, coolant: { min: 0, max: 1 }, em: 100, ir: 0, weapon: { alpha, burst, sustained }, ...extra });
const shield = (hp, regen) => ({ name: 'Shield', type: 'Shield', size: 2, power: { min: 2, max: 4 }, coolant: { min: 1, max: 4 }, em: 1000, shield: { hp, regen } });
const plant = (gen) => ({ name: 'Plant', type: 'PowerPlant', size: 2, power: { min: gen, max: gen }, coolant: { min: 5, max: 5 }, genPower: gen, em: 9000 });
const cooler = (gen) => ({ name: 'Cooler', type: 'Cooler', size: 2, power: { min: 3, max: 3 }, coolant: { min: 3, max: 3 }, genCoolant: gen, ir: 7000 });

test('guns add up: alpha, burst and sustained', () => {
  const t = totals([{ slot: 'WeaponGun', comp: gun('A', 40, 500, 300) }, { slot: 'WeaponGun', comp: gun('B', 60, 700, 400) }]);
  assert.strictEqual(t.alpha, 100);
  assert.strictEqual(t.burst, 1200);
  assert.strictEqual(t.sustained, 700);
  assert.strictEqual(t.guns, 2);
});

test('one or two shield generators pool their HP and regeneration', () => {
  const t = totals([{ slot: 'Shield', comp: shield(10000, 500) }, { slot: 'Shield', comp: shield(12000, 600) }]);
  assert.strictEqual(t.shieldHp, 22000);
  assert.strictEqual(t.shieldRegen, 1100);
});

test('beyond two, only the strongest two count, and their regeneration is shared over all fitted', () => {
  const t = totals([{ slot: 'Shield', comp: shield(5000, 100) }, { slot: 'Shield', comp: shield(9000, 300) }, { slot: 'Shield', comp: shield(8000, 200) }]);
  assert.strictEqual(t.shieldHp, 17000);
  assert.strictEqual(t.shieldRegen, (500 * 2) / 3);
  assert.strictEqual(t.shieldsActive, 2);
  assert.strictEqual(t.shieldsFitted, 3);
});

test('power plants generate and the rest draw between their least and their most', () => {
  const t = totals([{ slot: 'PowerPlant', comp: plant(20) }, { slot: 'Shield', comp: shield(1, 1) }, { slot: 'Cooler', comp: cooler(40) }, { slot: 'WeaponGun', comp: gun('A', 1, 1, 1, 5) }]);
  assert.strictEqual(t.powerGen, 20);
  assert.strictEqual(t.powerMin, 2 + 3 + 0);
  assert.strictEqual(t.powerMax, 4 + 3 + 5);
  assert.strictEqual(t.coolGen, 40);
  assert.strictEqual(t.coolMax, 5 + 4 + 1);
});

test('a budget fits, is shared out, or is over', () => {
  assert.strictEqual(budget(5, 10, 12), 'ok');
  assert.strictEqual(budget(5, 14, 12), 'tight');
  assert.strictEqual(budget(13, 14, 12), 'over');
});

test('signatures add up', () => {
  const t = totals([{ slot: 'PowerPlant', comp: plant(20) }, { slot: 'Cooler', comp: cooler(40) }]);
  assert.strictEqual(t.em, 9000);
  assert.strictEqual(t.ir, 7000);
});

test('a part with no figures is named, never counted as zero silently', () => {
  const t = totals([{ slot: 'Shield', comp: null, name: 'Mystery Shield' }, { slot: 'Shield', comp: shield(100, 10) }]);
  assert.strictEqual(t.shieldHp, 100);
  assert.deepStrictEqual(t.missing, ['Mystery Shield']);
});

test('the choices for a slot are the same kind and size', () => {
  const comps = [gun('S3 a', 1, 1, 1), { ...gun('S4', 1, 1, 1), size: 4 }, shield(1, 1), gun('S3 b', 1, 1, 1)];
  assert.deepStrictEqual(choices('WeaponGun', 3, comps).map((c) => c.name), ['S3 a', 'S3 b']);
  assert.deepStrictEqual(choices('Shield', 2, comps).map((c) => c.name), ['Shield']);
});

// Against the ships themselves: the stock loadout's shield must give the ship's own shield figures.
const DB = path.join(__dirname, '../app/data/db.json');
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : null;
const hasComps = db && db.entries.some((e) => e.d && e.d.comp);
test('in the real database, stock shields match the ships\' own shield HP and regeneration', { skip: !hasComps }, () => {
  const comps = new Map(db.entries.filter((e) => e.t === 'item' && e.d.comp).map((e) => [e.n, { name: e.n, ...e.d.comp }]));
  let checked = 0;
  const off = [];
  for (const s of db.entries.filter((e) => e.t === 'ship' && e.d.shieldHp)) {
    const parts = (s.d.loadout || []).filter((l) => SLOTS.includes(l.type)).map((l) => ({ slot: l.type, name: l.item, comp: comps.get(l.item) || null }));
    const t = totals(parts);
    if (!t.shieldHp) continue;
    checked++;
    if (Math.abs(t.shieldHp - s.d.shieldHp) > 2) off.push(s.n);
  }
  assert.ok(checked > 200);
  assert.ok(off.length / checked < 0.03, `${off.length} of ${checked} off: ${off.join(', ')}`);
});
