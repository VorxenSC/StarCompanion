// RSI pledge store add-ons: ship modules (Galaxy, Aurora Mk II…), Endeavor pods, bodykits and weapon kits, with
// their USD price. The Add-Ons page carries schema.org product data in its HTML (one ProductGroup per listing, its
// variants inside), so it is read with one plain request, as collect-rsi-prices.js reads ship pages; no store API.
// Writes data/raw/rsi-addons.json: [{ name, usd, available, warbond, url, description }].
const { getText, writeRaw } = require('./lib/http');

const PAGE = 'https://robertsspaceindustries.com/en/pledge/Add-Ons';

async function main() {
  const html = await getText(PAGE, { retries: 1, timeoutMs: 30000 });
  const addons = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    for (const p of [data, ...(data.hasVariant || [])]) {
      const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
      if (!offer?.price || !p.name) continue;
      const url = offer.url || p.url;
      addons.push({
        name: String(p.name).replace(/^\s*-\s*/, '').trim(),
        usd: Number(offer.price),
        available: /InStock/i.test(offer.availability || ''),
        warbond: /-Warbond$/i.test(url || ''),
        url,
        description: p.description || null,
      });
    }
  }
  if (!addons.length) throw new Error('no add-ons found on the page: its layout may have changed');
  writeRaw('rsi-addons.json', { source: PAGE, fetchedAt: new Date().toISOString(), addons });
  console.log(`rsi add-ons: ${addons.length} listings`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
