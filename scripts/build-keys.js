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

// Who it is, in its file properties: the app's name, maker, version and icon. An unnamed program that listens to the
// keyboard and clicks is what antivirus heuristics take for a keylogger; a described one, shipped beside the app that
// starts it, much less so. Written next to the program and compiled with it.
const pkg = require(path.join(root, 'package.json'));
const version = `${pkg.version.split(/[^0-9.]/)[0]}.0`.split('.').slice(0, 4).join('.');
const info = path.join(path.dirname(out), 'StarCompanionKeys.info.cs');
const infoText = [
  'using System.Reflection;',
  '[assembly: AssemblyTitle("Star Companion key listener")]',
  '[assembly: AssemblyDescription("Listens for the Star Companion shortcut key (Raw Input, passive). Started and closed by Star Companion.")]',
  `[assembly: AssemblyCompany("${pkg.author}")]`,
  `[assembly: AssemblyProduct("${pkg.productName}")]`,
  `[assembly: AssemblyCopyright("Copyright ${new Date().getFullYear()} ${pkg.author}")]`,
  `[assembly: AssemblyVersion("${version}")]`,
  `[assembly: AssemblyFileVersion("${version}")]`,
  '',
].join('\n');
const icon = path.join(root, 'build', 'icon.ico');

// Up to date: nothing to do (the same source, the same version).
if (fs.existsSync(out) && fs.existsSync(info) && fs.readFileSync(info, 'utf8') === infoText && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
  console.log('build-keys: up to date');
  process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(info, infoText);
execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', '/r:System.Windows.Forms.dll', `/win32icon:${icon}`, `/out:${out}`, src, info], { stdio: 'inherit' });
console.log(`build-keys: wrote ${path.relative(root, out)}`);
