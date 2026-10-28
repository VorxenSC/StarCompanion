// starcitizen.tools faction logos: the picture file of each faction listed in faction-logos.json (chosen by
// hand: only real logos, not the page's photo of a character or a screenshot), as the wiki's own image URLs
// (never copied into the app). Asked through the MediaWiki API (imageinfo, a 256 px thumbnail).
const fs = require('fs');
const path = require('path');
const { getJson, writeRaw } = require('./lib/http');

const API = 'https://starcitizen.tools/api.php';

async function main() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'faction-logos.json'), 'utf8'));
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '256', titles: list.map((l) => `File:${l.file.replace(/_/g, ' ')}`).join('|') });
  const r = await getJson(`${API}?${q}`);
  const byTitle = new Map();
  for (const p of Object.values(r?.query?.pages || {})) byTitle.set(p.title, p.imageinfo?.[0]);
  const normalized = new Map((r?.query?.normalized || []).map((n) => [n.from, n.to]));
  const logos = {};
  for (const l of list) {
    const asked = `File:${l.file.replace(/_/g, ' ')}`;
    const info = byTitle.get(normalized.get(asked) || asked);
    if (!info?.thumburl) { console.warn(`no logo file for ${l.faction}: ${l.file}`); continue; }
    logos[l.faction] = { url: info.thumburl, w: info.thumbwidth, h: info.thumbheight, tile: l.tile, file: l.file, page: info.descriptionurl };
  }
  writeRaw('faction-logos.json', { source: 'https://starcitizen.tools', fetchedAt: new Date().toISOString(), logos });
  console.log(`faction logos: ${Object.keys(logos).length} of ${list.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
