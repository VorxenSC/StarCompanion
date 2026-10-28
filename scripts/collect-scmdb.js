// scmdb.net (the community's Star Citizen mission database): each contract of the live patch, resolved into a
// compact record: who offers it, the cooldown and time limit, group size, rank range, reputation reward, where
// it starts and ends, the enemy ships, the cargo, item rewards and the contracts it leads to. The site's data
// file (~13 MB) holds ids that point into shared tables; they are resolved here into names, so the build only
// reads a few hundred KB. It reads the same public JSON file the site's own page loads, once per update, with a
// plain request. Everything comes from the game's own contract files; the community's play statistics on the
// site (durations, ratings) are other people's submissions and are not used.
const { getJson, writeRaw } = require('./lib/http');

const BASE = 'https://scmdb.net/data';

const clip = (list, n) => (list.length > n ? [...list.slice(0, n), `+${list.length - n}`] : list);
const uniq = (list) => [...new Set(list.filter(Boolean))];

async function main() {
  const versions = await getJson(`${BASE}/versions.json`);
  const live = versions.find((v) => /-live\./.test(v.version)) || versions[versions.length - 1];
  const data = await getJson(`${BASE}/${live.file}`, { timeoutMs: 180000 });
  let history = {};
  try {
    const h = await getJson(`${BASE}/mission-history-${live.version}.json`, { timeoutMs: 60000 });
    history = h.missions || {};
  } catch { /* first-seen versions are a nicety */ }

  const factionName = (guid) => data.factions?.[guid]?.name || null;
  const scopeName = (guid) => data.scopes?.[guid]?.displayName || null;
  const place = (id) => {
    const l = data.locationPools?.[id];
    return l?.name && !/^@/.test(l.name) ? { name: l.name } : null;
  };
  // Place names, without repeats; a contract that starts anywhere in a region lists dozens, so only the first
  // few are kept, with how many there are in all.
  const places = (ids) => uniq((ids || []).map((id) => place(id)?.name));
  const resource = (id) => data.resourcePools?.[id]?.name || null;
  const rep = (list) => (list || []).map((r) => ({ faction: factionName(r.factionGuid), track: scopeName(r.scopeGuid), amount: r.amount })).filter((r) => r.faction && r.amount);
  const rankOf = (s) => (s?.name ? { name: s.name, min: s.minReputation ?? 0 } : null);

  const byId = new Map([...(data.contracts || []), ...(data.legacyContracts || [])].map((c) => [c.id, c]));
  const poolName = (guid) => data.blueprintPools?.[guid]?.name || null;

  const record = (c, legacy) => {
    // The enemy ships: each group (the target, its reinforcements…) with how many and which ships.
    const enemies = (c.shipEncounters?.spawnConfig?.groups || []).map((g) => ({
      role: g.role || null,
      kind: g.classification || null,
      min: g.waves?.reduce((s, w) => s + (w.minShips || 0), 0) || 0,
      max: g.waves?.reduce((s, w) => s + (w.maxShips || 0), 0) || 0,
      ships: clip(data.shipPools?.[g.poolId] || [], 6),
    })).filter((g) => g.max > 0 || g.ships.length);
    // The cargo: what to carry and how much ("all of these", or "one of these sets").
    const orders = (list) => (list || []).map((o) => ({ what: resource(o.resource), min: o.minSCU ?? o.minAmount ?? null, max: o.maxSCU ?? o.maxAmount ?? null, unit: o.minSCU != null || o.maxSCU != null ? 'SCU' : 'items' })).filter((o) => o.what);
    const ho = c.haulingOrders;
    const cargo = !ho ? null : ho.type === 'or' ? { either: (ho.options || []).map(orders).filter((o) => o.length) } : { all: orders(Array.isArray(ho) ? ho : ho.orders) };
    const cargoOk = cargo && ((cargo.either && cargo.either.length) || (cargo.all && cargo.all.length)) ? cargo : null;
    const cd = c.personalCooldownTime || 0;
    const hist = history[c.id];
    return {
      debugName: c.debugName,
      title: c.title,
      titleVariants: c.titleVariants || undefined,
      description: c.description || null,
      contractor: c.contractorName && !/^~mission\(/.test(c.contractorName) ? c.contractorName : null,
      faction: factionName(c.factionGuid),
      category: c.category || null,
      type: c.missionType || null,
      illegal: typeof c.illegal === 'boolean' ? c.illegal : null,
      shareable: typeof c.canBeShared === 'boolean' ? c.canBeShared : null,
      onceOnly: !!c.onceOnly,
      maxPlayers: c.maxPlayersPerInstance || null,
      systems: uniq([...(c.systems || []), ...(c.availableSystems || [])]),
      reward: c.rewardUEC || null,
      buyIn: c.buyIn || null,
      timeLimit: c.timeToComplete || null, // minutes
      // The wait before the same contract can be taken again, in minutes: the game's flag, or more than the
      // 1-minute default most contracts carry.
      cooldown: c.hasPersonalCooldown || cd > 1 ? cd || null : null,
      abandonCooldown: c.canReacceptAfterAbandoning && c.abandonedCooldownTime > 1 ? c.abandonedCooldownTime : null,
      reacceptAfterFail: c.canReacceptAfterFailing ?? null,
      minRank: rankOf(c.minStanding),
      maxRank: rankOf(c.maxStanding),
      rep: rep(c.factionRewardsIndex != null ? data.factionRewardsPools?.[c.factionRewardsIndex] : null),
      repFail: rep(c.factionRewards_fail),
      lockout: (c.reputationLockout || []).map((l) => l.factionName).filter(Boolean),
      ...(() => {
        const from = places(c.locations);
        const to = places(c.destinations);
        return { from: from.slice(0, 8), fromCount: from.length, to: to.slice(0, 8), toCount: to.length };
      })(),
      enemies,
      cargo: cargoOk,
      items: (c.itemRewards || []).map((i) => ({ name: i.name, amount: i.amount })).filter((i) => i.name),
      blueprintPools: (c.blueprintRewards || []).map((b) => ({ pool: b.poolName || poolName(b.blueprintPool), chance: b.chance, on: b.trigger })).filter((b) => b.pool),
      next: uniq((c.subContractIds || []).map((id) => byId.get(id)?.title)),
      after: uniq([c.parentDebugName ? byId.get(c.parentId)?.title : null, ...(c.requiredIntros || []).map((r) => r.title)]),
      firstSeen: hist?.first_seen || null,
      knownIssue: c.knownIssue?.note || null,
      legacy: legacy || undefined,
    };
  };

  const contracts = [...(data.contracts || []).map((c) => record(c, false)), ...(data.legacyContracts || []).map((c) => record(c, true))].filter((c) => c.debugName);
  writeRaw('scmdb.json', { source: 'https://scmdb.net', fetchedAt: new Date().toISOString(), version: live.version, versionsSeen: Object.values(history).length ? [...new Set(Object.values(history).map((h) => h.first_seen))] : [], contracts });
  const withCd = contracts.filter((c) => c.cooldown).length;
  console.log(`scmdb: ${contracts.length} contracts (${live.version}); cooldown ${withCd}, enemies ${contracts.filter((c) => c.enemies.length).length}, cargo ${contracts.filter((c) => c.cargo).length}, from ${contracts.filter((c) => c.from.length).length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
