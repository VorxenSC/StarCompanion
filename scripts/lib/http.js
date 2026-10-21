const fs = require('fs');
const path = require('path');

const UA = 'StarCompanion/0.1 (fan-made Star Citizen overlay; data collector)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url, { retries = 4, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.fatal = true;
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts));
}

// Run async workers over items with a fixed concurrency and an optional delay per task.
async function pool(items, concurrency, worker, { delayMs = 0, onProgress } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: String(err.message || err) };
      }
      done++;
      if (onProgress) onProgress(done, items.length);
      if (delayMs) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

// SC_DATA_DIR is set by the packaged app, which cannot write inside its own install folder.
const RAW_DIR = process.env.SC_DATA_DIR ? path.join(process.env.SC_DATA_DIR, 'raw') : path.join(__dirname, '..', '..', 'data', 'raw');

function writeRaw(name, data) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

function progress(label) {
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (now - last > 2000 || done === total) {
      last = now;
      process.stdout.write(`\r${label}: ${done}/${total}   `);
      if (done === total) process.stdout.write('\n');
    }
  };
}

module.exports = { getText, getJson, pool, writeRaw, progress, sleep, RAW_DIR };
