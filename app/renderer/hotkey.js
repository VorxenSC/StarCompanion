// Turns a keydown into an Electron accelerator for the overlay's shortcut. Only a single key is
// allowed (no Ctrl/Alt/Shift/Win combinations): "/", "F8", "num5", "K". Plain script: used by the
// renderer (window.CompanionHotkey) and by tests (require).
(function (root) {
  const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
  const CODE_TO_KEY = {
    Space: 'Space', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PrintScreen: 'PrintScreen', ScrollLock: 'Scrolllock', NumLock: 'Numlock', Tab: 'Tab',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };
  // Characters an accelerator can name directly, for keys whose code we don't map (e.g. the "/" key of
  // a Brazilian ABNT2 keyboard reports IntlRo).
  const PRINTABLE = /^[a-z0-9`\-=[\]\\;',./]$/i;

  function keyFromCode(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
    if ((m = /^Numpad([0-9])$/.exec(code))) return `num${m[1]}`;
    if ((m = /^(F([1-9]|1[0-9]|2[0-4]))$/.exec(code))) return m[1];
    return CODE_TO_KEY[code] || null;
  }

  // { accelerator, error } for a keydown.
  function fromEvent(ev) {
    if (MODIFIER_CODES.test(ev.code)) return { accelerator: null, error: 'Use a single key: Ctrl, Alt, Shift and Win can’t be the shortcut.' };
    if (ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return { accelerator: null, error: 'Use a single key on its own, without Ctrl, Alt or Shift.' };
    const key = keyFromCode(ev.code) || (ev.key && PRINTABLE.test(ev.key) ? ev.key.toUpperCase() : null);
    if (!key) return { accelerator: null, error: "{key} can't be used as a shortcut.", vars: { key: ev.key || ev.code } };
    return { accelerator: key };
  }

  const isSingleKey = (accelerator) => typeof accelerator === 'string' && accelerator.length > 0 && !/.\+./.test(accelerator);

  const api = { fromEvent, keyFromCode, isSingleKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionHotkey = api;
})(typeof window !== 'undefined' ? window : globalThis);
