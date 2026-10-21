const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildIndex, search, norm } = require('../app/renderer/search.js');

const sample = [
  { id: 'a', t: 'item', n: 'Omnisky III Cannon', s: 'Ship Weapon' },
  { id: 'b', t: 'blueprint', n: 'Omnisky III Cannon', s: 'Vehiclegear / Weapons' },
  { id: 'c', t: 'mineral', n: 'Quantainium', s: 'legendary' },
  { id: 'd', t: 'item', n: 'Quantainium', s: 'Cargo' },
  { id: 'e', t: 'ship', n: 'Anvil Hawk', s: 'Anvil Aerospace · Combat' },
  { id: 'f', t: 'item', n: 'Hawkeye Helmet', s: 'Helmet' },
];
const idx = buildIndex(sample);

test('norm strips accents, quotes and punctuation', () => {
  assert.strictEqual(norm("'Arrow' I Míssil"), 'arrow i missil');
});

test('exact name wins, and mineral beats the cargo item of the same name', () => {
  assert.deepStrictEqual(search(idx, 'quantainium').map((e) => e.id), ['c', 'd']);
});

test('every token must match', () => {
  assert.deepStrictEqual(search(idx, 'omnisky cannon').map((e) => e.id).sort(), ['a', 'b']);
  assert.deepStrictEqual(search(idx, 'omnisky helmet'), []);
});

test('whole-word match ranks above prefix match', () => {
  assert.strictEqual(search(idx, 'hawk')[0].id, 'e');
});

test('type filter', () => {
  assert.deepStrictEqual(search(idx, 'omnisky', { type: 'blueprint' }).map((e) => e.id), ['b']);
});

test('subtitle matches (manufacturer) and fuzzy subsequence', () => {
  assert.strictEqual(search(idx, 'anvil')[0].id, 'e');
  assert.strictEqual(search(idx, 'qntnm')[0].id, 'c');
});

const DB = path.join(__dirname, '..', 'app', 'data', 'db.json');
test('built database answers real questions', { skip: !fs.existsSync(DB) }, () => {
  const { entries, meta } = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const real = buildIndex(entries);
  for (const t of ['item', 'ship', 'blueprint', 'mission', 'mineral', 'location']) assert.ok(meta.counts[t] > 0, `no ${t} entries`);

  const quant = search(real, 'quantainium')[0];
  assert.strictEqual(quant.t, 'mineral');
  assert.ok(quant.d.locations.stanton.length > 0);

  const ship = search(real, 'cutlass black', { type: 'ship' })[0];
  assert.ok(ship.d.buy.length > 0, 'Cutlass Black should be buyable in game');
  assert.ok(ship.d.store?.some((s) => s.usd > 0), 'Cutlass Black should have a USD price');

  const bp = entries.find((e) => e.t === 'blueprint' && e.d.missions.length);
  assert.ok(bp.d.ingredients.length > 0);

  const sold = entries.filter((e) => e.t === 'item' && e.d.shops?.length);
  assert.ok(sold.length > 2000, `only ${sold.length} items with shops`);
});
