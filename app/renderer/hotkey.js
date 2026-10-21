// Turns a keydown into an Electron accelerator ("Ctrl+Shift+F", "F8", "Alt+num5"). Plain script: used
// by the renderer (window.CompanionHotkey) and by tests (require).
(function (root) {
  const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
  const CODE_TO_KEY = {
    Space: 'Space', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PrintScreen: 'PrintScreen', ScrollLock: 'Scrolllock', NumLock: 'Numlock',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };
  // Keys that are fine alone as a global shortcut: they don't type text in other apps.
  const SAFE_ALONE = /^(F([1-9]|1[0-9]|2[0-4])|num.*|Insert|Home|End|PageUp|PageDown|PrintScreen|Scrolllock|Numlock)$/;

  function keyFromCode(code) {
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
    if ((m = /^Numpad([0-9])$/.exec(code))) return `num${m[1]}`;
    if ((m = /^(F([1-9]|1[0-9]|2[0-4]))$/.exec(code))) return m[1];
    return CODE_TO_KEY[code] || null;
  }

  // { accelerator, error } for a keydown; accelerator null while only modifiers are held.
  function fromEvent(ev) {
    if (MODIFIER_CODES.test(ev.code)) return { accelerator: null, partial: modifiers(ev) };
    const key = keyFromCode(ev.code);
    if (!key) return { accelerator: null, error: `${ev.key || ev.code} can't be used as a shortcut.` };
    const mods = modifiers(ev);
    if (!mods.length && !SAFE_ALONE.test(key)) {
      return { accelerator: null, error: `${key} alone would be captured in every program. Add Ctrl, Alt or Shift, or use an F-key.` };
    }
    return { accelerator: [...mods, key].join('+') };
  }

  function modifiers(ev) {
    return [ev.ctrlKey && 'Ctrl', ev.altKey && 'Alt', ev.shiftKey && 'Shift', ev.metaKey && 'Super'].filter(Boolean);
  }

  const api = { fromEvent, keyFromCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionHotkey = api;
})(typeof window !== 'undefined' ? window : globalThis);
