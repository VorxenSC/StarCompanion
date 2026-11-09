const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { labelArmors, buildIndex, search } = require('../app/renderer/search.js');

const item = (n, d) => ({ t: 'item', n, s: '', d });
const label = (...entries) => { labelArmors(entries); return entries.map((e) => e.s); };

test('the class and the part come together, from either source', () => {
  assert.deepStrictEqual(label(item('Argus Helmet', { type: 'Helmet (Armor) / Light' })), ['Light armor · Helmet']);
  assert.deepStrictEqual(label(item('ADP Arms', { category: 'ARMOR - ARMS', attrs: { 'ARMOR TYPE': 'Heavy Armor' } })), ['Heavy armor · Arms']);
});

test('undersuits and flight suits say which they are', () => {
  assert.deepStrictEqual(label(item('Beacon Undersuit', { type: 'Undersuit (Armor) / Undefined' })), ['Undersuit']);
  assert.deepStrictEqual(label(item('OMNI Flight Suit', { type: 'Undersuit (Armor) / Undefined' })), ['Flight suit']);
  assert.deepStrictEqual(label(item('Tailwind', { category: 'ARMOR - UNDERSUIT', attrs: { 'ARMOR TYPE': 'Flight Suit' } })), ['Flight suit']);
  assert.deepStrictEqual(label(item('Mirai Flight Suit', {})), ['Flight suit']);
  assert.deepStrictEqual(label(item('Pembroke Suit', { type: 'Undersuit (Armor) / Heavy' })), ['Heavy armor · Undersuit']);
});

test('helmets and backpacks read naturally', () => {
  assert.deepStrictEqual(label(item('Azrael Racing Helmet', { type: 'Helmet (Armor) / Helmet' })), ['Racing helmet']);
  assert.deepStrictEqual(label(item('A23', { type: 'Helmet (Armor) / Helmet', attrs: { 'ARMOR TYPE': 'Flight Helmet' } })), ['Flight helmet']);
  assert.deepStrictEqual(label(item('CSP Pack', { type: 'Backpack (Armor) / Personal', attrs: { 'ARMOR TYPE': 'Heavy Backpack' } })), ['Heavy backpack']);
});

test('a blueprint of the same name settles it', () => {
  const [, core] = label({ t: 'blueprint', n: 'Carnifex Armor Core', s: 'Armour / Combat / Light', d: {} }, item('Carnifex Armor Core', { type: 'Torso (Armor) / Undefined' }));
  assert.strictEqual(core, 'Light armor · Torso');
});

test('another colour of the model settles it, unless they disagree', () => {
  const type = 'Backpack (Armor) / Personal';
  assert.strictEqual(label(item('Aril Backpack', { type, attrs: { 'ARMOR TYPE': 'Light Backpack' } }), item('Aril Backpack Red', { type }))[1], 'Light backpack');
  const mixed = label(item('Bor Backpack A', { type, attrs: { 'ARMOR TYPE': 'Light Backpack' } }), item('Bor Backpack B', { type, attrs: { 'ARMOR TYPE': 'Heavy Backpack' } }), item('Bor Backpack C', { type }));
  assert.strictEqual(mixed[2], 'Backpack');
});

test('the description is the last resort, and only when it names one class', () => {
  const type = 'Helmet (Armor) / Helmet';
  assert.strictEqual(label(item('X Helmet', { type, description: 'A trusted heavy helmet.' }))[0], 'Heavy armor · Helmet');
  assert.strictEqual(label(item('Y Helmet', { type, description: 'Fits light armor or heavy armor.' }))[0], 'Helmet');
});

test('nothing settles it: the part alone, never a guess', () => {
  assert.deepStrictEqual(label(item('Fieldsbury Dark Bear Helmet', { type: 'Helmet (Armor) / Helmet' })), ['Helmet']);
});

test('ship armor says so, and other items are left alone', () => {
  assert.deepStrictEqual(label(item('300i Ship Armor', { type: 'Armor / Medium' })), ['Ship armor · Medium']);
  const jacket = { t: 'item', n: 'Flight Jacket', s: 'Jacket', d: { type: 'Jacket / Undefined' } };
  labelArmors([jacket]);
  assert.strictEqual(jacket.s, 'Jacket');
  assert.strictEqual(jacket.armor, undefined);
});

test('the class can be searched', () => {
  const entries = [item('ADP Arms', { type: 'Arms (Armor) / Heavy' }), item('Argus Arms', { type: 'Arms (Armor) / Light' })];
  labelArmors(entries);
  assert.deepStrictEqual(search(buildIndex(entries), 'heavy arms').map((e) => e.n)[0], 'ADP Arms');
});

test('in the real database, every torso, arms and legs piece has its class', { skip: !fs.existsSync(path.join(__dirname, '../app/data/db.json')) }, () => {
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/data/db.json'), 'utf8'));
  labelArmors(db.entries);
  const armors = db.entries.filter((e) => e.armor);
  assert.ok(armors.length > 2000);
  const body = armors.filter((e) => ['Torso', 'Arms', 'Legs'].includes(e.armor.at(-1)));
  assert.deepStrictEqual(body.filter((e) => e.armor.length < 2).map((e) => e.n), []);
});
