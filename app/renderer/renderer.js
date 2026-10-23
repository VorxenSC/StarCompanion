/* global CompanionSearch, CompanionI18n, companion */
// Overlay UI following the "Star Companion by Vorxen" Claude Design canvas:
// idle = search bar only; typing opens a panel of one-line results; Enter opens the item detail.
const $ = (id) => document.getElementById(id);
const qEl = $('q');
const panelEl = $('panel');
const scrollEl = $('scroll');
const contentEl = $('content');
const filterEl = $('filter');

const COFFEE_URL = 'https://buymeacoffee.com/fpessoau';
const REPO_URL = 'https://github.com/VorxenSC/StarCompanion';
// Why the app exists, shown in Settings → About (and in the README).
const ABOUT_TEXT =
  "I built Star Companion for players whose PCs struggle to leave Star Citizen: on many machines, a quick Alt+Tab to check a price turns into a long freeze, stutters or even a crash. Here, everything you'd look up sits right on top of the game: press a key, find it, keep flying. And even on a powerful rig, it's simply faster than leaving the cockpit.";
// Translate: the English text is the key (see i18n.js). Section titles, notes, table headers, fact
// labels and link labels are translated by the helpers below; call sites wrap only other text.
const tr = (key, vars) => CompanionI18n.t(key, vars);

const TYPES = [
  ['all', 'All'],
  ['item', 'Items'],
  ['ship', 'Ships'],
  ['blueprint', 'Blueprints'],
  ['mission', 'Missions'],
  ['mineral', 'Minerals'],
  ['commodity', 'Commodities'],
  ['location', 'Locations'],
];
const TYPE_LABEL = { item: 'Item', ship: 'Ship', blueprint: 'Blueprint', mission: 'Mission', mineral: 'Mineral', commodity: 'Commodity', location: 'Location' };
const SRC = { cstone: 'cstone', wiki: 'wiki', uex: 'UEX', scminer: 'scminer' };
const PANEL_GAP = 6; // .panel.open margin-top
const SHRINK_DELAY = 440; // let the panel's height transition finish before the window shrinks

let index = [];
let type = 'all';
let results = [];
let idx = 0;
let detail = null;
let listKey = '';
let maxHeight = 760; // window pixels
let zoom = 1; // text size; layout is measured in CSS px, the window in zoom × CSS px
let gripping = false;
let notice = false; // the "Before you start" notice is in the panel
let recorder = null; // { current, pending, partial, error } while the shortcut recorder is in the panel
let dataDate = '';
let gameVersion = null; // the PU version the database was built for

// "PU 4.10.2" beside the brand; turns amber with a hint when UEX reports a newer live version.
function renderPu(live) {
  const el = $('pu');
  if (!gameVersion) return;
  el.hidden = false;
  const stale = live && live !== gameVersion;
  el.classList.toggle('stale', !!stale);
  el.textContent = stale ? tr('Data PU {data} · PU {live} live', { data: gameVersion, live }) : `PU ${gameVersion}`;
  el.title = stale
    ? tr('The game is now on PU {live}; this data is for PU {data}. Tray menu → Update database.', { live, data: gameVersion })
    : live ? tr('Data matches the live Star Citizen version (PU {live}, per UEX).', { live }) : tr('Data for Star Citizen PU {data}.', { data: gameVersion });
}

// ---------- DOM helpers (all data goes through textContent, never innerHTML) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'delay') el.style.setProperty('--d', `${v}ms`); // CSSOM: allowed by the CSP
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n ?? '—');
const auec = (n) => (typeof n === 'number' && n > 0 ? h('span', { class: 'price' }, `${fmt(n)} aUEC`) : h('span', { class: 'dim' }, '—'));
const usd = (n) => h('span', { class: 'usd' }, `$${Number(n).toLocaleString('en-US')}`);
const link = (label, url) => h('a', { onclick: () => companion.openLink(url) }, label);
const jump = (label, query, t) => h('span', { class: 'link', onclick: () => goTo(query, t) }, label);
const section = (title, ...kids) => [h('div', { class: 'sec-title' }, tr(title)), ...kids];
const note = (text) => h('p', { class: 'note' }, tr(text));
const pct = (m) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;

function table(headers, rows) {
  return h(
    'table',
    null,
    h('thead', null, h('tr', null, headers.map(([label, cls]) => h('th', { class: cls }, label && tr(label))))),
    h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c, i) => h('td', { class: headers[i][1] }, c))))),
  );
}

function links(pairs) {
  const present = pairs.filter(([, url]) => url);
  return present.length ? h('div', { class: 'links' }, present.map(([label, url]) => link(`${tr(label)} ↗`, url))) : null;
}

function shopsTable(shops) {
  const sorted = [...shops].sort((a, z) => (a.price || Infinity) - (z.price || Infinity));
  return table(
    [['Where', ''], ['Price', 'num'], ['Sells for', 'num'], ['Verified', 'dim'], ['Source', 'dim']],
    sorted.map((s) => [s.where, auec(s.price), s.sell ? auec(s.sell) : '', s.verified || '', SRC[s.src] || s.src]),
  );
}

// ---------- Detail views: { facts: [[label, value]], body: [nodes] } ----------
function viewItem(e) {
  const d = e.d;
  const attrs = Object.entries(d.attrs || {})
    .filter(([k]) => k !== 'MANUFACTURER')
    .map(([k, v]) => [k.charAt(0) + k.slice(1).toLowerCase(), v]);
  const cheapest = d.shops?.filter((s) => s.price > 0).sort((a, z) => a.price - z.price)[0];
  const m = d.market;
  const uexUrl = d.uexId && `https://uexcorp.space/marketplace/?id_item=${d.uexId}`;
  return {
    facts: [
      ['Manufacturer', d.manufacturer],
      ['Type', d.type],
      ['Size', d.size],
      ['Grade', d.grade],
      ['Class', d.class],
      ['Lowest price', cheapest && auec(cheapest.price)],
      ['Player market', m && h('span', null, h('span', { class: 'price' }, `~${fmt(m.approx)} aUEC`))],
      ['Craftable', d.craftable],
      ['Loot', d.lootable ? 'Can be found as loot' : null],
      ...attrs,
    ],
    body: [
      d.blueprint && section('Blueprint', jump(`View the ${e.n} blueprint →`, e.n, 'blueprint')),
      section(
        'Where to buy',
        d.shops?.length ? shopsTable(d.shops) : note(d.lootable ? 'Not sold in any known shop — found as loot.' : 'No known shop in the sources.'),
      ),
      (m || uexUrl) &&
        section(
          'Player market (UEX)',
          m
            ? table(
                [['Approx. asking price', ''], ['Range', 'num'], ['Offers', 'num'], ['Latest', 'dim']],
                [[auec(m.approx), h('span', null, auec(m.min), ' – ', auec(m.max)), `${m.sellCount} selling${m.buyCount ? ` · ${m.buyCount} buying` : ''}`, m.newest]],
              )
            : note('Not listed by players right now.'),
          m && note('Median of open player sell offers on the UEX marketplace; quality, pips and bundles vary, so check the listings.'),
          uexUrl && h('p', { class: 'note' }, link('Open the UEX marketplace filtered for this item ↗', uexUrl)),
        ),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['UEX market', uexUrl], ['cstone', d.cstoneUrl], ['Wiki', d.wikiUrl], ['scminer', d.minerUrl]]),
    ],
  };
}

function viewShip(e) {
  const d = e.d;
  const store = d.store || [];
  // The ship's own price: its standalone listing (never a package), else the RSI MSRP.
  const standalone = store.find((s) => s.standalone && !s.warbond && s.available) || store.find((s) => s.standalone && !s.warbond);
  const storePrice = standalone ? standalone.discountedUsd || standalone.usd : d.msrp;
  // Warbond: a discounted offer payable only with new money, shown only while it is on sale.
  const warbond = store.find((s) => s.warbond && s.available && !s.pack);
  const lastWarbond = !warbond && store.filter((s) => s.warbond && !s.pack).sort((a, z) => (z.checked || '').localeCompare(a.checked || ''))[0];
  return {
    facts: [
      ['Size', [d.size, d.sizeClass && `class ${d.sizeClass}`].filter(Boolean).join(' · ')],
      ['Crew', d.crew && (d.crew.min === d.crew.max ? d.crew.min : `${d.crew.min}–${d.crew.max}`)],
      ['Cargo', d.cargo != null && `${fmt(d.cargo)} SCU`],
      ['Speed', d.speed && `SCM ${fmt(d.speed.scm)} · max ${fmt(d.speed.max)}`],
      ['Hull', d.health && fmt(Math.round(d.health))],
      ['Shield', d.shieldHp && fmt(Math.round(d.shieldHp))],
      ['Pilot DPS', d.pilotDps && fmt(Math.round(d.pilotDps))],
      ['Store price', storePrice && usd(storePrice)],
      ['Warbond', warbond && h('span', null, usd(warbond.discountedUsd || warbond.usd), ' ', h('span', { class: 'badge-warbond' }, 'WARBOND'))],
      ['In-game price', d.buy?.[0]?.price && auec(d.buy[0].price)],
      ['Last warbond', lastWarbond && `$${lastWarbond.discountedUsd || lastWarbond.usd} · ended`],
      ['Status', d.status],
    ],
    body: [
      section(
        'Price in USD (RSI store)',
        store.length
          ? [
              table(
                [['Offer', ''], ['USD', 'num'], ['', 'dim'], ['Checked', 'dim']],
                store.map((s) => [
                  link(s.title, s.url),
                  s.discountedUsd ? h('span', null, usd(s.discountedUsd), ' ', h('s', { class: 'dim' }, `$${s.usd}`)) : usd(s.usd),
                  h('span', null, s.warbond ? h('span', { class: 'badge-warbond' }, 'WARBOND') : null, ' ', [s.pack && 'package', s.available ? 'on sale' : 'off sale'].filter(Boolean).join(', ')),
                  s.checked || '',
                ]),
              ),
              store.some((s) => s.warbond) && note('Warbond: a discounted offer that must be paid with new money (not store credit).'),
            ]
          : d.msrp
            ? h('p', { class: 'note' }, usd(d.msrp), ' MSRP — not listed in the store right now.')
            : note('No USD price (not sold in the RSI store).'),
      ),
      section('Buy in game (aUEC)', d.buy?.length ? shopsTable(d.buy) : note('Not sold in any in-game shop.')),
      d.rent?.length && section('Rent in game', shopsTable(d.rent)),
      d.loadout?.length &&
        section(
          'Default components',
          table(
            [['Slot', 'dim'], ['Component', ''], ['Size', 'num'], ['Grade', 'num']],
            groupLoadout(d.loadout).map((l) => [l.port, h('span', null, jump(l.item, l.item, 'item'), l.count > 1 ? ` ×${l.count}` : ''), l.size ?? '', l.grade ?? '']),
          ),
        ),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['Wiki', d.wikiUrl], ['RSI store', d.pledgeUrl], ['cstone', d.cstoneUrl]]),
    ],
  };
}

function groupLoadout(loadout) {
  const m = new Map();
  for (const l of loadout) {
    const k = `${l.port}|${l.item}`;
    if (m.has(k)) m.get(k).count++;
    else m.set(k, { ...l, count: 1 });
  }
  return [...m.values()];
}

function viewBlueprint(e) {
  const d = e.d;
  const mins = Math.round((d.craftTime || 0) / 60);
  const best = d.missions[0];
  return {
    facts: [
      ['Craft time', d.craftTime ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : `${mins} min`) : null],
      ['Materials', d.ingredients.length],
      ['Missions', d.missions.length || (d.defaultOwned ? 'Default blueprint' : 'None known')],
      ['Best drop', best && `${Math.round(best.chance * 100)}% · ${best.name}`],
    ],
    body: [
      section(
        'Materials',
        table(
          [['Slot', 'dim'], ['Material', ''], ['Qty', 'num'], ['Quality affects', 'dim']],
          d.ingredients.map((ing) => [
            ing.slot,
            h('span', null, ing.options.map((o, i) => [i ? ' or ' : '', jump(o.name, o.name, 'mineral')])),
            ing.options.map((o) => `${o.qty} ${o.unit === 'scu' ? 'SCU' : 'pcs'}`).join(' / '),
            ing.effects.map((f) => `${f.stat} ${pct(f.min)}→${pct(f.max)}`).join(', '),
          ]),
        ),
      ),
      section(
        'Missions that reward it',
        d.missions.length
          ? table([['Mission', ''], ['Chance', 'num']], d.missions.map((m) => [jump(m.name, m.name, 'mission'), `${Math.round(m.chance * 100)}%`]))
          : note(d.defaultOwned ? 'Every player already owns this blueprint.' : 'No known mission.'),
      ),
      section('Item', jump(`Where to buy a ready-made ${e.n} →`, e.n, 'item')),
      links([['sc-craft.tools', d.url]]),
    ],
  };
}

function viewMission(e) {
  const d = e.d;
  const reward = d.rewardMin ? `${fmt(d.rewardMin)}${d.rewardMax > d.rewardMin ? ` – ${fmt(d.rewardMax)}` : ''} ${d.currency === 'UEC' ? 'aUEC' : d.currency || ''}` : null;
  return {
    facts: [
      ['Contractor', d.giver],
      ['Faction', d.faction],
      ['Systems', d.systems?.join(', ')],
      ['Legality', d.legal],
      ['Reward', reward],
      ['Minimum reputation', d.minStanding],
      ['Blueprints', d.blueprints?.length],
      ['Combat', d.combat],
      ['Cargo hauling', d.hauling],
      ['Shareable', d.shareable],
      ['One-time only', d.onceOnly],
    ],
    body: [
      d.blueprints?.length &&
        section(
          'Blueprints it can reward',
          table([['Blueprint', ''], ['Chance', 'num']], d.blueprints.map((b) => [jump(b.name, b.name, 'blueprint'), `${Math.round(b.chance * 100)}%`])),
        ),
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['Wiki', d.url]]),
    ],
  };
}

function viewMineral(e) {
  const d = e.d;
  const systems = Object.entries(d.locations || {}).filter(([, list]) => list.length);
  const top = systems.flatMap(([, list]) => list).sort((a, z) => z.abundance - a.abundance)[0];
  return {
    facts: [
      ['Found at', top && `${top.name} · ${top.abundance}%`],
      ['Sell value', d.bestSell && h('span', null, auec(d.bestSell.price), ' / SCU')],
      ['Best sale at', d.bestSell?.where],
      ['Scan signature', d.signature && fmt(d.signature)],
      ['Instability', d.props?.instability],
      ['Resistance', d.props?.resistance],
      ['Found with', [d.props?.secondary, d.props?.tertiary].filter((x) => x && x !== '-').join(', ')],
    ],
    body: [
      d.commodity && section('Trading', jump(`Prices and demand per location for ${e.n} →`, e.n, 'commodity')),
      section(
        'Where to mine',
        systems.length
          ? systems.map(([sys, list]) => [
              h('div', { class: 'system' }, sys.toUpperCase()),
              table([['Location', ''], ['Abundance', 'num']], [...list].sort((a, z) => z.abundance - a.abundance).map((l) => [l.name, `${l.abundance}%`])),
            ])
          : note('No known locations.'),
      ),
      d.usedIn?.length &&
        section(`Used in ${d.usedInCount} blueprints`, h('div', null, d.usedIn.map((n) => h('span', { class: 'pill' }, jump(n, n, 'blueprint'))))),
      links([['scminer', d.url]]),
    ],
  };
}

// UEX inventory levels run 1 (empty) … 7 (full). For selling to a terminal, an empty inventory means
// the terminal wants it: demand is the inverse of its inventory. For buying, the level is the stock.
const DEMAND = ['', 'Very high', 'High', 'Good', 'Medium', 'Low', 'Very low', 'None'];
const STOCK = ['', 'Out of stock', 'Very low', 'Low', 'Medium', 'High', 'Very high', 'Full'];
function meter(filled, label, tone) {
  return h(
    'span',
    { class: `meter tone-${tone}`, title: label },
    h('span', { class: 'meter-bar' }, Array.from({ length: 7 }, (_, i) => h('i', { class: i < filled ? 'on' : null }))),
    h('span', { class: 'meter-label' }, label),
  );
}
const demandMeter = (inventory) => (inventory ? meter(8 - inventory, DEMAND[inventory], inventory <= 2 ? 'good' : inventory <= 4 ? 'mid' : 'low') : h('span', { class: 'dim' }, '—'));
const stockMeter = (stock) => (stock ? meter(stock, STOCK[stock], stock >= 5 ? 'good' : stock >= 3 ? 'mid' : 'low') : h('span', { class: 'dim' }, '—'));
// How cargo moves at the terminal: auto load/unload, else a freight elevator or a loading dock.
function placeCell(l) {
  const tag = l.autoLoad ? ['AUTO LOAD', 'auto'] : l.freightElevator ? ['ELEVATOR', 'manual'] : l.loadingDock ? ['DOCK', 'manual'] : null;
  return h('span', null, l.where, tag && h('span', { class: `badge-load ${tag[1]}`, title: l.autoLoad ? 'Cargo is loaded and unloaded automatically' : 'Cargo is moved by hand' }, tag[0]));
}

// "Stanton - microTech - New Babbage - TDD New Babbage" → "New Babbage - TDD New Babbage" for the header.
const shortWhere = (where) => where.split(' - ').slice(-2).join(' - ');

function viewCommodity(e) {
  const d = e.d;
  const sells = d.locations.filter((l) => l.sell).sort((a, z) => z.sell - a.sell);
  const buys = d.locations.filter((l) => l.buy).sort((a, z) => a.buy - z.buy);
  const at = (price, where) => h('span', null, auec(price), h('span', { class: 'headline-where' }, shortWhere(where)));
  return {
    facts: [
      ['Best sale', sells[0] && at(sells[0].sell, sells[0].where)],
      ['Cheapest buy', buys[0] && at(buys[0].buy, buys[0].where)],
      ['Code', d.code],
      ['Sell at', sells.length ? `${sells.length} terminals` : 'Nowhere listed'],
      ['Buy at', buys.length ? `${buys.length} terminals` : 'Nowhere listed'],
      ['Auto load/unload', d.locations.length ? `${d.locations.filter((l) => l.autoLoad).length} of ${d.locations.length} locations` : null],
      ['Legality', d.illegal ? 'Illegal — scanned cargo is contraband' : null],
    ],
    body: [
      d.mineral && section('Mining', jump(`Where to mine ${e.n} →`, e.n, 'mineral')),
      section(
        'Sell here · demand per location',
        sells.length
          ? table(
              [['Location', ''], ['Pays / SCU', 'num'], ['Demand', ''], ['Updated', 'dim']],
              sells.map((l) => [placeCell(l), auec(l.sell), demandMeter(l.inventory), l.updated || '']),
            )
          : note('No terminal buys it.'),
      ),
      section(
        'Buy here · stock per location',
        buys.length
          ? table(
              [['Location', ''], ['Costs / SCU', 'num'], ['Stock', ''], ['Updated', 'dim']],
              buys.map((l) => [placeCell(l), auec(l.buy), stockMeter(l.stock), l.updated || '']),
            )
          : note('No terminal sells it.'),
      ),
      note('Demand and stock are UEX inventory levels reported by players; they move as people trade. AUTO LOAD: cargo is loaded and unloaded for you; ELEVATOR / DOCK: you move it by hand.'),
      links([['UEX', d.url], ['Wiki', d.wikiUrl]]),
    ],
  };
}

function viewLocation(e) {
  const d = e.d;
  return {
    facts: [['Type', d.type], ['Inside', d.parent], ['System', d.system], ['Missions available', d.missionCount || null]],
    body: [d.description && section('Description', h('p', { class: 'desc' }, d.description)), links([['Wiki', d.url]])],
  };
}

const VIEWS = { item: viewItem, ship: viewShip, blueprint: viewBlueprint, mission: viewMission, mineral: viewMineral, commodity: viewCommodity, location: viewLocation };

// cstone hosts a picture for most items and ships it lists.
function imageFor(e) {
  const id = e.d.cstoneUrl?.split('/').pop();
  if (!id) return null;
  const img = h('img', { class: 'detail-img', alt: '', src: `https://cstone.space/uifimages/${id}.png` });
  img.addEventListener('error', () => { img.remove(); fit(); });
  img.addEventListener('load', fit);
  return img;
}

// The one or two facts worth reading first; they sit beside the name, the rest go in the grid below.
const HEADLINE = {
  item: ['Lowest price', 'Player market'],
  ship: ['Store price', 'Warbond', 'In-game price'],
  blueprint: ['Craft time'],
  mission: ['Reward'],
  mineral: ['Sell value', 'Found at'],
  commodity: ['Best sale', 'Cheapest buy'],
  location: ['System'],
};

function renderDetail(e) {
  const { facts, body } = VIEWS[e.t](e);
  const shown = facts.filter(([, v]) => v != null && v !== '' && v !== false);
  const headline = shown.filter(([label]) => HEADLINE[e.t].includes(label));
  const rest = shown.filter(([label]) => !HEADLINE[e.t].includes(label));
  return h(
    'div',
    { class: 'detail' },
    // Header: picture, then type, name, class and the headline facts.
    h(
      'div',
      { class: 'detail-head' },
      imageFor(e),
      h(
        'div',
        { class: 'detail-main' },
        h(
          'div',
          { class: 'detail-top' },
          h('span', { class: 'detail-type in' }, TYPE_LABEL[e.t]),
          h('button', { class: 'back', onclick: back }, 'Back ', h('kbd', null, 'ESC')),
        ),
        h('div', { class: 'detail-name in', delay: 40 }, e.n),
        h('div', { class: 'detail-meta in', delay: 110 }, e.s || ''),
        headline.length > 0 &&
          h(
            'div',
            { class: 'headline' },
            headline.map(([label, value], i) =>
              h('div', { class: 'headline-fact' }, h('span', { class: 'fact-label in', delay: 150 + i * 60 }, label), h('span', { class: 'headline-value in', delay: 150 + i * 60 }, value)),
            ),
          ),
      ),
    ),
    // Everything else spread across the full width.
    rest.length > 0 &&
      h(
        'div',
        { class: 'facts' },
        rest.map(([label, value], i) => {
          const d = 200 + Math.min(i, 12) * 40;
          return h(
            'div',
            { class: 'fact' },
            h('div', { class: 'scan', delay: d }),
            h('span', { class: 'fact-label in', delay: d }, label),
            h('span', { class: 'fact-value in', delay: d }, value === true ? 'Yes' : value),
          );
        }),
      ),
    h('div', { class: 'rise', delay: 420 }, body),
  );
}

function renderList() {
  return h(
    'div',
    { class: 'list' },
    results.map((e, i) => {
      const d = Math.min(i, 12) * 45;
      return h(
        'button',
        { class: `row${i === idx ? ' active' : ''}`, onclick: () => open(i), onmousemove: () => setIdx(i, false) },
        h('div', { class: 'scan', delay: d }),
        h('span', { class: 'row-type in', delay: d }, TYPE_LABEL[e.t]),
        h('span', { class: 'row-name in', delay: d }, e.n),
        h('span', { class: 'row-meta in', delay: d }, e.s || ''),
        rowArrow(),
      );
    }),
  );
}

function rowArrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'row-arrow');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 8 H12 M8 4 L12 8 L8 12');
  path.setAttribute('stroke', '#5FD4E8');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('fill', 'none');
  svg.append(path);
  return svg;
}

// ---------- Startup notice: what the overlay needs to work ----------
function renderNotice() {
  const key = $('hotkey').textContent;
  const items = [
    ['Borderless window', 'Run Star Citizen in Borderless mode (Graphics → Window Mode). No overlay can appear over exclusive Fullscreen.'],
    [`${key} to open`, `Press ${key} or click the small icon to open and close the search. To use another key, click ${key} in the search bar or use the tray menu → Change hotkey.`],
    ['Internet', 'Search works offline. Item pictures, links, "Update database" and app updates need a connection.'],
    ['Community data', `Prices, shops, locations and drop chances come from community sites (cstone, sc-craft.tools, scminer.rocks, starcitizen.tools, UEX) and can lag behind a new patch. Data for PU ${gameVersion || '?'}, collected ${dataDate || 'with the bundled database'}; the PU tag turns amber when a new patch is live. Check in game before a long trip.`],
    ['Unofficial', 'A fan-made tool, not affiliated with Cloud Imperium Games or Roberts Space Industries.'],
  ];
  const dont = h('input', { type: 'checkbox', id: 'notice-dont' });
  return h(
    'div',
    { class: 'notice' },
    h('div', { class: 'detail-type in' }, 'Before you start'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Star Companion needs'),
    h(
      'div',
      { class: 'notice-list' },
      items.map(([title, text], i) => {
        const d = 140 + i * 70;
        return h('div', { class: 'fact notice-item' }, h('div', { class: 'scan', delay: d }), h('span', { class: 'fact-label in', delay: d }, title), h('p', { class: 'notice-text rise', delay: d + 60 }, text));
      }),
    ),
    h(
      'p',
      { class: 'notice-support rise', delay: 480 },
      'Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7',
      h('a', { class: 'coffee', onclick: () => companion.openLink(COFFEE_URL) }, 'Buy me a coffee ↗'),
    ),
    h(
      'div',
      { class: 'notice-actions rise', delay: 520 },
      h('label', { class: 'notice-check' }, dont, ' Don’t show this again'),
      h('button', { class: 'notice-ok', onclick: () => dismissNotice() }, 'Got it ', h('kbd', null, 'ENTER')),
    ),
  );
}

function showNotice() {
  notice = true;
  render();
  qEl.focus();
}

function dismissNotice() {
  if (!notice) return;
  companion.noticeDone(!!$('notice-dont')?.checked);
  notice = false;
  render();
  qEl.focus();
}

// ---------- Settings panel ----------
let settingsOpen = false;
let settings = null; // snapshot from the main process
let settingsDrawn = false; // animate the panel's entrance once, not on every change

async function openSettings() {
  recorder = null;
  notice = false;
  if (feedback) feedback.open = false;
  settings = await companion.getSettings();
  settingsOpen = true;
  settingsDrawn = false;
  render();
}

function closeSettings() {
  settingsOpen = false;
  render();
  qEl.focus();
}

async function changeSetting(key, value) {
  settings = await companion.setSetting(key, value);
  render();
}

async function settingsAction(action) {
  settings = await companion.settingsAction(action);
  if (action === 'notice') settingsOpen = false; // the notice takes the panel
  render();
}

function renderSettings() {
  const s = settings;
  const anim = !settingsDrawn;
  settingsDrawn = true;
  const cls = (c) => (anim ? c : c.replace(/\b(in|rise)\b/g, '').trim());
  const pct = (v) => `${Math.round(v * 100)}%`;
  const toggle = (key, on, disabled) =>
    h('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: disabled ? 'disabled' : null, onclick: () => changeSetting(key, !on) }, h('i'));
  const steps = (key, list, current, disabled) =>
    h('span', { class: 'seg', role: 'group' }, list.map((v) => h('button', { class: `seg-btn${Math.abs(current - v) < 0.001 ? ' on' : ''}`, disabled: disabled ? 'disabled' : null, onclick: () => changeSetting(key, v) }, pct(v))));
  const row = (label, hint, control, i) =>
    h('div', { class: cls('set-row rise'), delay: 120 + i * 35 }, h('div', { class: 'set-text' }, h('span', { class: 'set-label' }, label), hint && h('span', { class: 'set-hint' }, hint)), h('div', { class: 'set-control' }, control));
  const group = (title) => h('div', { class: cls('set-group rise'), delay: 100 }, title);
  let i = 0;
  return h(
    'div',
    { class: 'notice settings' },
    h('div', { class: 'detail-top' }, h('span', { class: cls('detail-type in') }, 'Settings'), h('button', { class: 'back', onclick: closeSettings }, 'Done ', h('kbd', null, 'ESC'))),
    h('div', { class: cls('detail-name in'), delay: 40 }, 'Star Companion'),
    group('Opening'),
    row('Shortcut', 'Opens and closes the search, even in game', h('span', { class: 'set-inline' }, h('kbd', null, s.hotkey), h('button', { class: 'set-btn', onclick: () => startRecorder(s.hotkey) }, 'Change')), i++),
    row('Start with Windows', s.canStartWithWindows ? 'Launch quietly when you sign in' : 'Available in the installed app', toggle('startWithWindows', s.startWithWindows, !s.canStartWithWindows), i++),
    row('Close when clicking the game', 'Fold back into the icon when the game gets focus', toggle('hideOnBlur', s.hideOnBlur), i++),
    group('Look'),
    row('Show icon when closed', 'A faint icon stays on screen; click it to open', toggle('dock', s.dock), i++),
    row('Icon opacity', 'How visible the icon is while you play', steps('dockOpacity', s.steps.dockOpacity, s.dockOpacity, !s.dock), i++),
    row('Window opacity', null, steps('opacity', s.steps.opacity, s.opacity), i++),
    row('Text size', 'Also Ctrl + = and Ctrl + -', steps('zoom', s.steps.zoom, s.zoom), i++),
    row('Position and size', 'Back to the default place and size', h('button', { class: 'set-btn', onclick: () => settingsAction('resetLayout') }, 'Reset'), i++),
    group('Updates and help'),
    row('Check for updates at launch', `You have v${s.version}`, h('span', { class: 'set-inline' }, toggle('checkUpdates', s.checkUpdates), h('button', { class: 'set-btn', onclick: () => settingsAction('checkUpdates') }, 'Check now')), i++),
    row('Startup notice', 'What the overlay needs to work', h('button', { class: 'set-btn', onclick: () => settingsAction('notice') }, 'Show'), i++),
    row('Settings file', 'For advanced edits; opens its folder', h('button', { class: 'set-btn', onclick: () => settingsAction('showFile') }, 'Show in folder'), i++),
    group('About Star Companion'),
    h('p', { class: cls('about-text rise'), delay: 120 + i++ * 35 }, tr(ABOUT_TEXT)),
    h(
      'div',
      { class: cls('about-links rise'), delay: 120 + i++ * 35 },
      h('span', { class: 'dim' }, `Star Companion v${s.version} · by Vorxen`),
      h('span', { class: 'set-inline' }, h('button', { class: 'set-btn', onclick: () => { settingsOpen = false; openFeedback(); } }, tr('Suggest')), h('button', { class: 'set-btn coffee-btn', onclick: () => companion.openLink(COFFEE_URL) }, tr('Buy me a coffee')), h('button', { class: 'set-btn', onclick: () => companion.openLink(REPO_URL) }, 'GitHub')),
    ),
  );
}

// ---------- Suggestions form ----------
// The draft survives closing the form; it is cleared only once sent.
const FEEDBACK_KINDS = ['Idea', 'Bug', 'Wrong or missing data', 'Other'];
let feedback = null; // { open, kind, message, name, email, includeInfo, status: '' | 'sending' | 'sent', error }

function openFeedback() {
  feedback = { ...(feedback?.status === 'sent' ? {} : feedback), open: true, status: '', error: '' };
  feedback.kind ||= 'Idea';
  feedback.includeInfo ??= true;
  recorder = null;
  notice = false;
  render();
  setTimeout(() => $('fb-message')?.focus(), 50);
}

function closeFeedback() {
  if (!feedback) return;
  feedback.open = false;
  render();
  qEl.focus();
}

async function submitFeedback() {
  const f = feedback;
  if (!f || f.status === 'sending') return;
  if ((f.message || '').trim().length < 10) {
    f.error = 'Please write at least a sentence.';
    return refreshFeedbackStatus();
  }
  f.status = 'sending';
  f.error = '';
  refreshFeedbackStatus();
  const res = await companion.sendFeedback({ kind: f.kind, message: f.message, name: f.name, email: f.email, includeInfo: f.includeInfo, gameVersion });
  if (res.ok) {
    feedback = { open: true, status: 'sent' };
    render();
    setTimeout(() => feedback?.status === 'sent' && closeFeedback(), 5000);
  } else {
    f.status = '';
    f.error = res.error;
    refreshFeedbackStatus();
  }
}

// Updates the status line and button without rebuilding the form (keeps focus and caret).
function refreshFeedbackStatus() {
  const el = $('fb-status');
  if (el) {
    el.textContent = feedback.status === 'sending' ? 'Sending…' : feedback.error || '';
    el.classList.toggle('err', !!feedback.error);
  }
  const btn = $('fb-send');
  if (btn) btn.disabled = feedback.status === 'sending';
}

function renderFeedback() {
  const f = feedback;
  if (f.status === 'sent') {
    return h(
      'div',
      { class: 'notice feedback' },
      h('div', { class: 'detail-type in' }, 'Suggestions'),
      h('div', { class: 'detail-name in', delay: 40 }, 'Thank you, citizen — o7'),
      h('p', { class: 'notice-text rise', delay: 120 }, 'Your message is on its way to the developer. Every idea is read.'),
      h('div', { class: 'notice-actions rise', delay: 200 }, h('span'), h('button', { class: 'notice-ok', onclick: closeFeedback }, 'Back to search ', h('kbd', null, 'ESC'))),
    );
  }
  const field = (id, label, input) => h('label', { class: 'fb-field', for: id }, h('span', { class: 'fact-label' }, label), input);
  const bind = (key) => (ev) => { f[key] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; if (key === 'message') $('fb-count').textContent = `${f.message.length}/4000`; };
  const message = h('textarea', { id: 'fb-message', class: 'fb-input fb-message', maxlength: '4000', rows: '5', placeholder: 'What would make Star Companion better? What broke, or what did you not find?', oninput: bind('message') });
  message.value = f.message || '';
  const name = h('input', { id: 'fb-name', class: 'fb-input', maxlength: '80', placeholder: 'e.g. Vorxen#1234', oninput: bind('name') });
  name.value = f.name || '';
  const email = h('input', { id: 'fb-email', class: 'fb-input', type: 'email', maxlength: '120', placeholder: 'you@example.com', oninput: bind('email') });
  email.value = f.email || '';
  const info = h('input', { type: 'checkbox', id: 'fb-info', onchange: bind('includeInfo') });
  info.checked = f.includeInfo;
  return h(
    'div',
    { class: 'notice feedback' },
    h('div', { class: 'detail-type in' }, 'Suggestions'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Help shape Star Companion'),
    h('p', { class: 'notice-text rise', delay: 100 }, 'Ideas, bugs, wrong prices or missing items: it goes straight to the developer.'),
    h(
      'div',
      { class: 'fb-kinds rise', delay: 140, role: 'group', 'aria-label': 'Kind of suggestion' },
      FEEDBACK_KINDS.map((k) =>
        h('button', { class: `fb-kind${f.kind === k ? ' on' : ''}`, 'aria-pressed': f.kind === k ? 'true' : 'false', onclick: (ev) => { f.kind = k; ev.currentTarget.parentElement.querySelectorAll('.fb-kind').forEach((b) => { const on = b.textContent === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); } }, k),
      ),
    ),
    h('div', { class: 'rise', delay: 180 }, field('fb-message', 'Your message', message), h('div', { class: 'fb-count', id: 'fb-count' }, `${(f.message || '').length}/4000`)),
    h('div', { class: 'fb-row rise', delay: 220 }, field('fb-name', 'Name or Discord · optional', name), field('fb-email', 'Email for a reply · optional', email)),
    h('label', { class: 'notice-check rise', delay: 260 }, info, ` Include app version and PU ${gameVersion || ''}`),
    h(
      'div',
      { class: 'notice-actions rise', delay: 300 },
      h('span', { class: 'fb-status', id: 'fb-status', role: 'status' }, f.error || ''),
      h('span', { class: 'fb-buttons' }, h('button', { class: 'back', onclick: closeFeedback }, 'Cancel ', h('kbd', null, 'ESC')), h('button', { class: 'notice-ok', id: 'fb-send', onclick: submitFeedback }, 'Send ', h('kbd', null, 'CTRL+ENTER'))),
    ),
  );
}

// ---------- Shortcut recorder ----------
function keyChips(accelerator) {
  return accelerator.split('+').map((k, i) => [i ? h('span', { class: 'rec-plus' }, '+') : null, h('kbd', { class: 'rec-key' }, k)]);
}

function renderRecorderKeys() {
  const r = recorder;
  const shown = r.pending || (r.partial?.length ? `${r.partial.join('+')}+…` : null);
  return h('div', { class: `rec-box${r.pending ? ' set' : ''}`, id: 'rec-box' }, shown ? keyChips(shown) : h('span', { class: 'rec-wait' }, 'Waiting for keys…'));
}

function renderRecorder() {
  const r = recorder;
  return h(
    'div',
    { class: 'notice recorder' },
    h('div', { class: 'detail-type in' }, 'Keyboard shortcut'),
    h('div', { class: 'detail-name in', delay: 40 }, 'Press the new shortcut'),
    h('p', { class: 'notice-text rise', delay: 120 }, 'An F-key or numpad key works alone; letters and numbers need Ctrl, Alt or Shift. It opens and closes Star Companion from anywhere, including in game.'),
    h('div', { class: 'rise', delay: 180 }, renderRecorderKeys()),
    h('div', { class: 'rec-meta rise', delay: 220 }, h('span', null, 'Current: ', h('kbd', null, r.current)), h('span', { class: 'rec-error', id: 'rec-error' }, r.error || '')),
    h(
      'div',
      { class: 'notice-actions rise', delay: 260 },
      h('button', { class: 'back', onclick: cancelRecorder }, 'Cancel ', h('kbd', null, 'ESC')),
      h('button', { class: 'notice-ok', id: 'rec-save', onclick: saveRecorder, disabled: r.pending ? null : 'disabled' }, 'Save ', h('kbd', null, 'ENTER')),
    ),
  );
}

// Updates only the keys, error and button, so the entrance animation doesn't replay on every key.
function refreshRecorder() {
  $('rec-box')?.replaceWith(renderRecorderKeys());
  const err = $('rec-error');
  if (err) err.textContent = recorder.error || '';
  const save = $('rec-save');
  if (save) save.disabled = !recorder.pending;
}

function startRecorder(current) {
  recorder = { current: current || $('hotkey').textContent, pending: null, partial: null, error: '' };
  notice = false;
  companion.hotkeyRecording(true);
  render();
}

function cancelRecorder() {
  if (!recorder) return;
  recorder = null;
  companion.hotkeyRecording(false);
  render();
  qEl.focus();
}

async function saveRecorder() {
  if (!recorder?.pending) return;
  const res = await companion.setHotkey(recorder.pending);
  if (!res.ok) {
    recorder.error = tr(res.error, res.vars);
    recorder.pending = null;
    companion.hotkeyRecording(true); // the failed attempt put the old shortcut back; keep it off while recording
    refreshRecorder();
    return;
  }
  $('hotkey').textContent = $('hotkey2').textContent = res.hotkey;
  recorder = null;
  if (settingsOpen) settings = await companion.getSettings(); // back to the settings, showing the new key
  render();
  qEl.focus();
}

function recorderKey(ev) {
  if (ev.key === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) return cancelRecorder();
  if (ev.key === 'Enter' && recorder.pending && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) return saveRecorder();
  const res = CompanionHotkey.fromEvent(ev);
  recorder.partial = res.partial || null;
  if (res.accelerator) {
    recorder.pending = res.accelerator;
    recorder.error = '';
  } else if (res.error) {
    recorder.pending = null;
    recorder.error = tr(res.error, res.vars);
  }
  refreshRecorder();
}

// ---------- State → screen ----------
function render() {
  const q = qEl.value.trim();
  filterEl.textContent = type === 'all' ? '' : `Filter · ${TYPES.find(([t]) => t === type)[1]}`;
  if (recorder) {
    listKey = '';
    contentEl.replaceChildren(renderRecorder());
  } else if (settingsOpen) {
    listKey = '';
    contentEl.replaceChildren(renderSettings());
  } else if (feedback?.open) {
    listKey = '';
    contentEl.replaceChildren(renderFeedback());
  } else if (notice) {
    listKey = '';
    contentEl.replaceChildren(renderNotice());
  } else if (!q) {
    listKey = '';
    detail = null;
    contentEl.replaceChildren();
  } else if (detail) {
    listKey = '';
    contentEl.replaceChildren(renderDetail(detail));
  } else if (results.length) {
    // Same result set as on screen: keep the rows (and their finished animation), just move the highlight.
    const key = `${type}|${results.map((e) => e.id).join()}`;
    if (key !== listKey) contentEl.replaceChildren(renderList());
    else setIdx(idx, false);
    listKey = key;
  } else {
    listKey = '';
    contentEl.replaceChildren(
      h('div', { class: 'empty' }, h('span', { class: 'empty-tag in' }, 'No signal'), h('span', { class: 'empty-text in', delay: 60 }, `Nothing matches “${q}”`)),
    );
  }
  scrollEl.scrollTop = 0;
  fit();
}

// The panel's height animates in CSS; the window follows: it grows at once (the extra space is
// transparent) and shrinks only after the panel has finished closing.
let shrinkTimer;
let windowH = 0;
// Width the panel's tables need to keep every row on one line, in window px (0 = no tables).
// Each table is measured at its natural width, plus its offset from the left and the room to its right.
function tablesWidth() {
  let need = 0;
  for (const t of contentEl.querySelectorAll('table')) {
    const box = t.getBoundingClientRect();
    const rightGap = window.innerWidth - box.right;
    t.style.width = 'max-content';
    need = Math.max(need, box.left + t.offsetWidth + rightGap);
    t.style.width = '';
  }
  return need;
}

// Ask for the width that keeps rows on one line; main caps it at half the screen. If the window is
// still narrower than the rows need (capped, or not resized yet), rows wrap instead of being cut off;
// the resize that follows runs this again and lifts the wrap once they fit.
function fitWidth() {
  contentEl.classList.remove('wrap-rows');
  // The estimate, corrected by what still overflows the panel at the current width (the measured
  // overflow is exact; the estimate alone can come up a few px short).
  const overflow = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
  const need = Math.max(tablesWidth(), overflow ? window.innerWidth + overflow : 0) + (overflow ? 4 : 0);
  companion.fitWidth(Math.ceil(need * zoom));
  if (need > window.innerWidth + 1) contentEl.classList.add('wrap-rows');
}

window.addEventListener('resize', () => {
  if (!document.body.classList.contains('docked')) requestAnimationFrame(fit);
});

function fit() {
  // Docked, the window is the icon; folding, it is about to become the icon. Neither is laid out.
  if (document.body.classList.contains('docked') || document.body.classList.contains('folding')) return;
  if (!gripping) fitWidth();
  const open = contentEl.childElementCount > 0;
  // Everything except the panel: body padding, brand line, bar, key hints.
  const pad = parseFloat(getComputedStyle(document.body).paddingTop) + parseFloat(getComputedStyle(document.body).paddingBottom);
  const chrome = pad + document.querySelector('.brand').offsetHeight + document.querySelector('.bar').offsetHeight + document.querySelector('.hints').offsetHeight;
  // Content that must show whole (the notice, the suggestions form: their buttons are at the bottom) may exceed the max height.
  const whole = notice || settingsOpen || !!feedback?.open;
  const limit = whole ? screen.availHeight - 40 : maxHeight / zoom;
  const roomForPanel = limit - chrome - PANEL_GAP;
  const panelH = open ? Math.max(0, Math.min(contentEl.offsetHeight + 2, roomForPanel)) : 0;
  panelEl.classList.toggle('open', open);
  panelEl.style.height = `${panelH}px`;
  const target = Math.ceil((chrome + (open ? PANEL_GAP + panelH : 0)) * zoom);
  clearTimeout(shrinkTimer);
  // While the grip is dragged the panel tracks it live, so the window shrinks at once too.
  if (target >= windowH || gripping) {
    windowH = target;
    companion.fit(target, whole);
  } else {
    shrinkTimer = setTimeout(() => { windowH = target; companion.fit(target, whole); }, SHRINK_DELAY);
  }
}

function search() {
  results = CompanionSearch.search(index, qEl.value, { type });
  idx = 0;
  detail = null;
  render();
}

function setIdx(i, scroll = true) {
  if (!results.length) return;
  idx = Math.max(0, Math.min(results.length - 1, i));
  const rows = contentEl.querySelectorAll('.row');
  rows.forEach((r, j) => r.classList.toggle('active', j === idx));
  if (scroll) rows[idx]?.scrollIntoView({ block: 'nearest' });
}

function open(i) {
  if (!results[i]) return;
  idx = i;
  detail = results[i];
  render();
}

function back() {
  detail = null;
  render();
  setIdx(idx);
  qEl.focus();
}

// Cross-links inside a detail jump straight to the named entry.
function goTo(query, t) {
  settingsOpen = false;
  qEl.value = query;
  type = t;
  results = CompanionSearch.search(index, query, { type });
  const exact = results.findIndex((e) => CompanionSearch.norm(e.n) === CompanionSearch.norm(query));
  idx = Math.max(0, exact);
  detail = results[idx] || null;
  render();
  qEl.focus();
}

// ---------- Input ----------
let timer;
qEl.addEventListener('input', () => {
  // Typing a search means the notice has been seen (it stays on for the next launch unless ticked off).
  if (notice) {
    notice = false;
    companion.noticeDone(false);
  }
  settingsOpen = false; // typing a search leaves the settings
  clearTimeout(timer);
  timer = setTimeout(search, 60);
});
document.addEventListener('keyup', (ev) => {
  // Letting go of modifiers without a key clears the "Ctrl+…" preview.
  if (recorder && !recorder.pending && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
    recorder.partial = null;
    refreshRecorder();
  }
});
document.addEventListener('keydown', (ev) => {
  if (recorder) {
    ev.preventDefault();
    return recorderKey(ev);
  }
  // The shortcut key is not typed into the overlay: it closes it (the key listener does the toggling).
  const pressed = CompanionHotkey.fromEvent(ev).accelerator;
  if (pressed && pressed.toLowerCase() === $('hotkey').textContent.trim().toLowerCase()) {
    ev.preventDefault();
    return;
  }
  if (settingsOpen) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeSettings(); }
    return;
  }
  // The form owns the keyboard: only Esc (cancel) and Ctrl+Enter (send) are taken; the rest types.
  if (feedback?.open) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeFeedback(); }
    else if (ev.key === 'Enter' && ev.ctrlKey && feedback.status !== 'sent') { ev.preventDefault(); submitFeedback(); }
    else if (ev.key === 'Enter' && feedback.status === 'sent') { ev.preventDefault(); closeFeedback(); }
    return;
  }
  if (ev.ctrlKey && (ev.key === '=' || ev.key === '+')) companion.zoom(1);
  else if (ev.ctrlKey && ev.key === '-') companion.zoom(-1);
  else if (ev.ctrlKey && ev.key === '0') companion.zoom(0);
  else if (notice && (ev.key === 'Enter' || ev.key === 'Escape')) dismissNotice();
  else if (ev.key === 'Escape') {
    // Detail → list → empty bar → hidden.
    if (detail) back();
    else if (qEl.value) { qEl.value = ''; type = 'all'; search(); }
    else companion.hide();
  } else if (ev.key === 'Enter') {
    if (!detail) open(idx);
  } else if (ev.key === 'ArrowDown' && !detail) setIdx(idx + 1);
  else if (ev.key === 'ArrowUp' && !detail) setIdx(idx - 1);
  else if (ev.key === 'PageDown') scrollEl.scrollBy(0, scrollEl.clientHeight * 0.8);
  else if (ev.key === 'PageUp') scrollEl.scrollBy(0, -scrollEl.clientHeight * 0.8);
  else if (ev.key === 'Tab') {
    const i = TYPES.findIndex(([t]) => t === type);
    type = TYPES[(i + (ev.shiftKey ? TYPES.length - 1 : 1)) % TYPES.length][0];
    search();
  } else return;
  ev.preventDefault();
});
companion.onFeedback(openFeedback);
companion.onSettings(openSettings);
$('settings-btn').addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
$('suggest').addEventListener('click', (ev) => {
  ev.preventDefault();
  openFeedback();
});
$('coffee').addEventListener('click', (ev) => {
  ev.preventDefault();
  companion.openLink(COFFEE_URL);
});
$('clear').addEventListener('click', () => {
  if (qEl.value) { qEl.value = ''; type = 'all'; search(); qEl.focus(); } else companion.hide();
});
// ---------- Icon ⇄ bar ----------
const body = document.body;
const wrapEl = $('wrap');

// Tell the main process where the bar sits in the open window (window px), so it can place the
// window with the bar's end on the icon. Measured with the layout briefly shown if docked.
function sendGeometry() {
  const docked = body.classList.contains('docked');
  if (docked) body.classList.remove('docked');
  const bar = document.querySelector('.bar').getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(body).paddingLeft);
  if (docked) body.classList.add('docked');
  companion.geometry({ inset: inset * zoom, barTop: bar.top * zoom, barHeight: bar.height * zoom });
}

function applyLayoutVars(dockOpacity) {
  body.style.setProperty('--zoom', zoom);
  if (dockOpacity != null) body.style.setProperty('--dock-opacity', dockOpacity);
}

// The clip that starts (or ends) the bar as just the icon's square, relative to .wrap.
function setIconClip({ iconX, iconY, iconSize }) {
  body.style.setProperty('--ix', `${iconX}px`);
  body.style.setProperty('--iy', `${iconY}px`);
  body.style.setProperty('--is', `${iconSize}px`);
  const w = wrapEl.getBoundingClientRect();
  const left = iconX - w.left;
  const top = iconY - w.top;
  body.style.setProperty('--cl', `${left}px`);
  body.style.setProperty('--ct', `${top}px`);
  body.style.setProperty('--cr', `${w.width - left - iconSize}px`);
  body.style.setProperty('--cb', `${w.height - top - iconSize}px`);
}

let lastIcon = null;
companion.onOpen((info) => {
  lastIcon = info;
  body.classList.remove('docked', 'folding');
  body.classList.toggle('side-right', info.side === 'right');
  windowH = 0; // the window was the icon; let the first fit size it
  fit();
  setIconClip(info);
  body.classList.remove('unfolding');
  void body.offsetWidth; // restart the animation
  body.classList.add('unfolding');
  qEl.focus();
  qEl.select();
});
wrapEl.addEventListener('animationend', (ev) => {
  if (ev.target !== wrapEl) return;
  if (ev.animationName === 'unfold') body.classList.remove('unfolding');
  if (ev.animationName === 'fold') companion.closed();
});

companion.onClose(() => {
  if (recorder) cancelRecorder(); // never leave the global shortcut switched off
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !lastIcon) return companion.closed();
  clearTimeout(shrinkTimer);
  setIconClip(lastIcon);
  body.classList.remove('unfolding');
  body.classList.add('folding');
});

companion.onNotice(showNotice);
companion.onGameVersion(({ live }) => renderPu(live));
companion.onHotkeyRecorder(startRecorder);
// The hotkey shown in the bar opens the recorder too.
$('hotkey').addEventListener('click', () => startRecorder());

companion.onDocked(({ opacity }) => {
  body.classList.remove('unfolding', 'folding');
  body.classList.add('docked');
  applyLayoutVars(opacity);
});

// The icon: the main process decides click (open) or drag (move) from the real cursor.
const dockEl = $('dock');
dockEl.addEventListener('pointerdown', (ev) => {
  dockEl.setPointerCapture(ev.pointerId);
  companion.dockPointer('down');
  ev.preventDefault();
});
dockEl.addEventListener('pointerup', () => companion.dockPointer('up'));
dockEl.addEventListener('lostpointercapture', () => companion.dockPointer('up'));

// Resize grip: the main process follows the cursor while it is held; we only refit as the limits change.
const gripEl = $('grip');
gripEl.addEventListener('pointerdown', (ev) => {
  gripping = true;
  gripEl.classList.add('dragging');
  gripEl.setPointerCapture(ev.pointerId);
  companion.grip('start');
  ev.preventDefault();
});
const releaseGrip = () => {
  if (!gripping) return;
  gripping = false;
  gripEl.classList.remove('dragging');
  companion.grip('end');
};
gripEl.addEventListener('pointerup', releaseGrip);
gripEl.addEventListener('pointercancel', releaseGrip);
gripEl.addEventListener('lostpointercapture', releaseGrip);
companion.onLayout((layout) => {
  maxHeight = layout.maxHeight;
  zoom = layout.zoom;
  body.classList.toggle('side-right', layout.side === 'right');
  applyLayoutVars(layout.dockOpacity);
  sendGeometry();
  fit();
});
companion.onDbUpdated(({ ok }) => {
  $('dbinfo').textContent = ok ? 'Database updated — reloading…' : 'Some sources failed to update; previous data kept.';
  load();
});

async function load() {
  const [raw, cfg] = await Promise.all([companion.loadDb(), companion.config()]);
  maxHeight = cfg.maxHeight;
  zoom = cfg.zoom || 1;
  applyLayoutVars(cfg.dockOpacity);
  sendGeometry();
  $('hotkey').textContent = $('hotkey2').textContent = cfg.hotkey;
  const db = JSON.parse(raw);
  index = CompanionSearch.buildIndex(db.entries);
  const total = Object.values(db.meta.counts).reduce((a, b) => a + b, 0);
  const sources = Object.entries(db.meta.sources).filter(([, s]) => s);
  const oldest = sources.map(([, s]) => s.fetchedAt.slice(0, 10)).sort()[0];
  $('dbinfo').textContent = `${fmt(total)} records · data ${oldest}`;
  dataDate = oldest;
  gameVersion = db.meta.gameVersion || null;
  renderPu(cfg.liveGameVersion);
  $('dbinfo').title = sources.map(([k, s]) => `${k}: ${s.fetchedAt.slice(0, 10)}`).join('\n');
  search();
  qEl.focus();
}

fit();
load().catch((err) => { $('dbinfo').textContent = `Could not load the database: ${err.message}`; });
