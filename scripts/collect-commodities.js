// UEX commodities: buy/sell price, stock and demand of every commodity at every trade terminal,
// plus the game version UEX's data is for (PU live). The fetching lives in lib/commodities.js, which
// the running app also uses to keep demand and prices live.
const { getJson, writeRaw } = require('./lib/http');
const { fetchCommodities } = require('./lib/commodities');

async function main() {
  const { gameVersion, ptuVersion, commodities, priceCount } = await fetchCommodities(getJson);
  console.log(`${commodities.length} commodities at ${priceCount} terminal prices · PU ${gameVersion}`);
  writeRaw('commodities.json', {
    source: 'https://uexcorp.space/commodities',
    fetchedAt: new Date().toISOString(),
    gameVersion,
    ptuVersion,
    commodities,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
