// StarStrings (a community add-on that rewrites Star Citizen's global.ini) appends tags to mission titles:
// "[100 Rep]" (reputation on completion) and "[BP]" (the mission can give a blueprint). This reads the tags
// out of its global.ini and writes scripts/starstrings-tags.json, which build-db.js uses only to fill what
// scmdb.net has not: a mission with no reputation, a blueprint mission with no blueprint pool.
// Usage: node scripts/starstrings-tags.js <path to StarStrings' Data/Localization/english/global.ini>
const fs = require('fs');
const path = require('path');

const ini = process.argv[2];
if (!ini) { console.error('Usage: node scripts/starstrings-tags.js <global.ini>'); process.exit(1); }
const out = new Map();
for (const line of fs.readFileSync(ini, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^[^=]+?(?:,P)?=(.*)$/);
  const em = m && m[1].match(/<EM4>((?:\[[^\]]+\]\*?\s*)+)<\/EM4>\s*$/);
  if (!em) continue;
  const tags = em[1].match(/\[[^\]]+\]\*?/g);
  const title = m[1].replace(/\s*<EM4>.*$/, '').trim();
  const rep = tags.map((t) => t.match(/^\[(\d+) Rep\]$/)).find(Boolean); // one plain number only
  const bp = tags.some((t) => /^\[BP\]/.test(t));
  if (!title || (!rep && !bp)) continue;
  const prev = out.get(title) || {};
  out.set(title, { title, rep: prev.rep ?? (rep ? Number(rep[1]) : undefined), bp: prev.bp || bp || undefined });
}
const list = [...out.values()].sort((a, z) => a.title.localeCompare(z.title));
fs.writeFileSync(path.join(__dirname, 'starstrings-tags.json'), JSON.stringify(list, null, 1));
console.log(`${list.length} titles with a tag`);
