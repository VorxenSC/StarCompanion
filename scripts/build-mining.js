// Builds the Mining Assistant's reading engine into app/bin/mining from its own (private) repository,
// so only the program ships here, never its source. Skips quietly where that repository is not around:
// the app then says the engine is missing. MINING_SRC points at another checkout.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = process.env.MINING_SRC || path.join(os.homedir(), 'source', 'StarCitizenMiningAssistant');
const project = path.join(src, 'src', 'MiningAssistant.Sidecar', 'MiningAssistant.Sidecar.csproj');
const out = path.join(root, 'app', 'bin', 'mining');
// A build folder of its own: sharing the keyed app's, MSBuild would reuse a library that has the secret, or leave it one that has not.
const artifacts = path.join(src, '.scratch', 'companion-engine');

if (process.platform !== 'win32' || !fs.existsSync(project)) {
  console.log('build-mining: no engine source here, skipped');
  process.exit(0);
}
// The Mining Assistant is free here, so the engine has no use for the old app's license secret, and this
// app is public: a build that still carries it never gets through.
execFileSync('dotnet', ['publish', project, '-c', 'Release', '-o', out, '--nologo', '-v', 'q', '-p:NoLicenseSecret=true', '--artifacts-path', artifacts], { stdio: 'inherit' });
for (const f of fs.readdirSync(out)) if (f.endsWith('.pdb')) fs.rmSync(path.join(out, f));
try {
  execFileSync(path.join(out, 'MiningSidecar.exe'), ['--check-clean']);
} catch {
  fs.rmSync(out, { recursive: true, force: true });
  console.error('build-mining: the engine carries the license secret; removed it');
  process.exit(1);
}
console.log(`build-mining: wrote ${path.relative(root, out)}`);
