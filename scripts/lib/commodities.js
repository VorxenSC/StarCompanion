// UEX commodities: buy/sell price, stock and demand of every commodity at every trade terminal, plus
// the game version UEX's data is for (PU live). Shared by the collector (collect-commodities.js) and
// the running app, which refreshes demand and prices at launch and every 30 minutes.
// getJson(url) is passed in: the collector uses Node's fetch, the app Electron's net.fetch.
const UEX = 'https://api.uexcorp.uk/2.0';

async function fetchCommodities(getJson) {
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

  return { gameVersion: versions.data.live, ptuVersion: versions.data.ptu, commodities: list, priceCount: prices.data.length };
}

// UEX dates are unix seconds; the app shows the day.
const isoDay = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : undefined);

module.exports = { fetchCommodities, isoDay };
