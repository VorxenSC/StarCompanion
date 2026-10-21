// Renders the app icon from the "Star Companion by Vorxen" Claude Design canvas (Icon artboard) to
// build/icon.ico, build/icon.png and app/renderer/icon.png. Runs under Electron: `npm run icon`.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ring = (w) => `<circle cx="226" cy="226" r="122" stroke="#5FD4E8" stroke-width="${w}"/>`;
const star = '<path d="M226 142 C231 192 260 221 310 226 C260 231 231 260 226 310 C221 260 192 231 142 226 C192 221 221 192 226 142 Z" fill="#EAFBFF"/>';

// Large sizes: gradient tile, glow, stars and a fading tail.
const FULL = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13222E"/><stop offset="1" stop-color="#060A0F"/></linearGradient>
<radialGradient id="glow" cx="0.44" cy="0.44" r="0.5"><stop offset="0" stop-color="#5FD4E8" stop-opacity="0.22"/><stop offset="1" stop-color="#5FD4E8" stop-opacity="0"/></radialGradient>
<linearGradient id="tail" gradientUnits="userSpaceOnUse" x1="318" y1="318" x2="432" y2="432"><stop offset="0" stop-color="#5FD4E8"/><stop offset="1" stop-color="#5FD4E8" stop-opacity="0"/></linearGradient>
</defs>
<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#glow)"/>
<rect x="17.5" y="17.5" width="477" height="477" rx="110.5" stroke="#BED7EB" stroke-opacity="0.22" stroke-width="3"/>
<circle cx="104" cy="120" r="3.5" fill="#fff" fill-opacity="0.7"/>
<circle cx="392" cy="96" r="2.5" fill="#fff" fill-opacity="0.5"/>
<circle cx="420" cy="214" r="3" fill="#fff" fill-opacity="0.6"/>
<circle cx="86" cy="330" r="2.5" fill="#fff" fill-opacity="0.45"/>
${ring(28)}${star}
<path d="M318 318 L430 430" stroke="url(#tail)" stroke-width="30" stroke-linecap="round"/>
</svg>`;

// Small sizes: flat tile and heavier strokes so the mark survives downscaling (the design's 128/64/32 variants).
const small = (ringW, tailW, tailOpacity, border) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
<rect x="16" y="16" width="480" height="480" rx="112" fill="#0B141C"/>
${border ? '<rect x="17.5" y="17.5" width="477" height="477" rx="110.5" stroke="#BED7EB" stroke-opacity="0.22" stroke-width="3"/>' : ''}
${ring(ringW)}${star}
<path d="M318 318 L430 430" stroke="#5FD4E8" stroke-opacity="${tailOpacity}" stroke-width="${tailW}" stroke-linecap="round"/>
</svg>`;

const VARIANTS = [
  { svg: FULL, sizes: [256, 512] },
  { svg: small(28, 30, 0.75, true), sizes: [128] },
  { svg: small(32, 34, 0.8, false), sizes: [64, 48] },
  { svg: small(40, 44, 1, false), sizes: [32, 24, 16] },
];

// Each variant is drawn once at 512px and downscaled; the small variants exist for legibility, not detail.
async function render(win, svg) {
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 300));
  return win.webContents.capturePage();
}

// ICO containing PNG-encoded images (supported since Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  const out = {};
  for (const v of VARIANTS) {
    const full = await render(win, v.svg);
    if (full.isEmpty()) throw new Error('capture came back empty');
    for (const size of v.sizes) out[size] = size === 512 ? full.toPNG() : full.resize({ width: size, height: size, quality: 'best' }).toPNG();
  }

  const root = path.join(__dirname, '..');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), out[512]);
  fs.writeFileSync(path.join(root, 'app', 'renderer', 'icon.png'), out[64]);
  fs.writeFileSync(path.join(root, 'app', 'renderer', 'tray.png'), out[32]);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: out[size] }))));
  console.log('icons written: build/icon.ico, build/icon.png, app/renderer/icon.png, app/renderer/tray.png');
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
