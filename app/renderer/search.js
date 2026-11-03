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
  const TYPE_BONUS = { activity: 6, mineral: 6, commodity: 5, ship: 5, blueprint: 3, item: 2, faction: 2, mission: 1, location: 0 };
  // Results come grouped by kind, in this order, within each match tier (see search()).
  const GROUP_ORDER = ['activity', 'blueprint', 'commodity', 'mineral', 'item', 'ship', 'faction', 'mission', 'location'];
  // A quoted colour or edition marks a variant: Parallax "Sunstone" Energy Assault Rifle.
  const baseOf = (name) => String(name || '').replace(/\s*["“][^"”]+["”]\s*/, ' ').replace(/\s+/g, ' ').trim();

  // One row per searchable name; ships also get a row for their short name ("Cutlass Black" for "Drake Cutlass Black"),
  // and an entry its other names ("Exec Hangar" for the Executive Hangar).
  function buildIndex(entries) {
    const rows = [];
    for (const e of entries) {
      const names = [e.n];
      if (e.d && e.d.shortName && norm(e.d.shortName) !== norm(e.n)) names.push(e.d.shortName);
      for (const alias of (e.d && e.d.aliases) || []) names.push(alias);
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
    if ((row.e.t === 'ship' || row.e.t === 'activity') && named) tier = -1;
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
    // Activities and ships named by the query (tier -1): an activity first ("executive" finds the
    // Executive Hangar before the Executive Edition ships), then the one whose name is the query, then
    // alphabetical by their short name, so variants line up (Cutlass Black, Cutlass Blue, Cutlass Red…).
    const shipLabel = (e) => norm((e.d && e.d.shortName) || e.n);
    let hits = [...best]
      .sort((a, b) => a[1].tier - b[1].tier || (a[1].tier === -1
        ? (a[0].t !== 'activity') - (b[0].t !== 'activity') || (b[1].score >= 1000) - (a[1].score >= 1000) || shipLabel(a[0]).localeCompare(shipLabel(b[0]))
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

  // ---------- What kind of armor an item is ----------
  // The sources give an armor's part in one field and its class in others, so the subtitle said only "Helmet" or
  // "ARMOR - ARMS". This puts them together, from what is stated first: the wiki's type and cstone's armor type,
  // then a blueprint of the same name, then another colour of the same model on the same part if it has one
  // class only, then the item's own description. What none of them settles shows its part alone.
  const BODY_PARTS = ['Torso', 'Arms', 'Legs'];
  const armorPart = (e) => {
    if (e.t !== 'item') return null;
    const d = e.d || {};
    const byType = /^(Helmet|Torso|Arms|Legs|Backpack|Undersuit) \(Armor\)/.exec(d.type || '');
    if (byType) return byType[1];
    const byCategory = /^ARMOR - (\w+)/.exec(d.category || '');
    if (byCategory) return byCategory[1][0] + byCategory[1].slice(1).toLowerCase();
    if (/^Jacket \/ (Light|Medium|Heavy)/.test(d.type || '') && /\bArmor\b/.test(e.n)) return 'Torso'; // "Ixonia Armor", filed as a jacket
    if (d.type || d.category) return null;
    if (/flight ?suit|undersuit/i.test(e.n)) return 'Undersuit';
    const named = /\bArmor (Core|Arms|Legs)\b/.exec(e.n); // no type at all: "Carnifex Armor Core (01_01_01)"
    return named ? (named[1] === 'Core' ? 'Torso' : named[1]) : null;
  };
  const classIn = (text) => (/\b(Light|Medium|Heavy|Flight|Racing)\b/i.exec(text || '') || [])[1];
  const capital = (s) => s && s[0].toUpperCase() + s.slice(1).toLowerCase();
  const statedClass = (e, part) => {
    const d = e.d || {};
    const stated = classIn((d.type || '').split('/')[1]) || classIn((d.attrs || {})['ARMOR TYPE']);
    return capital(stated || (part === 'Helmet' ? (/\b(Flight|Racing) Helmet\b/i.exec(e.n) || [])[1] : null));
  };
  const describedClass = (e) => {
    const found = new Set([...String((e.d && e.d.description) || '').matchAll(/\b(light|medium|heavy)[- ](?:armou?r|helmet|backpack)\b/gi)].map((m) => capital(m[1])));
    return found.size === 1 ? [...found][0] : null;
  };
  const armorWords = (cls, part) => {
    if (part === 'Undersuit' && !/^(Light|Medium|Heavy)$/.test(cls || '')) return [cls === 'Flight' ? 'Flight suit' : 'Undersuit'];
    if (!cls) return [part];
    if (part === 'Backpack') return [`${cls} backpack`];
    if (cls === 'Flight' || cls === 'Racing') return part === 'Helmet' ? [`${cls} helmet`] : [part];
    return [`${cls} armor`, part];
  };
  // Sets e.armor (words for the language file) and e.s (the same in English, which the search reads) on every armor.
  function labelArmors(entries) {
    const blueprintClass = new Map();
    for (const e of entries) if (e.t === 'blueprint' && /^Armou?r\b/i.test(e.s || '')) blueprintClass.set(norm(e.n), /Flightsuit/i.test(e.s) ? 'Flight' : /Racer/i.test(e.s) ? 'Racing' : capital(classIn(e.s)));
    const modelKey = (e, part, words = 2) => `${part}|${norm(e.n).split(' ').slice(0, words).join(' ')}`;
    const armors = [];
    const models = new Map();
    const note = (k, cls) => {
      if (!models.has(k)) models.set(k, new Set());
      models.get(k).add(cls);
    };
    for (const e of entries) {
      const part = armorPart(e);
      if (part) {
        const cls = statedClass(e, part) || blueprintClass.get(norm(e.n));
        armors.push({ e, part, cls });
        if (cls) {
          note(modelKey(e, part), cls);
          if (BODY_PARTS.includes(part)) note(modelKey(e, part, 1), cls);
        }
      } else if (e.t === 'item' && /^Armor \//.test((e.d && e.d.type) || '')) {
        e.armor = ['Ship armor', capital(classIn(e.d.type)) || ''].filter(Boolean);
        e.s = e.armor.join(' · ');
      }
    }
    for (const { e, part, cls } of armors) {
      const only = (k) => (models.get(k)?.size === 1 ? [...models.get(k)][0] : null);
      // A set's torso, arms and legs share a first word ("Carnifex Core Windfall"); helmets and backpacks do not.
      const family = BODY_PARTS.includes(part) ? only(modelKey(e, part, 1)) : null;
      const found = cls || only(modelKey(e, part)) || family || (part === 'Undersuit' ? null : describedClass(e));
      const flight = part === 'Undersuit' && /flight ?suit/i.test(`${e.n} ${(e.d.attrs || {})['ARMOR TYPE'] || ''}`);
      e.armor = armorWords(flight ? 'Flight' : found, part);
      e.s = e.armor.join(' · ');
    }
    return entries;
  }

  const api = { norm, buildIndex, search, baseOf, GROUP_ORDER, labelArmors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
