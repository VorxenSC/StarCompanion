// The Mining Assistant's reading engine: a helper that looks at the screen the way a screenshot does
// (the composed desktop, a small area), reads the radar signature and matches it. Nothing touches the
// game. It talks JSON lines on stdout and takes one command per line; closing its stdin ends it.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseLine } = require('./renderer/mining.js');

const EXE = path.join(__dirname, 'bin', 'mining', 'MiningSidecar.exe');

function createEngine({ onMessage, replay }) {
  let proc = null;
  let buffer = '';

  const send = (command) => {
    if (proc?.stdin.writable) proc.stdin.write(`${command}\n`);
  };

  function start() {
    if (proc) return true;
    if (!fs.existsSync(EXE)) {
      onMessage({ type: 'error', code: 'missing' });
      return false;
    }
    const child = spawn(EXE, replay ? ['--replay', replay] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    proc = child;
    buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (proc !== child) return;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const message = parseLine(line);
        if (message) onMessage(message);
      }
    });
    child.stdin.on('error', () => {});
    // Only the engine in use counts: one stopped on purpose, on its way out, says nothing.
    child.on('error', () => { if (proc === child) { proc = null; onMessage({ type: 'error', code: 'failed' }); } });
    child.on('exit', () => { if (proc === child) { proc = null; onMessage({ type: 'exit' }); } });
    return true;
  }

  function stop() {
    if (!proc) return;
    proc.stdin.end(); // end of input: it quits by itself
    proc = null;
  }

  return { start, stop, send, running: () => !!proc };
}

module.exports = { createEngine, EXE };
