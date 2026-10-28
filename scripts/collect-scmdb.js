// scmdb.net (the community's Star Citizen mission database): who offers each mission, as the game's own
// contract files say. Only a compact list is kept (the site's data file is ~13 MB), used to check our
// missions and to fill the contractor the wiki leaves out. It reads the same public JSON file the site's
// own page loads, once per update, with a plain request.
const { getJson, writeRaw } = require('./lib/http');

const BASE = 'https://scmdb.net/data';

async function main() {
  const versions = await getJson(`${BASE}/versions.json`);
  const live = versions.find((v) => /-live\./.test(v.version)) || versions[versions.length - 1];
  const data = await getJson(`${BASE}/${live.file}`, { timeoutMs: 180000 });
  const faction = (guid) => data.factions?.[guid]?.name || null;
  const contracts = [...(data.contracts || []), ...(data.legacyContracts || [])].map((c) => ({
    debugName: c.debugName,
    title: c.title,
    contractor: c.contractorName || null,
    faction: faction(c.factionGuid),
    illegal: typeof c.illegal === 'boolean' ? c.illegal : null,
    type: c.missionType || null,
  })).filter((c) => c.debugName);
  writeRaw('scmdb.json', { source: 'https://scmdb.net', fetchedAt: new Date().toISOString(), version: live.version, contracts });
  console.log(`scmdb: ${contracts.length} contracts (${live.version})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
