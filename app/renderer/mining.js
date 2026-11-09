// What a Mining Assistant reading says on screen. Plain script: used by the overlay's page
// (window.CompanionMining) and by the main process, which words the pin (require).
//
// A reading comes from the reading engine (scripts/build-mining.js, app/mining.js) with names only; the
// words come from here, through the language file. One cluster's radar signature is the signal's base
// times its count, so a reading names what it is, how many, and how sure it is.
(function (root) {
  // Priority is always said in words too, never by colour alone.
  const PRIORITY = {
    VeryHigh: { label: 'Very high priority', mark: '★★', tone: 'top' },
    High: { label: 'High priority', mark: '★', tone: 'high' },
    Conditional: { label: 'Conditional', mark: '◆', tone: 'mid' },
    Common: { label: 'Common', mark: '·', tone: 'low' },
  };
  // The signals that do not name a mineral.
  const SIGNAL = {
    AsteroidType: { unit: ['asteroid', 'asteroids'], line: 'Composition unknown: approach and scan' },
    FpsDeposit: { unit: ['deposit', 'deposits'], line: 'Mineral not identified by RS' },
    RocDeposit: { unit: ['deposit', 'deposits'], line: 'Mineral not identified by RS' },
    Salvage: { unit: ['panel', 'panels'], line: 'Not mining' },
  };
  const rsText = (rs) => Number(rs).toLocaleString('en-US');
  const unitOf = (signal, n) => (SIGNAL[signal]?.unit || ['rock', 'rocks'])[n === 1 ? 0 : 1];

  // { kind, tone, headline, rs, count, status, alternatives, held, context } in the language of `t`.
  function view(r, t) {
    const context = r?.context ? `${t(r.context === 'space' ? 'Space' : 'Surface')}${r.contextInferred ? ` · ${t('auto')}` : ''}` : '';
    if (!r || r.kind === 'idle') return { kind: 'idle', tone: 'idle', headline: t('Scanning…'), rs: '', count: '', status: '', alternatives: [], held: false, context };
    const rs = `RS ${rsText(r.rs)}`;
    const alternatives = (r.alternatives || []).map((a) => ({
      label: a.secondary ? `${a.name} × ${a.count} + ${a.secondary} × ${a.secondaryCount}` : `${a.name} × ${a.count}`,
      share: `${Math.round(a.confidence * 100)}%`,
      name: a.name,
    }));
    const base = { kind: r.kind, rs, alternatives, held: !!r.held, context };
    if (r.kind === 'unknown') return { ...base, tone: 'unknown', headline: t('Unknown signature'), count: '', status: t('Not in the signature table') };
    if (r.kind === 'ambiguous') return { ...base, tone: 'ambiguous', headline: t('Possible:'), count: '', status: '' };
    const p = PRIORITY[r.priority];
    const mixed = r.secondary ? ` + ${r.secondaryCount} × ${r.secondary}` : '';
    return {
      ...base,
      tone: p ? p.tone : 'low',
      name: r.signal === 'Ore' ? r.name : null,
      headline: r.name,
      count: `${r.count} ${t(unitOf(r.signal, r.count))}${mixed}`,
      status: p ? `${p.mark} ${t(p.label)}` : t(SIGNAL[r.signal]?.line || ''),
      confidence: r.exact ? '' : t('Confidence {n}%', { n: Math.round(r.confidence * 100) }),
    };
  }

  // One line of the engine's output: the message, or null for anything that is not JSON.
  function parseLine(line) {
    try {
      const m = JSON.parse(line);
      return m && typeof m.type === 'string' ? m : null;
    } catch {
      return null;
    }
  }

  const api = { view, parseLine, rsText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionMining = api;
})(typeof window !== 'undefined' ? window : globalThis);
