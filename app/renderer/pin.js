/* global pin */
// The main process sends what to show: { title, unit, rows: [{ label, value, tier }] }.
const $ = (id) => document.getElementById(id);

pin.onData(({ title, unit, rows }) => {
  $('title').textContent = title;
  $('unit').textContent = unit || '';
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
