// Dev helper: list JSON.parse blobs found in a directory of JS bundles.
const fs = require('fs');
const path = require('path');
const { extractJsonParseBlobs } = require('./lib/jsstring');

const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  for (const o of extractJsonParseBlobs(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    const desc = Array.isArray(o)
      ? `array[${o.length}] ${JSON.stringify(o[0]).slice(0, 200)}`
      : Object.keys(o).map((k) => k + (Array.isArray(o[k]) ? `[${o[k].length}]` : '')).join(', ');
    console.log(f, '->', desc);
  }
}
