// starcitizen.tools factions: who they are, where they work and their reputation ladder (the standing
// names and the reputation each one needs), from api.star-citizen.wiki.
const { getJson, pool, writeRaw, progress } = require('./lib/http');

const API = 'https://api.star-citizen.wiki/api/v2';
const junk = (s) => !s || /PLACEHOLDER|^<=|^\[|^N\/A$/i.test(s);

async function main() {
  const list = (await getJson(`${API}/factions?page%5Bsize%5D=200`)).data.filter((f) => !junk(f.name));
  const details = await pool(list, 3, (f) => getJson(`${API}/factions/${f.uuid}`), { delayMs: 120, onProgress: progress('factions') });
  const factions = [];
  const seen = new Set();
  for (const r of details) {
    const f = r?.data;
    if (!f || junk(f.name)) continue;
    const ladder = f.reputation_ladder;
    const ranks = (ladder?.standings || [])
      .filter((s) => !junk(s.display_name))
      .map((s) => ({ name: s.display_name, min: s.min_reputation }))
      .sort((a, z) => a.min - z.min);
    // Duplicate names (several "Security" factions) keep the one with the most to say.
    const key = f.name.toLowerCase();
    const score = (f.description ? 2 : 0) + ranks.length;
    const prev = factions.findIndex((x) => x.name.toLowerCase() === key);
    if (seen.has(key) && prev >= 0 && factions[prev].score >= score) continue;
    const entry = {
      score,
      name: f.name,
      type: f.faction_type || (f.lawful ? 'Lawful' : 'Unlawful'),
      lawful: !!f.lawful,
      description: junk(f.description) ? null : f.description,
      leadership: junk(f.leadership) ? null : f.leadership,
      area: junk(f.area) ? null : f.area,
      focus: junk(f.focus) ? null : f.focus,
      headquarters: junk(f.headquarters) ? null : f.headquarters,
      founded: junk(f.founded) ? null : f.founded,
      hasReputation: !!f.has_reputation,
      ranks,
      ceiling: ladder?.reputation_ceiling ?? null,
    };
    if (prev >= 0) factions[prev] = entry;
    else factions.push(entry);
    seen.add(key);
  }
  for (const f of factions) delete f.score;
  writeRaw('factions.json', { source: 'https://starcitizen.tools', fetchedAt: new Date().toISOString(), factions });
  console.log(`factions: ${factions.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
