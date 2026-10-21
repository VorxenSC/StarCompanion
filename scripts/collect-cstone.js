// finder.cstone.space: where items are sold (shop location, base price, last verified date).
// /GetSearch lists every item; the per-item page holds attributes and the shop table.
// Pages are cached in data/raw/cstone-pages so a re-run only fetches what is missing.
const fs = require('fs');
const path = require('path');
const { getText, getJson, pool, writeRaw, progress, RAW_DIR } = require('./lib/http');

const BASE = 'https://finder.cstone.space';
const CACHE = path.join(RAW_DIR, 'cstone-pages');
const FRESH = process.argv.includes('--fresh');

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function parseItemPage(html) {
  const out = { category: null, className: null, attrs: {}, description: null, shops: [] };

  const jumbo = html.match(/<div class="jumbotron"[^>]*>([\s\S]*?)<\/div>\s*<div class="row"/);
  if (jumbo) {
    const h2 = [...jumbo[1].matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
    if (h2[0]) out.category = decode(h2[0][1]);
    const cls = jumbo[1].match(/<div[^>]*>([A-Za-z0-9_]+)<\/div>\s*<\/h2>/);
    if (cls) out.className = cls[1];
  }

  // Attribute rows: a small label cell followed by a value cell.
  for (const m of html.matchAll(/<tr>\s*<td[^>]*font-size:10px[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const k = decode(m[1]);
    const v = decode(m[2]);
    if (k && v && k !== 'NAME') out.attrs[k] = v;
  }

  const table = html.match(/<table id="table"[\s\S]*?<\/table>/);
  if (table) {
    const headers = [...table[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => decode(m[1]).toLowerCase());
    const body = table[0].split(/<tbody>/)[1] || '';
    for (const row of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
      if (!cells.length) continue;
      const shop = {};
      headers.forEach((h, i) => { shop[h] = cells[i]; });
      out.shops.push({
        location: shop.location,
        price: shop['base price'] ? Number(shop['base price'].replace(/[^\d.]/g, '')) || shop['base price'] : null,
        verified: shop.verified || null,
        ...Object.fromEntries(Object.entries(shop).filter(([k]) => !['location', 'base price', 'verified'].includes(k))),
      });
    }
  }

  const desc = html.match(/DESCRIPTION<br \/>[\s\S]*?<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/);
  if (desc) out.description = decode(desc[1]) || null;
  return out;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const index = await getJson(`${BASE}/GetSearch`);
  console.log(`cstone index: ${index.length} items, ${index.filter((x) => x.Sold).length} sold in shops`);

  // Only items sold somewhere have a shop table worth fetching; the rest are kept as names.
  const toFetch = index.filter((x) => x.Sold);
  const results = await pool(
    toFetch,
    4,
    async (item) => {
      const file = path.join(CACHE, `${item.id}.html`);
      let html;
      if (!FRESH && fs.existsSync(file)) html = fs.readFileSync(file, 'utf8');
      else {
        html = await getText(`${BASE}/Search/${item.id}`);
        fs.writeFileSync(file, html);
      }
      return parseItemPage(html);
    },
    { delayMs: 150, onProgress: progress('cstone pages') },
  );

  const details = new Map(toFetch.map((x, i) => [x.id, results[i]]));
  const items = index.map((x) => {
    const d = details.get(x.id);
    const base = { id: x.id, name: x.name, sold: !!x.Sold };
    if (!d || d.error) return d?.error ? { ...base, error: d.error } : base;
    return { ...base, ...d };
  });
  const failed = items.filter((x) => x.error).length;
  if (failed) console.warn(`${failed} pages failed; re-run to retry them`);
  writeRaw('cstone.json', { source: BASE, fetchedAt: new Date().toISOString(), items });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseItemPage };
