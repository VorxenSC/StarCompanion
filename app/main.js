const { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, shell, Tray, Menu, nativeImage, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = { owner: 'VorxenSC', repo: 'StarCompanion' };
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const COFFEE_URL = 'https://buymeacoffee.com/fpessoau';
// Suggestions go through Web3Forms (no server of our own). The access key is made for public code: it
// only lets anyone send to the developer's inbox, which stays hidden. Empty until the key is set.
const FEEDBACK_ENDPOINT = 'https://api.web3forms.com/submit';
const WEB3FORMS_KEY = '';
const FEEDBACK_MIN_INTERVAL_MS = 60 * 1000;

// The bundled database ships with the app; "Update database" writes a newer one to userData.
const BUNDLED_DB = path.join(__dirname, 'data', 'db.json');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const USER_DB = path.join(DATA_DIR, 'db.json');
const dbFile = () => (fs.existsSync(USER_DB) ? USER_DB : BUNDLED_DB);
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  hotkey: 'Ctrl+Up', // key that shows/hides the overlay (Electron Accelerator format)
  hideOnBlur: true, // close when you click back into the game
  opacity: 1, // whole-window opacity, also set from the tray menu
  height: 760, // maximum height; the window shrinks to fit shorter results
  windowWidth: 720, // the design's 680px column plus room for its glow; changed with the resize grip
  zoom: 1, // text size: Ctrl+= / Ctrl+- / Ctrl+0 in the overlay, or the tray menu
  dock: true, // keep a discreet icon on screen while the overlay is closed
  dockOpacity: 0.35, // that icon's opacity when the mouse is not over it
  showNotice: true, // the "Before you start" notice at launch, until "Don't show this again"
  checkUpdates: true, // look for a new release on GitHub at launch and ask before installing it
  skipVersion: null, // a release the player chose not to be reminded about
  // dockX, dockY: where the icon sits; the bar unfolds from it. Saved when either is dragged.
};

const MIN_HEIGHT = 100;
const MIN_WIDTH = 520;
const OPACITY_STEPS = [1, 0.9, 0.8, 0.7, 0.6];
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
const DOCK_OPACITY_STEPS = [0.2, 0.35, 0.5, 0.7];
// The docked window is a DOCK_SIZE square with the icon centred in it; the bar unfolds so that its
// end square (ICON_SIZE) lands exactly where the icon was.
const DOCK_SIZE = 64;
const ICON_SIZE = 44;
const DOCK_INSET = (DOCK_SIZE - ICON_SIZE) / 2;
const CLOSE_FALLBACK_MS = 900; // if the renderer never reports the fold animation finished

const SNAPSHOT = !!process.env.SC_SNAPSHOT;

let win;
let tray;
let config;
let updating = false;
let state = 'hidden'; // 'docked' | 'open' | 'closing' | 'hidden'
let side = 'right'; // which end of the bar the icon sits at while open
let openHeight = 150;
// Where the bar sits inside the open window, in window pixels; reported by the renderer.
let geo = { inset: 20, barTop: 39, barHeight: 64 };

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    delete saved.x; // 0.2.0 saved the bar's position; the icon's position replaces it
    delete saved.y;
    delete saved.width;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
}

// Snapshot runs must never overwrite the player's saved layout.
let saveTimer;
function saveConfig() {
  if (SNAPSHOT) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)), 300);
}

// ---------- Where the icon lives ----------
function dockPosition() {
  const ok = Number.isFinite(config.dockX) && Number.isFinite(config.dockY) &&
    screen.getAllDisplays().some(({ workArea: a }) => config.dockX >= a.x - DOCK_INSET && config.dockX <= a.x + a.width - DOCK_SIZE + DOCK_INSET && config.dockY >= a.y - DOCK_INSET && config.dockY <= a.y + a.height - DOCK_SIZE + DOCK_INSET);
  if (ok) return { x: config.dockX, y: config.dockY };
  // Default: near the right edge, a quarter of the way down, out of the way of most HUD elements.
  const { workArea: a } = screen.getPrimaryDisplay();
  return { x: a.x + a.width - DOCK_SIZE - 24, y: Math.round(a.y + a.height * 0.25) };
}

// Open bounds: the bar's near end covers the icon, and the bar extends toward the middle of the screen.
function openBounds() {
  const dock = dockPosition();
  const { workArea: a } = screen.getDisplayNearestPoint({ x: dock.x + DOCK_SIZE / 2, y: dock.y + DOCK_SIZE / 2 });
  side = dock.x + DOCK_SIZE / 2 > a.x + a.width / 2 ? 'right' : 'left';
  const width = Math.max(MIN_WIDTH, Math.min(a.width, config.windowWidth));
  let x = side === 'left' ? dock.x + DOCK_INSET - geo.inset : dock.x + DOCK_SIZE - DOCK_INSET + geo.inset - width;
  x = Math.max(a.x, Math.min(a.x + a.width - width, x));
  const y = Math.round(dock.y + DOCK_SIZE / 2 - (geo.barTop + geo.barHeight / 2));
  return { x: Math.round(x), y, width, height: Math.max(MIN_HEIGHT, openHeight), dock };
}

// The inverse of openBounds: after the open window is dragged, the icon moves with it.
function dockFromOpenWindow() {
  const [x, y] = win.getPosition();
  const [width] = win.getSize();
  config.dockX = Math.round(side === 'left' ? x + geo.inset - DOCK_INSET : x + width - geo.inset - DOCK_SIZE + DOCK_INSET);
  config.dockY = Math.round(y + geo.barTop + geo.barHeight / 2 - DOCK_SIZE / 2);
}

function setBounds(bounds) {
  win.setResizable(true);
  win.setBounds(bounds);
  win.setResizable(false);
}

// ---------- Open / close ----------
function open() {
  if (!win) return;
  if (state === 'open') {
    win.focus();
    return;
  }
  const { dock, ...bounds } = openBounds();
  state = 'open';
  win.setFocusable(!SNAPSHOT);
  setBounds(bounds);
  if (SNAPSHOT) win.showInactive();
  else {
    win.show();
    win.focus();
  }
  // Where the icon is inside the open window, in CSS px, so the unfold starts exactly on it.
  win.webContents.send('overlay:open', {
    side,
    iconX: (dock.x + DOCK_INSET - bounds.x) / config.zoom,
    iconY: (dock.y + DOCK_INSET - bounds.y) / config.zoom,
    iconSize: ICON_SIZE / config.zoom,
  });
}

function close() {
  if (state !== 'open') return;
  state = 'closing';
  win.webContents.send('overlay:close');
  setTimeout(finishClose, CLOSE_FALLBACK_MS);
}

function finishClose() {
  if (state !== 'closing') return;
  if (config.dock) dockNow();
  else {
    state = 'hidden';
    win.hide();
  }
}

function dockNow() {
  const dock = dockPosition();
  state = 'docked';
  win.setFocusable(false); // a click on the icon must not pull focus from the game until it opens
  setBounds({ x: dock.x, y: dock.y, width: DOCK_SIZE, height: DOCK_SIZE });
  win.webContents.send('overlay:docked', { opacity: config.dockOpacity });
  win.showInactive();
}

function toggle() {
  if (!win) return;
  if (state === 'open' && win.isFocused()) close();
  else open();
}

// ---------- The icon: click opens, drag moves ----------
let dockDrag = null;
function dockPointer(phase) {
  if (phase === 'down' && state === 'docked') {
    const start = screen.getCursorScreenPoint();
    const [x0, y0] = win.getPosition();
    dockDrag = { moved: false, timer: null };
    dockDrag.timer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      if (!dockDrag.moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      dockDrag.moved = true;
      win.setPosition(x0 + p.x - start.x, y0 + p.y - start.y);
    }, 1000 / 60);
  } else if (phase === 'up' && dockDrag) {
    clearInterval(dockDrag.timer);
    const wasDrag = dockDrag.moved;
    dockDrag = null;
    if (wasDrag) {
      [config.dockX, config.dockY] = win.getPosition();
      saveConfig();
    } else open();
  }
}

// ---------- Size ----------
// The renderer animates its panel in CSS and asks for the window height that fits it: it grows the
// window before the panel opens and shrinks it after the panel closes, so the window itself never
// needs animating (Electron's animate flag on setBounds only works on macOS anyway).
function fitHeight(wanted, beyondMax) {
  if (!win || state !== 'open' || !Number.isFinite(wanted)) return;
  // beyondMax: content that must show whole (the startup notice) may use the screen's height.
  const limit = beyondMax ? screen.getDisplayMatching(win.getBounds()).workArea.height : config.height;
  const target = Math.round(Math.max(MIN_HEIGHT, Math.min(limit, wanted)));
  openHeight = target;
  const [w, current] = win.getSize();
  if (current === target) return;
  win.setResizable(true);
  win.setSize(w, target);
  win.setResizable(false);
}

// Driven by the renderer's resize grip: transparent windows can't be resized from their edges on
// Windows. Width applies now; the new maximum height applies through the next fit.
function resizeFromGrip(width, maxHeight) {
  if (!win || state !== 'open') return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  config.windowWidth = Math.round(Math.max(MIN_WIDTH, Math.min(workArea.width, width)));
  config.height = Math.round(Math.max(220, Math.min(workArea.height, maxHeight)));
  const b = win.getBounds();
  // Anchored on the icon's side: with the icon on the right, the bar grows and shrinks leftward.
  const x = side === 'right' ? b.x + b.width - config.windowWidth : b.x;
  setBounds({ x, y: b.y, width: config.windowWidth, height: b.height });
}

// The grip only says when a drag starts and ends; the size follows the real cursor, so it works at
// any text size and even when the pointer leaves the window.
let gripTimer;
function startGrip() {
  clearInterval(gripTimer);
  const start = screen.getCursorScreenPoint();
  const [w0] = win.getSize();
  const max0 = config.height;
  const dir = side === 'right' ? -1 : 1; // the grip sits on the far side from the icon
  gripTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    resizeFromGrip(w0 + dir * (p.x - start.x), max0 + p.y - start.y);
    sendLayout();
  }, 1000 / 60);
}
function endGrip() {
  clearInterval(gripTimer);
  dockFromOpenWindow();
  saveConfig();
}

// ---------- Settings ----------
function setZoom(value) {
  config.zoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], value));
  win.webContents.setZoomFactor(config.zoom);
  sendLayout();
  saveConfig();
  buildTray();
}

function stepZoom(direction) {
  if (direction === 0) return setZoom(1);
  const i = ZOOM_STEPS.findIndex((z) => z >= config.zoom - 0.001);
  setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i === -1 ? ZOOM_STEPS.length - 1 : i) + direction))]);
}

// The renderer lays out in CSS px; it needs the zoom to turn them into window pixels.
function sendLayout() {
  win?.webContents.send('overlay:layout', { maxHeight: config.height, zoom: config.zoom, side, dockOpacity: config.dockOpacity });
}

function setOpacity(value) {
  config.opacity = value;
  win.setOpacity(value);
  saveConfig();
  buildTray();
}

function setDock(enabled) {
  config.dock = enabled;
  saveConfig();
  buildTray();
  if (state === 'docked' && !enabled) {
    state = 'hidden';
    win.hide();
  } else if (state === 'hidden' && enabled) dockNow();
}

function setDockOpacity(value) {
  config.dockOpacity = value;
  sendLayout();
  saveConfig();
  buildTray();
}

function resetLayout() {
  delete config.dockX;
  delete config.dockY;
  config.windowWidth = DEFAULT_CONFIG.windowWidth;
  config.height = DEFAULT_CONFIG.height;
  saveConfig();
  sendLayout();
  if (state === 'open') setBounds(openBounds());
  else if (state === 'docked') dockNow();
}

// ---------- Updates (GitHub releases) ----------
// The installed app downloads and installs a new release after asking. The portable exe can't replace
// itself, so it only offers the download page.
const PORTABLE = !!process.env.PORTABLE_EXECUTABLE_FILE;
const UPDATE_TEST = process.env.SC_UPDATE_TEST; // dev aid: pretend to be this version, log the result, quit
let updateStatus = ''; // shown in the tray menu while a download runs
let manualCheck = false;

function updateLog(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  if (UPDATE_TEST) process.stdout.write(line);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), line); } catch { /* logging must never break updates */ }
}

function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: (m) => updateLog('info', m), warn: (m) => updateLog('warn', m), error: (m) => updateLog('error', m), debug: () => {} };
  if (UPDATE_TEST) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'github', ...REPO });
    // Must be a SemVer from electron-updater's own copy of semver, or its comparisons reject it.
    const semver = require(require.resolve('semver', { paths: [path.dirname(require.resolve('electron-updater'))] }));
    autoUpdater.currentVersion = semver.parse(UPDATE_TEST);
  }
  autoUpdater.on('update-available', (info) => {
    updateLog('available', info.version);
    if (UPDATE_TEST) return app.quit();
    askToUpdate(info);
  });
  autoUpdater.on('update-not-available', (info) => {
    updateLog('up to date', info.version);
    if (UPDATE_TEST) return app.quit();
    if (manualCheck) dialog.showMessageBox({ type: 'info', title: 'Star Companion', message: 'You have the latest version.', detail: `Star Companion ${app.getVersion()}`, noLink: true });
  });
  autoUpdater.on('download-progress', (p) => {
    updateStatus = `Downloading update… ${Math.round(p.percent)}%`;
    buildTray();
  });
  autoUpdater.on('update-downloaded', () => {
    updateStatus = '';
    // The player already chose "Update now": install and relaunch.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  autoUpdater.on('error', (err) => {
    updateLog('error', err?.message || err);
    updateStatus = '';
    buildTray();
    if (UPDATE_TEST) return app.quit();
    if (manualCheck) dialog.showMessageBox({ type: 'warning', title: 'Star Companion', message: 'Could not check for updates.', detail: String(err?.message || err), noLink: true });
  });
}

async function askToUpdate(info) {
  if (!manualCheck && info.version === config.skipVersion) return;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'info',
    title: 'Star Companion update',
    message: `Star Companion ${info.version} is available`,
    detail: PORTABLE
      ? `You have ${app.getVersion()}. The portable version can't update itself: download the new one from GitHub.`
      : `You have ${app.getVersion()}. Update now? It downloads (about 100 MB), installs and restarts Star Companion.`,
    buttons: [PORTABLE ? 'Open download page' : 'Update now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: manualCheck ? undefined : "Don't remind me about this version",
    noLink: true,
  });
  if (response === 0) {
    if (PORTABLE) shell.openExternal(RELEASES_URL);
    else {
      updateStatus = 'Downloading update…';
      buildTray();
      autoUpdater.downloadUpdate().catch((err) => updateLog('download failed', err?.message || err));
    }
  } else if (checkboxChecked) {
    config.skipVersion = info.version;
    saveConfig();
  }
}

function checkForUpdates(manual) {
  manualCheck = manual;
  if (!app.isPackaged && !UPDATE_TEST) {
    if (manual) dialog.showMessageBox({ type: 'info', title: 'Star Companion', message: 'Updates are checked by the installed app.', detail: 'You are running from source; use git pull.', noLink: true });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => updateLog('check failed', err?.message || err));
}

function setCheckUpdates(enabled) {
  config.checkUpdates = enabled;
  saveConfig();
  buildTray();
}

// ---------- Live game version ----------
// The database records the PU version its data is for; UEX says which version is live now. The renderer
// compares them and flags the data as outdated after a patch, until the database is updated.
const GAME_VERSION_URL = 'https://api.uexcorp.uk/2.0/game_versions';
let liveGameVersion = null;

async function checkGameVersion() {
  try {
    const res = await net.fetch(GAME_VERSION_URL, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    liveGameVersion = body?.data?.live || null;
    if (liveGameVersion) win?.webContents.send('game:version', { live: liveGameVersion, ptu: body.data.ptu || null });
  } catch {
    // offline: keep showing the version the data was built for
  }
}

// ---------- Suggestions ----------
let lastFeedbackAt = 0;

async function sendFeedback(f) {
  if (!f || typeof f.message !== 'string' || f.message.trim().length < 10) return { ok: false, error: 'Please write at least a sentence.' };
  if (Date.now() - lastFeedbackAt < FEEDBACK_MIN_INTERVAL_MS) return { ok: false, error: 'Thanks! Please wait a minute before sending another one.' };
  if (!WEB3FORMS_KEY) return { ok: false, error: 'Suggestions are not set up in this build yet.' };
  const clip = (s, n) => String(s || '').trim().slice(0, n);
  const body = {
    access_key: WEB3FORMS_KEY,
    subject: `Star Companion · ${clip(f.kind, 40) || 'Suggestion'}`,
    from_name: clip(f.name, 80) || 'Star Companion user',
    type: clip(f.kind, 40),
    message: clip(f.message, 4000),
    name: clip(f.name, 80) || 'Anonymous',
    ...(clip(f.email, 120) ? { email: clip(f.email, 120), replyto: clip(f.email, 120) } : {}),
    ...(f.includeInfo ? { app: `Star Companion ${app.getVersion()} · PU ${clip(f.gameVersion, 20) || '?'} · ${process.platform} ${require('os').release()}` } : {}),
  };
  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.success === false) return { ok: false, error: out.message || `The server answered ${res.status}.` };
    lastFeedbackAt = Date.now();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not send (${err?.name === 'TimeoutError' ? 'timed out' : 'no connection'}). Your text is kept; try again.` };
  }
}

function openFeedback() {
  open();
  win.webContents.send('overlay:feedback');
}

// ---------- Startup notice ----------
// Shown in the overlay itself at launch; the update check waits until it is dismissed.
function startup() {
  checkGameVersion();
  setInterval(checkGameVersion, 6 * 60 * 60 * 1000);
  if (config.showNotice) {
    open();
    win.webContents.send('overlay:notice');
  } else {
    if (config.dock) dockNow();
    else open();
    if (config.checkUpdates) setTimeout(() => checkForUpdates(false), 4000);
  }
}

function noticeDone(dontShowAgain) {
  if (dontShowAgain) {
    config.showNotice = false;
    saveConfig();
  }
  if (config.checkUpdates) setTimeout(() => checkForUpdates(false), 1500);
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  if (SNAPSHOT) return true; // a test copy must not grab the key from the player's running copy
  const ok = globalShortcut.register(config.hotkey, toggle);
  if (!ok) console.warn(`Could not register ${config.hotkey} (already used by another program?)`);
  return ok;
}

// ---------- Start with Windows ----------
// Registers the exe the player launched: the installed app, or the portable exe where it sits
// (moving the portable exe afterwards breaks the entry until the option is toggled again).
function loginItemOptions() {
  return { path: PORTABLE ? process.env.PORTABLE_EXECUTABLE_FILE : process.execPath, args: [] };
}

function startsWithWindows() {
  return app.isPackaged && app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setStartWithWindows(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
  buildTray();
}

// ---------- Changing the hotkey ----------
// While the recorder is open the global shortcut is released, so pressing the current key records
// it instead of closing the overlay.
function openHotkeyRecorder() {
  open();
  win.webContents.send('overlay:hotkey', config.hotkey);
}

function setHotkey(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator) return { ok: false, error: 'No shortcut recorded.' };
  if (SNAPSHOT) return { ok: true, hotkey: accelerator }; // never register real keys from a test copy
  globalShortcut.unregisterAll();
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggle);
  } catch {
    ok = false; // not a valid accelerator
  }
  if (!ok) {
    registerHotkey(); // put the old one back
    return { ok: false, error: `${accelerator} is not available — another program may already use it. Try another.` };
  }
  config.hotkey = accelerator;
  saveConfig();
  buildTray();
  return { ok: true, hotkey: accelerator };
}

function updateData() {
  if (updating) return;
  updating = true;
  buildTray();
  // Runs the collectors with Electron's bundled Node, so no separate Node install is needed.
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'update-all.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SC_DATA_DIR: DATA_DIR },
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('exit', (code) => {
    updating = false;
    buildTray();
    win?.webContents.send('db:updated', { ok: code === 0 });
  });
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png')));
    tray.on('click', toggle);
  }
  const radio = (steps, current, set) => steps.map((v) => ({ label: `${Math.round(v * 100)}%`, type: 'radio', checked: Math.abs(current - v) < 0.01, click: () => set(v) }));
  tray.setToolTip(`Star Companion — press ${config.hotkey} to open`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show / hide (${config.hotkey})`, click: toggle },
      { type: 'separator' },
      {
        label: app.isPackaged ? 'Start with Windows' : 'Start with Windows (installed app only)',
        type: 'checkbox',
        checked: startsWithWindows(),
        enabled: app.isPackaged,
        click: (item) => setStartWithWindows(item.checked),
      },
      { label: 'Show icon when closed', type: 'checkbox', checked: config.dock, click: (item) => setDock(item.checked) },
      { label: 'Icon opacity', enabled: config.dock, submenu: radio(DOCK_OPACITY_STEPS, config.dockOpacity, setDockOpacity) },
      { label: 'Opacity', submenu: radio(OPACITY_STEPS, config.opacity, setOpacity) },
      {
        label: 'Text size',
        submenu: [
          ...radio(ZOOM_STEPS, config.zoom, setZoom),
          { type: 'separator' },
          { label: 'Larger (Ctrl+=)', click: () => stepZoom(1) },
          { label: 'Smaller (Ctrl+-)', click: () => stepZoom(-1) },
        ],
      },
      { label: 'Reset position and size', click: resetLayout },
      {
        label: `Change hotkey… (${config.hotkey})`,
        click: openHotkeyRecorder,
      },
      {
        label: 'Show startup notice',
        click: () => {
          open();
          win.webContents.send('overlay:notice');
        },
      },
      { type: 'separator' },
      updateStatus
        ? { label: updateStatus, enabled: false }
        : { label: `Check for updates (v${app.getVersion()})`, click: () => checkForUpdates(true) },
      { label: 'Check for updates at launch', type: 'checkbox', checked: config.checkUpdates, click: (item) => setCheckUpdates(item.checked) },
      { label: updating ? 'Updating database…' : 'Update database', enabled: !updating, click: updateData },
      { label: 'Edit settings', click: () => shell.openPath(CONFIG_FILE) },
      {
        label: 'Reload settings',
        click: () => {
          config = loadConfig();
          win.setOpacity(config.opacity);
          win.webContents.setZoomFactor(config.zoom);
          sendLayout();
          registerHotkey();
          buildTray();
        },
      },
      { type: 'separator' },
      { label: 'Send a suggestion…', click: openFeedback },
      { label: 'Buy me a coffee…', click: () => shell.openExternal(COFFEE_URL) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: DOCK_SIZE,
    height: DOCK_SIZE,
    ...dockPosition(),
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 'screen-saver' keeps the overlay above borderless-fullscreen games.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(config.opacity);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(config.zoom));
  win.on('blur', () => { if (state === 'open' && config.hideOnBlur && !win.webContents.isDevToolsOpened()) close(); });
  win.on('moved', () => {
    if (state === 'open') {
      dockFromOpenWindow();
      saveConfig();
    }
  });
  // Links never navigate the overlay itself.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Dev aid: SC_SNAPSHOT="out-dir|step|…" renders each step and saves a PNG, then quits. Uses the saved
// config read-only (saveConfig is a no-op in this mode). A step is "query;type;view" (view "list"
// shows the result list, else the best match's detail), or "@dock", "@open", "@zoom+", "@zoom-",
// "@left"/"@right" (icon to that screen edge), or "@mid" (a capture 180ms into the next step, to see
// an animation in flight).
function snapshotMode(spec) {
  const [dir, ...steps] = spec.split('|');
  config.hideOnBlur = false;
  const backdrop = `document.documentElement.style.background = '#05080d'`;
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    open();
    await win.webContents.executeJavaScript(backdrop);
    await new Promise((r) => setTimeout(r, 1200));
    let n = 0;
    let midNext = false;
    const capture = async () => fs.writeFileSync(path.join(dir, `snap-${++n}.png`), (await win.webContents.capturePage()).toPNG());
    for (const step of steps) {
      if (step === '@mid') { midNext = true; continue; }
      const [query, type = 'all', view = 'detail'] = step.split(';');
      if (step === '@notice') win.webContents.send('overlay:notice');
      else if (step === '@version') await checkGameVersion();
      else if (step === '@stale') win.webContents.send('game:version', { live: '9.99.0' }); // pretend a newer patch is live
      else if (step === '@feedback') openFeedback();
      else if (step === '@feedback-send') {
        // Fill the form and press send (a snapshot copy never mails: the send handler answers ok).
        await win.webContents.executeJavaScript(`$('fb-message').value = 'The commodity demand bars are great, could they show the SCU demand too?'; $('fb-message').dispatchEvent(new Event('input')); submitFeedback()`);
      }
      else if (step === '@hotkey') openHotkeyRecorder();
      else if (step.startsWith('@press:')) {
        // "@press:ctrl+shift+KeyK" sends that keydown to the recorder (modifiers, then a KeyboardEvent code).
        const parts = step.slice(7).split('+');
        const code = parts.pop();
        const mods = Object.fromEntries(parts.map((m) => [`${m}Key`, true]));
        await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ code, key: code, ...mods })}))`);
      }
      else if (step === '@dock') close();
      else if (step === '@open') open();
      else if (step === '@left' || step === '@right') {
        // Move the icon to that edge (in memory only) so the unfold direction can be checked.
        const { workArea: a } = screen.getPrimaryDisplay();
        config.dockX = step === '@left' ? a.x + 24 : a.x + a.width - DOCK_SIZE - 24;
        config.dockY = Math.round(a.y + a.height * 0.25);
        if (state === 'docked') dockNow();
      }
      else if (query.startsWith('@zoom')) stepZoom(query.endsWith('+') ? 1 : -1);
      else {
        const js = view === 'list' || !query
          ? `qEl.value = ${JSON.stringify(query)}; type = ${JSON.stringify(type)}; search();`
          : `goTo(${JSON.stringify(query)}, ${JSON.stringify(type)})`;
        await win.webContents.executeJavaScript(js);
      }
      if (midNext) {
        await new Promise((r) => setTimeout(r, 180));
        await capture();
        midNext = false;
      }
      await new Promise((r) => setTimeout(r, 1200)); // transitions, text reveal, window shrink
      await win.webContents.executeJavaScript(backdrop);
      await capture();
    }
    app.quit();
  });
}

ipcMain.handle('db:load', () => fs.promises.readFile(dbFile(), 'utf8'));
ipcMain.handle('app:config', () => ({ hotkey: config.hotkey, maxHeight: config.height, zoom: config.zoom, dockOpacity: config.dockOpacity, liveGameVersion }));
ipcMain.on('overlay:hide', () => close());
ipcMain.on('overlay:closed', () => finishClose());
ipcMain.on('overlay:geometry', (_e, g) => {
  if (g && [g.inset, g.barTop, g.barHeight].every(Number.isFinite)) geo = g;
});
ipcMain.on('overlay:fit', (_e, height, beyondMax) => fitHeight(Number(height), !!beyondMax));
ipcMain.on('overlay:grip', (_e, phase) => (phase === 'start' ? startGrip() : endGrip()));
ipcMain.on('overlay:zoom', (_e, direction) => stepZoom(Math.sign(Number(direction))));
ipcMain.on('dock:pointer', (_e, phase) => dockPointer(phase));
ipcMain.on('notice:done', (_e, dontShowAgain) => noticeDone(!!dontShowAgain));
ipcMain.on('hotkey:recording', (_e, active) => (active ? globalShortcut.unregisterAll() : registerHotkey()));
ipcMain.handle('hotkey:set', (_e, accelerator) => setHotkey(accelerator));
ipcMain.handle('feedback:send', (_e, f) => (SNAPSHOT ? { ok: true } : sendFeedback(f))); // a test copy never mails
ipcMain.on('link:open', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// Snapshot runs skip the single-instance lock so they never poke an overlay the player has open.
if (!SNAPSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', open);
  app.whenReady().then(() => {
    config = loadConfig();
    setupUpdater();
    if (UPDATE_TEST) return checkForUpdates(false);
    createWindow();
    registerHotkey();
    buildTray();
    if (SNAPSHOT) snapshotMode(process.env.SC_SNAPSHOT);
    // The notice first if it is due, else the icon (or the bar once, so the player knows the app runs).
    else win.webContents.once('did-finish-load', startup);
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', (e) => e.preventDefault());
}
