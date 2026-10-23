// Compiles the Windows key listener (native/keys/StarCompanionKeys.cs) to app/bin/StarCompanionKeys.exe
// with the C# compiler that ships with .NET Framework 4.x, so nothing extra has to be installed.
// Skips quietly off Windows (the app falls back to Electron's globalShortcut there).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'native', 'keys', 'StarCompanionKeys.cs');
const out = path.join(root, 'app', 'bin', 'StarCompanionKeys.exe');

if (process.platform !== 'win32') {
  console.log('build-keys: not Windows, skipped');
  process.exit(0);
}

const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework'].map((f) => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
if (!csc) {
  console.error('build-keys: .NET Framework C# compiler (csc.exe) not found');
  process.exit(1);
}

// Up to date: nothing to do.
if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
  console.log('build-keys: up to date');
  process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', '/r:System.Windows.Forms.dll', `/out:${out}`, src], { stdio: 'inherit' });
console.log(`build-keys: wrote ${path.relative(root, out)}`);
