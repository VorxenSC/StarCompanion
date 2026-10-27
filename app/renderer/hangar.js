// The Executive Hangar's light cycle (PYAM-EXHANG-0-1, Pyro). Plain script: used by the overlay and
// the pinned timer (window.CompanionHangar) and by the main process (require).
//
// One 185-minute cycle, the same on every server: closed for 2 hours while its five lights turn from
// red to green one every 24 minutes; open for 1 hour while they go out one every 12 minutes (the
// compboards go in then); then 5 minutes dark while the hangar resets, and anyone still inside dies.
// The cycle's start comes from contestedzonetimers.com, re-checked in game after each patch.
(function (root) {
  const CLOSED = 120 * 60;
  const OPEN = 60 * 60;
  const RESET = 5 * 60;
  const CYCLE = CLOSED + OPEN + RESET;
  const LIGHTS = 5;
  // A start seen on 24 Oct 2026 (4.10.2 LIVE); the overlay asks for the current one when it starts.
  const DEFAULT_ANCHOR = 1792860059;

  // The hangar at `now` (ms) for a cycle that started at `anchor` (s): its phase, the seconds until the
  // phase ends, each light ('red', 'green' or 'off') and when the next openings come.
  function state(now, anchor = DEFAULT_ANCHOR) {
    const t = Math.floor(now / 1000);
    const into = (((t - anchor) % CYCLE) + CYCLE) % CYCLE; // seconds into this cycle
    const cycleStart = t - into;
    let phase;
    let left;
    let lights;
    if (into < CLOSED) {
      phase = 'closed';
      left = CLOSED - into;
      lights = Array.from({ length: LIGHTS }, (_, i) => (into >= (i + 1) * (CLOSED / LIGHTS) ? 'green' : 'red'));
    } else if (into < CLOSED + OPEN) {
      phase = 'open';
      left = CLOSED + OPEN - into;
      lights = Array.from({ length: LIGHTS }, (_, i) => (into - CLOSED >= (i + 1) * (OPEN / LIGHTS) ? 'off' : 'green'));
    } else {
      phase = 'reset';
      left = CYCLE - into;
      lights = Array(LIGHTS).fill('off');
    }
    // The next openings (s): this cycle's if it has not opened yet, then the following ones.
    const first = into < CLOSED ? cycleStart + CLOSED : cycleStart + CYCLE + CLOSED;
    const windows = [0, 1, 2, 3].map((k) => ({ opens: first + k * CYCLE, closes: first + k * CYCLE + OPEN }));
    return { phase, left, lights, windows, openEnds: phase === 'open' ? t + left : null };
  }

  // "1:05:09" or "05:09".
  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const r = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${m}:${r}` : `${m}:${r}`;
  }

  // A start time read from contestedzonetimers.com is only taken if it is a plain number of seconds
  // within the last two years.
  function validAnchor(text, now = Date.now()) {
    const n = Number(String(text || '').trim());
    return Number.isInteger(n) && n > now / 1000 - 2 * 365 * 86400 && n < now / 1000 + 86400 ? n : null;
  }

  const api = { CLOSED, OPEN, RESET, CYCLE, LIGHTS, DEFAULT_ANCHOR, state, clock, validAnchor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionHangar = api;
})(typeof window !== 'undefined' ? window : globalThis);
