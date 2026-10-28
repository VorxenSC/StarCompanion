// Re-run every collector, then rebuild app/data/db.json. A failed collector keeps its previous dump.
const { spawnSync } = require('child_process');
const path = require('path');

const steps = ['collect-craft.js', 'collect-miner.js', 'collect-wiki.js', 'collect-scmdb.js', 'collect-factions.js', 'collect-faction-logos.js', 'collect-ships.js', 'collect-rsi-prices.js', 'collect-images.js', 'collect-market.js', 'collect-commodities.js', 'collect-cstone.js', 'build-db.js'];
let failed = 0;
for (const step of steps) {
  console.log(`\n=== ${step}`);
  const args = [path.join(__dirname, step)];
  if (step === 'collect-cstone.js' && process.argv.includes('--fresh')) args.push('--fresh');
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    failed++;
    console.error(`${step} failed (exit ${r.status})`);
  }
}
process.exit(failed ? 1 : 0);
