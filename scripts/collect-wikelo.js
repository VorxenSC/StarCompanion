// starcitizen.tools "Wikelo" page: every collection contract the Banu trader offers, with the reputation it
// needs, the orders (what to bring) and the rewards. The page lists them in tables by kind (currencies,
// weapons, armor, ground vehicles, ships, other); read from the page's rendered HTML in one request.
const { getJson, writeRaw } = require('./lib/http');

const API = 'https://starcitizen.tools/api.php';
const KINDS = { Currencies: 'currency', Weapons: 'weapon', Armor: 'armor', Ships_and_vehicles: 'vehicle', Other: 'other' };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#95;/g, '_');
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// "2x Wikelo Favor", "36 SCU Quantainium": one line per <br>.
const lines = (html) => html.split(/<br\s*\/?>/i).map(text).filter(Boolean).map((l) => {
  const m = l.match(/^(\d[\d,.]*)\s*(x|SCU|units?)?\s+(.*)$/i);
  if (!m) return { name: l, qty: 1, unit: 'x' };
  const unit = /scu/i.test(m[2] || '') ? 'SCU' : 'x';
  return { name: m[3], qty: Number(m[1].replace(/,/g, '')), unit };
});

async function main() {
  const r = await getJson(`${API}?${new URLSearchParams({ action: 'parse', page: 'Wikelo', prop: 'text', format: 'json', formatversion: '2' })}`);
  const html = r?.parse?.text || '';
  if (!html) throw new Error('Wikelo page not returned');
  const contracts = [];
  // Each heading (h2/h3) is followed by one or two tables.
  const heads = [...html.matchAll(/<h[23] id="([^"]+)"/g)].map((m) => ({ id: m[1], at: m.index }));
  heads.forEach((hd, i) => {
    const kind = KINDS[hd.id];
    if (!kind) return;
    const part = html.slice(hd.at, heads[i + 1]?.at ?? html.length);
    for (const table of part.match(/<table class="wikitable sortable">[\s\S]*?<\/table>/g) || []) {
      for (const row of table.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
        if (cells.length < 4) continue;
        const rep = text(cells[1]);
        contracts.push({ name: text(cells[0]), kind, reputation: /^none$/i.test(rep) ? null : rep, orders: lines(cells[2]), rewards: lines(cells[3]) });
      }
    }
  });
  writeRaw('wikelo.json', { source: 'https://starcitizen.tools/Wikelo', fetchedAt: new Date().toISOString(), contracts });
  const by = contracts.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});
  console.log(`wikelo contracts: ${contracts.length}`, by);
}

main().catch((err) => { console.error(err); process.exit(1); });
