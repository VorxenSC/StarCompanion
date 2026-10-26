// Search index over db entries. Plain script: used by the renderer (window.CompanionSearch) and by tests (require).
(function (root) {
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[“”"'`’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // Small ranking nudges so the most useful kind of entry wins a tie.
  const TYPE_BONUS = { mineral: 6, commodity: 5, ship: 5, blueprint: 3, item: 2, faction: 2, mission: 1, location: 0 };
  // Results come grouped by kind, in this order, within each match tier (see search()).
  const GROUP_ORDER = ['blueprint', 'commodity', 'mineral', 'item', 'ship', 'faction', 'mission', 'location'];
  // A quoted colour or edition marks a variant: Parallax "Sunstone" Energy Assault Rifle.
  const baseOf = (name) => String(name || '').replace(/\s*["“][^"”]+["”]\s*/, ' ').replace(/\s+/g, ' ').trim();

  // One row per searchable name; ships also get a row for their short name ("Cutlass Black" for "Drake Cutlass Black").
  function buildIndex(entries) {
    const rows = [];
    for (const e of entries) {
      const names = [e.n];
      if (e.d && e.d.shortName && norm(e.d.shortName) !== norm(e.n)) names.push(e.d.shortName);
      for (const name of names) {
        const key = norm(name);
        rows.push({
          e,
          key,
          flat: key.replace(/ /g, ''),
          words: key.split(' '),
          sub: norm(e.s),
          hasShops: !!(e.d && ((e.d.shops && e.d.shops.length) || (e.d.buy && e.d.buy.length))),
        });
      }
    }
    return rows;
  }

  function isSubsequence(needle, hay) {
    let i = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
    return i === needle.length;
  }

  // tier 0: the name is the query; 1: the query is in the name as whole words; 2: everything else.
  // A ship whose name the query spells (every word matches the start of a word of the name) goes
  // above all of them, tier -1: someone typing a ship's name is looking for that ship.
  function scoreRow(row, q, tokens) {
    let score = 0;
    let tier = 2;
    let named = true;
    if (row.key === q) { score += 1000; tier = 0; }
    else if (row.key.startsWith(q + ' ')) { score += 300; tier = 1; } // query is the name's leading whole word(s)
    else if ((' ' + row.key + ' ').includes(' ' + q + ' ')) { score += 150; tier = 1; } // query is whole words inside the name
    else if (row.key.startsWith(q)) score += 60;
    else if (row.key.includes(q)) score += 30;

    for (const t of tokens) {
      if (row.words.includes(t)) score += 40;
      else if (row.words.some((w) => w.startsWith(t))) score += 25;
      else if ((named = false) || row.key.includes(t)) score += 10;
      else if (row.sub.includes(t)) score += 4; // matched the subtitle (category, manufacturer…)
      else if (t.length >= 3 && isSubsequence(t, row.flat)) score += 2;
      else return null; // every token must match somewhere
    }
    score += TYPE_BONUS[row.e.t] || 0;
    if (row.hasShops) score += 3;
    score -= Math.min(row.key.length, 60) / 10; // shorter names are closer matches
    if (row.e.t === 'ship' && named) tier = -1;
    // Matches only through the subtitle or scattered letters ("cutl" in "Field Recon Suit Legs") go
    // last, after every name that really contains the query.
    else if (tier === 2 && !named && !row.key.includes(q)) tier = 3;
    return { score, tier };
  }

  // Ranked, then grouped: within each tier, blueprints first, then commodities, items and the rest
  // (GROUP_ORDER), best match first inside a group. collapseVariants keeps one row per variant family
  // (the best-ranked one) and records how many it stands for in variantCount.
  function search(index, query, { type = 'all', limit = 80, collapseVariants = false } = {}) {
    const q = norm(query);
    if (!q) return [];
    const rows = type === 'all' ? index : index.filter((r) => r.e.t === type);
    const tokens = q.split(' ');
    const best = new Map(); // entry -> best { score, tier } across its names
    for (const row of rows) {
      const s = scoreRow(row, q, tokens);
      if (!s || s.score <= 0) continue;
      const prev = best.get(row.e);
      if (!prev) best.set(row.e, s);
      else best.set(row.e, { score: Math.max(prev.score, s.score), tier: Math.min(prev.tier, s.tier) });
    }
    const group = (t) => { const i = GROUP_ORDER.indexOf(t); return i < 0 ? GROUP_ORDER.length : i; };
    // Ships named by the query (tier -1): the one whose name is the query first, then alphabetical
    // by their short name, so variants line up (Cutlass Black, Cutlass Blue, Cutlass Red…).
    const shipLabel = (e) => norm((e.d && e.d.shortName) || e.n);
    let hits = [...best]
      .sort((a, b) => a[1].tier - b[1].tier || (a[1].tier === -1
        ? (b[1].score >= 1000) - (a[1].score >= 1000) || shipLabel(a[0]).localeCompare(shipLabel(b[0]))
        : group(a[0].t) - group(b[0].t) || b[1].score - a[1].score))
      .map((h) => h[0]);
    if (collapseVariants) {
      const families = new Map();
      hits = hits.filter((e) => {
        if (!(e.d && e.d.variants && e.d.variants.length > 1)) return true;
        const k = e.t + '|' + norm(baseOf(e.n));
        if (families.has(k)) { families.get(k).n++; return false; }
        families.set(k, { n: 1 });
        e.variantHits = families.get(k);
        return true;
      });
    }
    return hits.slice(0, limit);
  }

  const api = { norm, buildIndex, search, baseOf, GROUP_ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
