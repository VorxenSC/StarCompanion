/* global pin, CompanionHangar */
// The main process sends what to show: { title, unit, rows: [{ label, value, tier }] } for a list of
// signatures, or { hangar: anchor, title, labels } for the Executive Hangar timer, counted down here.
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

pin.onData((data) => {
  clearInterval(ticker);
  $('title').textContent = data.title;
  $('list').hidden = !!data.hangar;
  $('hangar').hidden = !data.hangar;
  if (data.hangar) return showHangar(data.hangar, data.labels, data.lang);
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
