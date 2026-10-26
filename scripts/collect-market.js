// UEX player marketplace: what players are asking for items right now.
// The public API returns the latest listings, and the full listing history of one item when filtered by
// id_item. We take every item in the current feed, read its history, and summarise its open sell offers.
// We also map every UEX item id (with its uuid), so each item can link to its filtered marketplace page.
const fs = require('fs');
const path = require('path');
const { getJson, pool, writeRaw, progress, RAW_DIR } = require('./lib/http');

const UEX = 'https://api.uexcorp.uk/2.0';
const now = () => Math.floor(Date.now() / 1000);

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// Open sell offers priced per unit in aUEC; bundles priced per SCU and sold-out or expired ads are left out.
function summarise(listings) {
  const open = listings.filter((l) => l.currency === 'UEC' && Number(l.price) > 0 && !l.is_sold_out && (!l.date_expiration || l.date_expiration > now()));
  const sells = open.filter((l) => l.operation === 'sell');
  const perUnit = sells.filter((l) => l.unit === 'unit');
  const priced = (perUnit.length ? perUnit : sells).map((l) => Number(l.price)).sort((a, z) => a - z);
  if (!priced.length) return null;
  return {
    approx: median(priced),
    min: priced[0],
    max: priced[priced.length - 1],
    sellCount: sells.length,
    buyCount: open.filter((l) => l.operation === 'buy').length,
    newest: new Date(Math.max(...sells.map((l) => l.date_added)) * 1000).toISOString().slice(0, 10),
    // A player's photo of the item, from the newest open offer that has one (UEX's own thumbnail).
    photo: [...sells].sort((a, z) => z.date_added - a.date_added).map((l) => String(l.photos || '').split(',')[0].trim()).find((u) => /^https:\/\//.test(u)) || undefined,
  };
}

async function main() {
  // Every UEX item id → name and uuid, so items can be linked even when nobody is selling them.
  const categories = (await getJson(`${UEX}/categories`)).data.filter((c) => c.type === 'item');
  const perCategory = await pool(categories, 3, (c) => getJson(`${UEX}/items?id_category=${c.id}`), { delayMs: 150, onProgress: progress('item categories') });
  const items = perCategory.flatMap((r) => r.data || []).map((i) => ({ id: i.id, name: i.name, uuid: i.uuid || null, company: i.company_name || null, image: i.screenshot || null }));

  const feed = (await getJson(`${UEX}/marketplace_listings`)).data;
  // The public feed only holds the latest 500 listings (about two days). Items that had open offers
  // in the previous dump are checked again too, so an older listing that is still open is not lost.
  let previous = [];
  try {
    previous = Object.keys(JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'market.json'), 'utf8')).market || {}).map(Number);
  } catch { /* first run */ }
  const listed = [...new Set([...feed.map((l) => l.id_item), ...previous].filter((id) => id > 0))];
  const histories = await pool(listed, 2, (id) => getJson(`${UEX}/marketplace_listings?id_item=${id}`), { delayMs: 250, onProgress: progress('listed items') });

  const market = {};
  listed.forEach((id, i) => {
    const s = histories[i]?.data ? summarise(histories[i].data) : null;
    if (s) market[id] = s;
  });
  const failed = histories.filter((h) => h?.error).length;
  if (failed) console.warn(`${failed} item histories failed; re-run to retry them`);
  console.log(`${items.length} UEX items, ${listed.length} listed now, ${Object.keys(market).length} with open sell offers`);
  writeRaw('market.json', { source: 'https://uexcorp.space/marketplace', fetchedAt: new Date().toISOString(), items, market });
}

main().catch((e) => { console.error(e); process.exit(1); });
