// Before a build: move the files of earlier versions out of dist/ into dist/Old, so dist/ only holds
// the version being built (installer, blockmap, portable exe, latest.yml). Nothing is deleted; a file
// already in Old with the same name is kept and the new copy gets a numbered suffix.
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OLD = path.join(DIST, 'Old');
const { version } = require('../package.json');

// The version a dist file belongs to: from its name, or for latest.yml from its contents.
function versionOf(file) {
  const m = /(\d+\.\d+\.\d+)(?:-setup)?\.exe(?:\.blockmap)?$/.exec(file);
  if (m) return m[1];
  if (file === 'latest.yml') return /^version:\s*(\S+)/m.exec(fs.readFileSync(path.join(DIST, file), 'utf8'))?.[1] || null;
  return null;
}

function freeName(name) {
  let target = path.join(OLD, name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(OLD, name.replace(/(\.[^.]+)$/, ` (${i})$1`));
  return target;
}

if (fs.existsSync(DIST)) {
  fs.mkdirSync(OLD, { recursive: true });
  for (const file of fs.readdirSync(DIST)) {
    if (!fs.statSync(path.join(DIST, file)).isFile()) continue;
    const v = versionOf(file);
    if (!v || v === version) continue;
    try {
      fs.renameSync(path.join(DIST, file), freeName(file));
      console.log(`archive-old: ${file} -> Old/`);
    } catch (err) {
      // A portable exe that is running is locked; it moves on the next build once it is closed.
      console.warn(`archive-old: ${file} left in dist (${err.code}: in use?)`);
    }
  }
}
