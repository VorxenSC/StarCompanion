// UEX commodities: buy/sell price, stock and demand of every commodity at every trade terminal,
// plus the game version UEX's data is for (PU live).
const { getJson, writeRaw } = require('./lib/http');

const UEX = 'https://api.uexcorp.uk/2.0';

async function main() {
  const [commodities, prices, terminals, versions] = await Promise.all([
    getJson(`${UEX}/commodities`),
    getJson(`${UEX}/commodities_prices_all`),
    getJson(`${UEX}/terminals`),
    getJson(`${UEX}/game_versions`),
  ]);

  const termById = new Map(terminals.data.map((t) => [t.id, t]));
  const where = (id, shop) => {
    const t = termById.get(id);
    const parts = [t?.star_system_name, t?.planet_name, t?.moon_name, t?.city_name || t?.space_station_name || t?.outpost_name, shop].filter(Boolean);
    return parts.filter((v, i) => parts.indexOf(v) === i).join(' - ');
  };

  const byCommodity = new Map();
  for (const p of prices.data) {
    if (!byCommodity.has(p.id_commodity)) byCommodity.set(p.id_commodity, []);
    byCommodity.get(p.id_commodity).push({
      where: where(p.id_terminal, p.terminal_name),
      system: termById.get(p.id_terminal)?.star_system_name || null,
      buy: p.price_buy || null, // what the terminal charges you
      sell: p.price_sell || null, // what the terminal pays you
      // UEX inventory levels, 1 (empty) … 7 (full). Selling side: low inventory = high demand.
      stock: p.status_buy || null,
      inventory: p.status_sell || null,
      scuBuy: p.scu_buy || null,
      scuDemand: p.scu_sell || null,
      // How cargo gets on and off the ship at this terminal.
      autoLoad: !!termById.get(p.id_terminal)?.is_auto_load,
      freightElevator: !!termById.get(p.id_terminal)?.has_freight_elevator,
      loadingDock: !!termById.get(p.id_terminal)?.has_loading_dock,
      updated: p.date_modified,
    });
  }

  const list = commodities.data
    .filter((c) => c.is_visible && byCommodity.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      kind: c.kind,
      illegal: !!c.is_illegal,
      raw: !!c.is_raw,
      refined: !!c.is_refined,
      mineral: !!c.is_mineral,
      volatile: !!(c.is_volatile_qt || c.is_volatile_time),
      explosive: !!c.is_explosive,
      wiki: c.wiki || null,
      locations: byCommodity.get(c.id),
    }));

  console.log(`${list.length} commodities at ${prices.data.length} terminal prices · PU ${versions.data.live}`);
  writeRaw('commodities.json', {
    source: 'https://uexcorp.space/commodities',
    fetchedAt: new Date().toISOString(),
    gameVersion: versions.data.live,
    ptuVersion: versions.data.ptu,
    commodities: list,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
