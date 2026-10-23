const test = require('node:test');
const assert = require('node:assert');
const { fromEvent, isSingleKey } = require('../app/renderer/hotkey.js');

const key = (code, mods = {}, k = code) => ({ code, key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('single keys are accepted', () => {
  assert.strictEqual(fromEvent(key('Slash', {}, '/')).accelerator, '/');
  assert.strictEqual(fromEvent(key('F8')).accelerator, 'F8');
  assert.strictEqual(fromEvent(key('NumpadDivide', {}, '/')).accelerator, 'numdiv');
  assert.strictEqual(fromEvent(key('KeyK', {}, 'k')).accelerator, 'K');
  assert.strictEqual(fromEvent(key('Insert')).accelerator, 'Insert');
});

test('any modifier combination is refused', () => {
  for (const mods of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
    const r = fromEvent(key('KeyF', mods, 'f'));
    assert.strictEqual(r.accelerator, null);
    assert.match(r.error, /single key/);
  }
});

test('a modifier alone is refused', () => {
  const r = fromEvent(key('ControlLeft', { ctrlKey: true }, 'Control'));
  assert.strictEqual(r.accelerator, null);
  assert.match(r.error, /single key/);
});

test('an unmapped key falls back to the character it types (ABNT2 "/")', () => {
  assert.strictEqual(fromEvent(key('IntlRo', {}, '/')).accelerator, '/');
});

test('unmappable keys explain themselves', () => {
  const r = fromEvent(key('IntlYen', {}, 'Unidentified'));
  assert.strictEqual(r.accelerator, null);
  assert.match(r.error, /can't be used/);
});

test('isSingleKey tells single keys from combinations', () => {
  assert.ok(isSingleKey('/'));
  assert.ok(isSingleKey('numadd'));
  assert.ok(!isSingleKey('Ctrl+Up'));
  assert.ok(!isSingleKey(''));
});
