const test = require('node:test');
const assert = require('node:assert');
const { fromEvent } = require('../app/renderer/hotkey.js');

const key = (code, mods = {}) => ({ code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('function keys and numpad work alone', () => {
  assert.strictEqual(fromEvent(key('F8')).accelerator, 'F8');
  assert.strictEqual(fromEvent(key('F12')).accelerator, 'F12');
  assert.strictEqual(fromEvent(key('Numpad5')).accelerator, 'num5');
  assert.strictEqual(fromEvent(key('Insert')).accelerator, 'Insert');
});

test('modifiers are ordered Ctrl, Alt, Shift', () => {
  assert.strictEqual(fromEvent(key('KeyF', { shiftKey: true, ctrlKey: true })).accelerator, 'Ctrl+Shift+F');
  assert.strictEqual(fromEvent(key('Digit1', { altKey: true })).accelerator, 'Alt+1');
  assert.strictEqual(fromEvent(key('Backquote', { ctrlKey: true })).accelerator, 'Ctrl+`');
});

test('a letter, digit or space alone is refused', () => {
  for (const code of ['KeyA', 'Digit3', 'Space']) {
    const r = fromEvent(key(code));
    assert.strictEqual(r.accelerator, null);
    assert.match(r.error, /alone/);
  }
});

test('holding only modifiers is not a shortcut yet', () => {
  const r = fromEvent(key('ControlLeft', { ctrlKey: true }));
  assert.strictEqual(r.accelerator, null);
  assert.deepStrictEqual(r.partial, ['Ctrl']);
});

test('unmappable keys explain themselves', () => {
  const r = fromEvent(key('IntlBackslash'));
  assert.strictEqual(r.accelerator, null);
  assert.match(r.error, /can't be used/);
});
