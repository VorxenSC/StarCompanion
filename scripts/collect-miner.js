// scminer.rocks: mineral directory (locations + abundance), mining heads, modules, gadgets.
// The site is a Next.js app that ships its datasets as JSON.parse('...') blobs inside its JS bundles.
const { getText, writeRaw } = require('./lib/http');
const { extractJsonParseBlobs } = require('./lib/jsstring');

const BASE = 'https://scminer.rocks';
const PAGES = ['/data/ore-by-location', '/data/mineral-directory', '/data/mining-heads', '/data/gadgets', '/data/refineries'];

async function main() {
  const chunkUrls = new Set();
  for (const p of PAGES) {
    const html = await getText(BASE + p);
    for (const m of html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.~-]+\.js/g)) chunkUrls.add(m[0]);
  }
  console.log(`scanning ${chunkUrls.size} bundles`);

  let directory = null; // { version, minerals: [{ name, tier, locations: { stanton: [...] } }] }
  let market = null; // { minerals, miningHeads, modules, gadgets, samplePrices }
  for (const url of chunkUrls) {
    const src = await getText(BASE + url);
    for (const blob of extractJsonParseBlobs(src)) {
      if (blob && Array.isArray(blob.minerals) && blob.minerals[0]?.locations) directory = blob;
      else if (blob && Array.isArray(blob.miningHeads)) market = blob;
    }
  }
  if (!directory) throw new Error('mineral directory blob not found — site layout changed');

  writeRaw('miner.json', {
    source: BASE,
    version: directory.version,
    fetchedAt: new Date().toISOString(),
    minerals: directory.minerals,
    market,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
