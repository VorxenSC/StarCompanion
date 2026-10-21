/* global CompanionSearch, companion */
// Overlay UI following the "Star Companion by Vorxen" Claude Design canvas:
// idle = search bar only; typing opens a panel of one-line results; Enter opens the item detail.
const $ = (id) => document.getElementById(id);
const qEl = $('q');
const panelEl = $('panel');
const scrollEl = $('scroll');
const contentEl = $('content');
const filterEl = $('filter');

const TYPES = [
  ['all', 'All'],
  ['item', 'Items'],
  ['ship', 'Ships'],
  ['blueprint', 'Blueprints'],
  ['mission', 'Missions'],
  ['mineral', 'Minerals'],
  ['location', 'Locations'],
];
const TYPE_LABEL = { item: 'Item', ship: 'Ship', blueprint: 'Blueprint', mission: 'Mission', mineral: 'Mineral', location: 'Location' };
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
let dataDate = '';

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
const section = (title, ...kids) => [h('div', { class: 'sec-title' }, title), ...kids];
const note = (text) => h('p', { class: 'note' }, text);
const pct = (m) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;

function table(headers, rows) {
  return h(
    'table',
    null,
    h('thead', null, h('tr', null, headers.map(([label, cls]) => h('th', { class: cls }, label)))),
    h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c, i) => h('td', { class: headers[i][1] }, c))))),
  );
}

function links(pairs) {
  const present = pairs.filter(([, url]) => url);
  return present.length ? h('div', { class: 'links' }, present.map(([label, url]) => link(`${label} ↗`, url))) : null;
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
  return {
    facts: [
      ['Manufacturer', d.manufacturer],
      ['Type', d.type],
      ['Size', d.size],
      ['Grade', d.grade],
      ['Class', d.class],
      ['Lowest price', cheapest && auec(cheapest.price)],
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
      d.description && section('Description', h('p', { class: 'desc' }, d.description)),
      links([['cstone', d.cstoneUrl], ['Wiki', d.wikiUrl], ['scminer', d.minerUrl]]),
    ],
  };
}

function viewShip(e) {
  const d = e.d;
  const store = d.store || [];
  const standalone = store.find((s) => !s.pack) || store[0];
  return {
    facts: [
      ['Manufacturer', d.manufacturer],
      ['Role', [d.career, d.role].filter(Boolean).join(' / ')],
      ['Size', [d.size, d.sizeClass && `class ${d.sizeClass}`].filter(Boolean).join(' · ')],
      ['Crew', d.crew && (d.crew.min === d.crew.max ? d.crew.min : `${d.crew.min}–${d.crew.max}`)],
      ['Cargo', d.cargo != null && `${fmt(d.cargo)} SCU`],
      ['Speed', d.speed && `SCM ${fmt(d.speed.scm)} · max ${fmt(d.speed.max)}`],
      ['Hull', d.health && fmt(Math.round(d.health))],
      ['Shield', d.shieldHp && fmt(Math.round(d.shieldHp))],
      ['Pilot DPS', d.pilotDps && fmt(Math.round(d.pilotDps))],
      ['Store price', standalone ? usd(standalone.discountedUsd || standalone.usd) : d.msrp ? usd(d.msrp) : null],
      ['In-game price', d.buy?.[0]?.price && auec(d.buy[0].price)],
      ['Status', d.status],
    ],
    body: [
      section(
        'Price in USD (RSI store)',
        store.length
          ? table(
              [['Offer', ''], ['USD', 'num'], ['', 'dim'], ['Checked', 'dim']],
              store.map((s) => [
                link(s.title, s.url),
                s.discountedUsd ? h('span', null, usd(s.discountedUsd), ' ', h('s', { class: 'dim' }, `$${s.usd}`)) : usd(s.usd),
                [s.warbond && 'warbond', s.pack && 'package', !s.available && 'unavailable'].filter(Boolean).join(', '),
                s.checked || '',
              ]),
            )
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
      ['Category', e.s],
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
      ['Category', d.tier],
      ['Mined with', e.s.split(' · ')[1]],
      ['Found at', top && `${top.name} · ${top.abundance}%`],
      ['Sell value', d.bestSell && h('span', null, auec(d.bestSell.price), ' / SCU')],
      ['Best sale at', d.bestSell?.where],
      ['Scan signature', d.signature && fmt(d.signature)],
      ['Instability', d.props?.instability],
      ['Resistance', d.props?.resistance],
      ['Found with', [d.props?.secondary, d.props?.tertiary].filter((x) => x && x !== '-').join(', ')],
    ],
    body: [
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

function viewLocation(e) {
  const d = e.d;
  return {
    facts: [['Type', d.type], ['Inside', d.parent], ['System', d.system], ['Missions available', d.missionCount || null]],
    body: [d.description && section('Description', h('p', { class: 'desc' }, d.description)), links([['Wiki', d.url]])],
  };
}

const VIEWS = { item: viewItem, ship: viewShip, blueprint: viewBlueprint, mission: viewMission, mineral: viewMineral, location: viewLocation };

// cstone hosts a picture for most items and ships it lists.
function imageFor(e) {
  const id = e.d.cstoneUrl?.split('/').pop();
  if (!id) return null;
  const img = h('img', { class: 'detail-img', alt: '', src: `https://cstone.space/uifimages/${id}.png` });
  img.addEventListener('error', () => { img.remove(); fit(); });
  img.addEventListener('load', fit);
  return img;
}

function renderDetail(e) {
  const { facts, body } = VIEWS[e.t](e);
  const shown = facts.filter(([, v]) => v != null && v !== '' && v !== false);
  return h(
    'div',
    { class: 'detail' },
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
      shown.length &&
        h(
          'div',
          { class: 'facts' },
          shown.map(([label, value], i) => {
            const d = 160 + Math.min(i, 9) * 55;
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
    ),
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
    [`${key} to open`, `Press ${key} or click the small icon to open and close the search. If another program uses ${key}, change "hotkey" in the tray menu → Edit settings.`],
    ['Internet', 'Search works offline. Item pictures, links, "Update database" and app updates need a connection.'],
    ['Community data', `Prices, shops, locations and drop chances come from community sites (cstone, sc-craft.tools, scminer.rocks, starcitizen.tools, UEX) and can lag behind a new patch. Data from ${dataDate || 'the bundled database'}; check in game before a long trip.`],
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

// ---------- State → screen ----------
function render() {
  const q = qEl.value.trim();
  filterEl.textContent = type === 'all' ? '' : `Filter · ${TYPES.find(([t]) => t === type)[1]}`;
  if (notice) {
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
function fit() {
  // Docked, the window is the icon; folding, it is about to become the icon. Neither is laid out.
  if (document.body.classList.contains('docked') || document.body.classList.contains('folding')) return;
  const open = contentEl.childElementCount > 0;
  // Everything except the panel: body padding, brand line, bar, key hints.
  const pad = parseFloat(getComputedStyle(document.body).paddingTop) + parseFloat(getComputedStyle(document.body).paddingBottom);
  const chrome = pad + document.querySelector('.brand').offsetHeight + document.querySelector('.bar').offsetHeight + document.querySelector('.hints').offsetHeight;
  // The notice must show whole (its button is at the bottom), so it may exceed the max height.
  const limit = notice ? screen.availHeight - 40 : maxHeight / zoom;
  const roomForPanel = limit - chrome - PANEL_GAP;
  const panelH = open ? Math.max(0, Math.min(contentEl.offsetHeight + 2, roomForPanel)) : 0;
  panelEl.classList.toggle('open', open);
  panelEl.style.height = `${panelH}px`;
  const target = Math.ceil((chrome + (open ? PANEL_GAP + panelH : 0)) * zoom);
  clearTimeout(shrinkTimer);
  // While the grip is dragged the panel tracks it live, so the window shrinks at once too.
  if (target >= windowH || gripping) {
    windowH = target;
    companion.fit(target, notice);
  } else {
    shrinkTimer = setTimeout(() => { windowH = target; companion.fit(target, notice); }, SHRINK_DELAY);
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
  clearTimeout(timer);
  timer = setTimeout(search, 60);
});
document.addEventListener('keydown', (ev) => {
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
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !lastIcon) return companion.closed();
  clearTimeout(shrinkTimer);
  setIconClip(lastIcon);
  body.classList.remove('unfolding');
  body.classList.add('folding');
});

companion.onNotice(showNotice);

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
  $('dbinfo').title = sources.map(([k, s]) => `${k}: ${s.fetchedAt.slice(0, 10)}`).join('\n');
  search();
  qEl.focus();
}

fit();
load().catch((err) => { $('dbinfo').textContent = `Could not load the database: ${err.message}`; });
