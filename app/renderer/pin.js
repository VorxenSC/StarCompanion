/* global pin, CompanionHangar */
// The main process sends what to show: { title, unit, rows: [{ label, value, tier }] } for a list of
// signatures, { hangar: anchor, title, labels } for the Executive Hangar timer, counted down here, or
// { map: { url, w, h }, title, credit } for a contested zone map.
const $ = (id) => document.getElementById(id);
let ticker = null;

function showHangar(anchor, labels, lang) {
  const time = (s) => new Date(s * 1000).toLocaleTimeString(lang || [], { hour: '2-digit', minute: '2-digit' });
  const until = { closed: labels.opensIn, open: labels.closesIn, reset: labels.backIn };
  const tick = () => {
    const s = CompanionHangar.state(Date.now(), anchor);
    $('unit').textContent = labels[s.phase];
    $('unit').className = `pin-unit ph-${s.phase}`;
    $('lights').replaceChildren(...s.lights.map((l) => {
      const i = document.createElement('i');
      i.className = `ph-light ph-${l}`;
      return i;
    }));
    $('clock').textContent = CompanionHangar.clock(s.left);
    $('clock').className = `ph-clock ph-${s.phase}`;
    $('line').textContent = s.phase === 'open'
      ? labels.closesAt.replace('{time}', time(s.openEnds))
      : labels.opensAt.replace('{time}', time(s.windows[0].opens));
    $('clock').title = `${until[s.phase]} ${CompanionHangar.clock(s.left)}`;
  };
  tick();
  ticker = setInterval(tick, 1000);
}

// The map's resize corner, opacity slider and close button: while the pointer is on one of them the
// window takes the mouse (it is click-through otherwise). A drag on the corner sends the pointer's
// screen position to the main process, which sizes the window; the slider sets the map's opacity; the
// × unpins the map.
const grip = $('grip');
let dragging = false;
let overHot = false;
pin.onSide((side) => { grip.dataset.side = side; $('alpha').dataset.side = side; });
const onHot = (e) => [...document.querySelectorAll('.pin-hot')].some((el) => {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
});
document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  const over = onHot(e);
  if (over !== overHot) { overHot = over; pin.grip(over); }
});
document.addEventListener('mouseleave', () => { if (!dragging && overHot) { overHot = false; pin.grip(false); } });
$('close').addEventListener('click', () => { overHot = false; pin.close(); });
grip.addEventListener('pointerdown', (e) => {
  dragging = true;
  grip.setPointerCapture(e.pointerId);
  pin.resize('start', e.screenX);
});
grip.addEventListener('pointermove', (e) => { if (dragging) pin.resize('move', e.screenX); });
grip.addEventListener('pointerup', (e) => {
  dragging = false;
  grip.releasePointerCapture(e.pointerId);
  pin.resize('end');
});
grip.addEventListener('dblclick', () => pin.resize('reset'));
// While the slider is held the mouse stays with the window, even if the pointer drifts off it.
const alpha = $('alpha');
let sliding = false;
alpha.addEventListener('pointerdown', () => { sliding = true; dragging = true; });
alpha.addEventListener('input', () => pin.alpha(alpha.value, false));
alpha.addEventListener('change', () => pin.alpha(alpha.value, true));
document.addEventListener('pointerup', () => { if (sliding) { sliding = false; dragging = false; } });

pin.onData((data) => {
  clearInterval(ticker);
  $('title').textContent = data.title;
  $('list').hidden = !!(data.hangar || data.map);
  $('hangar').hidden = !data.hangar;
  $('map').hidden = !data.map;
  $('credit').hidden = !data.map;
  $('grip').hidden = !data.map;
  $('close').hidden = !data.map;
  $('alpha').hidden = !data.map;
  if (data.map) {
    alpha.value = String(data.alpha);
    alpha.title = data.alphaLabel;
  }
  if (data.hangar) return showHangar(data.hangar, data.labels, data.lang);
  if (data.map) {
    $('unit').textContent = '';
    $('unit').className = 'pin-unit';
    $('credit').textContent = data.credit;
    if ($('map').src !== data.map.url) $('map').src = data.map.url;
    return;
  }
  const { unit, rows } = data;
  $('unit').textContent = unit || '';
  $('unit').className = 'pin-unit';
  $('list').replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    li.className = `tier-${r.tier || 'common'}`;
    li.title = `${r.label}: ${r.value.toLocaleString('en-US')} RS`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = r.label;
    const rs = document.createElement('span');
    rs.className = 'rs';
    rs.textContent = r.value.toLocaleString('en-US');
    li.append(dot, name, rs);
    return li;
  }));
});
