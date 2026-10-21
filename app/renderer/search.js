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
  const TYPE_BONUS = { mineral: 6, commodity: 5, ship: 5, blueprint: 3, item: 2, mission: 1, location: 0 };

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

  function scoreRow(row, q, tokens) {
    let score = 0;
    if (row.key === q) score += 1000;
    else if (row.key.startsWith(q + ' ')) score += 300; // query is the name's leading whole word(s)
    else if ((' ' + row.key + ' ').includes(' ' + q + ' ')) score += 150; // query is whole words inside the name
    else if (row.key.startsWith(q)) score += 60;
    else if (row.key.includes(q)) score += 30;

    for (const t of tokens) {
      if (row.words.includes(t)) score += 40;
      else if (row.words.some((w) => w.startsWith(t))) score += 25;
      else if (row.key.includes(t)) score += 10;
      else if (row.sub.includes(t)) score += 4; // matched the subtitle (category, manufacturer…)
      else if (t.length >= 3 && isSubsequence(t, row.flat)) score += 2;
      else return 0; // every token must match somewhere
    }
    score += TYPE_BONUS[row.e.t] || 0;
    if (row.hasShops) score += 3;
    score -= Math.min(row.key.length, 60) / 10; // shorter names are closer matches
    return score;
  }

  function search(index, query, { type = 'all', limit = 80 } = {}) {
    const q = norm(query);
    if (!q) return [];
    const rows = type === 'all' ? index : index.filter((r) => r.e.t === type);
    const tokens = q.split(' ');
    const best = new Map(); // entry -> best score across its names
    for (const row of rows) {
      const s = scoreRow(row, q, tokens);
      if (s > 0 && !(best.get(row.e) >= s)) best.set(row.e, s);
    }
    return [...best]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map((h) => h[0]);
  }

  const api = { norm, buildIndex, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
