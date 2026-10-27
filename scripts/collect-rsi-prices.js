// RSI pledge store: each ship's current standalone price (and warbond price, when there is one), read
// from its store pages. The pages carry schema.org product data in their HTML ({"price":"275.00",
// "priceCurrency":"USD","availability":".../InStock"}), so no store API is used.
// Store links come from the wiki (each ship's standalone listings and its ship page) and from UEX. A
// link is often a variant ("…-10-Year", "…-Warbond"), so for each ship the plain standalone listing
// and its warbond twin are read, then the ship page if neither exists.
// One page at a time with a pause between requests; the run stops if RSI starts refusing.
const fs = require('fs');
const path = require('path');
const { getText, getJson, writeRaw, sleep, RAW_DIR } = require('./lib/http');

const UEX = 'https://api.uexcorp.uk/2.0';
const DELAY_MS = 1500;
const VARIANT_SUFFIX = /-(Warbond|\d+-Year|LTI)$/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function productOffer(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      const offer = data['@type'] === 'Product' && (Array.isArray(data.offers) ? data.offers[0] : data.offers);
      if (offer?.price) return { usd: Number(offer.price), available: /InStock/i.test(offer.availability || ''), title: data.name };
    } catch { /* not the product block */ }
  }
  return null;
}

let refused = 0;
async function read(url) {
  try {
    return productOffer(await getText(url, { retries: 1, timeoutMs: 30000 }));
  } catch (err) {
    if (/HTTP (403|429)/.test(err.message)) refused++;
    return null;
  } finally {
    await sleep(DELAY_MS);
  }
}

async function main() {
  const ships = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'ships.json'), 'utf8')).ships;
  const uex = (await getJson(`${UEX}/vehicles`)).data;
  const uexStore = new Map(uex.filter((v) => v.url_store).map((v) => [norm(v.name), v.url_store]));
  const prices = [];
  for (const [i, s] of ships.entries()) {
    const links = [...(s.store || []).filter((o) => /Standalone-Ships/i.test(o.url || '')).map((o) => o.url), uexStore.get(norm(s.shortName))].filter(Boolean);
    const base = links.map((u) => u.replace(/\/$/, '').replace(VARIANT_SUFFIX, '')).find(Boolean);
    const entry = { name: s.name, shortName: s.shortName };
    if (base) {
      const standalone = await read(base);
      if (standalone) Object.assign(entry, { usd: standalone.usd, available: standalone.available, url: base });
      const warbond = await read(`${base}-Warbond`);
      if (warbond) entry.warbond = { usd: warbond.usd, available: warbond.available, url: `${base}-Warbond` };
      // Only a variant listing exists (e.g. "…-10-Year"): use the link we were given.
      if (!standalone && !warbond) {
        const given = links.find((u) => u.replace(/\/$/, '') !== base);
        const offer = given && (await read(given));
        if (offer) Object.assign(entry, { usd: offer.usd, available: offer.available, url: given });
      }
    }
    if (entry.usd == null && !entry.warbond && s.pledgeUrl) {
      const offer = await read(s.pledgeUrl);
      if (offer) Object.assign(entry, { usd: offer.usd, available: offer.available, url: s.pledgeUrl });
    }
    if (entry.usd != null || entry.warbond) prices.push(entry);
    if (refused >= 3) { console.warn('\nRSI is refusing requests; stopping, the prices read so far are kept'); break; }
    process.stdout.write(`\rRSI store pages: ship ${i + 1}/${ships.length}, ${prices.length} prices   `);
  }
  process.stdout.write('\n');
  writeRaw('rsi-prices.json', { source: 'https://robertsspaceindustries.com/en/store/pledge', fetchedAt: new Date().toISOString(), prices });
}

main().catch((e) => { console.error(e); process.exit(1); });
