const test = require('node:test');
const assert = require('node:assert');
const { view, parseLine } = require('../app/renderer/mining.js');

const t = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const reading = (extra) => ({ kind: 'match', rs: 10755, name: 'Gold', signal: 'Ore', count: 3, secondary: null, secondaryCount: 0, priority: 'VeryHigh', confidence: 1, exact: true, alternatives: [], held: false, context: null, contextInferred: false, ...extra });

test('an exact ore reading names the ore, its rocks and its priority', () => {
  const v = view(reading(), t);
  assert.strictEqual(v.headline, 'Gold');
  assert.strictEqual(v.rs, 'RS 10,755');
  assert.strictEqual(v.count, '3 rocks');
  assert.strictEqual(v.status, '★★ Very high priority');
  assert.strictEqual(v.tone, 'top');
  assert.strictEqual(v.confidence, '');
});

test('one rock is singular, and a close reading says how sure it is', () => {
  const v = view(reading({ count: 1, rs: 3584, exact: false, confidence: 0.97 }), t);
  assert.strictEqual(v.count, '1 rock');
  assert.strictEqual(v.confidence, 'Confidence 97%');
});

test('a signal that names no mineral says so, and links nowhere', () => {
  const v = view(reading({ name: 'Q-Type Asteroid', signal: 'AsteroidType', count: 2, priority: null, rs: 9740 }), t);
  assert.strictEqual(v.count, '2 asteroids');
  assert.strictEqual(v.status, 'Composition unknown: approach and scan');
  assert.strictEqual(v.name, null);
});

test('a mixed cluster shows both parts', () => {
  const v = view(reading({ name: 'Stileron', count: 1, secondary: 'ROC Deposit', secondaryCount: 7, rs: 31185 }), t);
  assert.strictEqual(v.count, '1 rock + 7 × ROC Deposit');
});

test('an ambiguous reading lists the options with their shares', () => {
  const v = view({ kind: 'ambiguous', rs: 21510, alternatives: [{ name: 'Gold', count: 6, confidence: 0.55 }, { name: 'Ice', count: 5, confidence: 0.45 }], context: 'space', contextInferred: true }, t);
  assert.strictEqual(v.tone, 'ambiguous');
  assert.deepStrictEqual(v.alternatives.map((a) => `${a.label} ${a.share}`), ['Gold × 6 55%', 'Ice × 5 45%']);
  assert.strictEqual(v.context, 'Space · auto');
});

test('nothing on screen is the idle state, and so is no reading at all', () => {
  assert.strictEqual(view({ kind: 'idle' }, t).kind, 'idle');
  assert.strictEqual(view(null, t).kind, 'idle');
});

test('the engine\'s lines parse, and anything else is ignored', () => {
  assert.strictEqual(parseLine('{"type":"ready"}').type, 'ready');
  assert.strictEqual(parseLine('not json'), null);
  assert.strictEqual(parseLine('{"no":"type"}'), null);
  assert.strictEqual(parseLine(''), null);
});
