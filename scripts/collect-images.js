// starcitizen.tools page images: the picture each item's or ship's wiki page shows, used when cstone has
// none. Asked 50 titles at a time through the MediaWiki API (pageimages), following redirects.
const fs = require('fs');
const path = require('path');
const { getJson, pool, writeRaw, progress, RAW_DIR } = require('./lib/http');

const API = 'https://starcitizen.tools/api.php';
const BATCH = 50;

async function main() {
  const wiki = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'wiki.json'), 'utf8'));
  let ships = [];
  // A ship is asked by its short and full name, and by its base model's (a special edition shows the base ship).
  const namesOf = (n) => {
    const base = String(n || '').replace(/\s+(Wikelo\b.*|PYAM Exec|\d{4} (BIS|Best In Show)( Edition)?|Best In Show Edition|Alliance|Executive Edition)$/i, '').trim();
    const out = [];
    for (const x of [n, base]) {
      if (!x) continue;
      const noMaker = x.replace(/^(Aegis|Anvil|Aopoa|Argo|Banu|C\.O\.|Consolidated Outland|Crusader|Drake|Esperia|Gatac|Greycat|Kruger|Mirai|MISC|Origin|RSI|Tumbril|Vanduul)\s+/, '');
      for (const y of [x, noMaker]) {
        const noHm6 = y.replace(/^HM6\s+/, '');
        const plain = noHm6.replace(/\s+(Limited|Pirate|Cool Metal Color|Orange Line|Snowland Color|Destroyer)$/i, '').replace(/^Hornet (F7\S*) /, '$1 Hornet ');
        out.push(y, noHm6, plain, plain.replace(/(\S+)$/, (w) => w.toUpperCase()));
      }
    }
    return [...new Set(out.filter(Boolean))];
  };
  try { ships = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'ships.json'), 'utf8')).ships.flatMap((s) => [...namesOf(s.shortName), ...namesOf(s.name)]); } catch { /* no ships dump yet */ }
  const titles = [...new Set([...wiki.items.map((i) => i.name), ...ships].filter((n) => n && !/PLACEHOLDER|^<=|^\[/.test(n)))];
  const batches = [];
  for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));

  const results = await pool(batches, 2, (batch) => {
    const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', redirects: '1', titles: batch.join('|') });
    return getJson(`${API}?${q}`);
  }, { delayMs: 300, onProgress: progress('wiki image batches') });

  const images = {};
  for (const r of results) {
    const q = r?.query;
    if (!q) continue;
    // A requested title may be normalised or redirected before it reaches the page that has the image.
    const back = new Map();
    for (const { from, to } of [...(q.normalized || []), ...(q.redirects || [])]) back.set(to, [...(back.get(to) || []), from, ...(back.get(from) || [])]);
    for (const page of Object.values(q.pages || {})) {
      const src = page.thumbnail?.source;
      if (!src) continue;
      for (const name of [page.title, ...(back.get(page.title) || [])]) images[name] = src;
    }
  }
  const failed = results.filter((r) => r?.error).length;
  if (failed) console.warn(`${failed} batches failed; re-run to retry them`);
  writeRaw('images.json', { source: 'https://starcitizen.tools', fetchedAt: new Date().toISOString(), images });
  console.log(`wiki images: ${Object.keys(images).length} of ${titles.length} names`);
}

main().catch((e) => { console.error(e); process.exit(1); });
