const { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, shell, Tray, Menu, nativeImage, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const i18n = require('./renderer/i18n.js');
const T = i18n.t;

const REPO = { owner: 'VorxenSC', repo: 'StarCompanion' };
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const COFFEE_URL = 'https://buymeacoffee.com/fpessoau';
// Suggestions go through Web3Forms (no server of our own). The access key is made for public code: it
// only lets anyone send to the developer's inbox, which stays hidden.
const FEEDBACK_ENDPOINT = 'https://api.web3forms.com/submit';
const WEB3FORMS_KEY = '17f6eb23-5a40-4835-80d0-4b7284e395b7';
const FEEDBACK_MIN_INTERVAL_MS = 60 * 1000;

// The bundled database ships with the app; "Update database" writes a newer one to userData.
const BUNDLED_DB = path.join(__dirname, 'data', 'db.json');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const USER_DB = path.join(DATA_DIR, 'db.json');
const dbFile = () => (fs.existsSync(USER_DB) ? USER_DB : BUNDLED_DB);
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  hotkey: '/', // the single key that shows/hides the overlay (Electron Accelerator format)
  hideOnBlur: true, // close when you click back into the game
  transparency: 0, // 0 = solid ("Default"); 1 = the most see-through that still reads well
  height: 1520, // maximum height (capped to the screen); the window shrinks to fit shorter results
  windowWidth: 720, // the design's 680px column plus room for its glow; changed with the resize grip
  zoom: 1, // text size: Ctrl+= / Ctrl+- / Ctrl+0 in the overlay, or the tray menu
  dock: true, // keep a discreet icon on screen while the overlay is closed
  dockOpacity: 0.35, // that icon's opacity when the mouse is not over it
  showNotice: true, // the "Before you start" notice at launch, until "Don't show this again"
  checkUpdates: true, // look for a new release on GitHub at launch and ask before installing it
  skipVersion: null, // a release the player chose not to be reminded about
  language: 'auto', // 'auto' (Windows' language), 'en' or 'pt-BR'
  // dockX, dockY: where the icon sits; the bar unfolds from it. Saved when either is dragged.
  // sizeChosen: true once the player resized with the grip; their width and height are kept from then on.
};

const MIN_HEIGHT = 100;
const MIN_WIDTH = 520;
// Transparency: Default (solid) … 100% (as see-through as stays readable). Window opacity = 1 - 0.45 × t.
const TRANSPARENCY_STEPS = [0, 0.25, 0.5, 0.75, 1];
const MIN_OPACITY = 0.55;
const opacityFor = (t) => 1 - (1 - MIN_OPACITY) * t;
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
const DOCK_OPACITY_STEPS = [0.2, 0.35, 0.5, 0.7];
// The docked window is a DOCK_SIZE square with the icon centred in it; the bar unfolds so that its
// end square (ICON_SIZE) lands exactly where the icon was.
const DOCK_SIZE = 64;
const ICON_SIZE = 44;
const DOCK_INSET = (DOCK_SIZE - ICON_SIZE) / 2;
const CLOSE_FALLBACK_MS = 900; // if the renderer never reports the fold animation finished
const BLUR_GRACE_MS = 600;

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
    // Shortcuts are single keys since 0.4.6; a saved combination (e.g. Ctrl+Up) becomes the default.
    if (typeof saved.hotkey === 'string' && /.\+./.test(saved.hotkey)) delete saved.hotkey;
    // 0.4.7: "opacity" became "transparency" (the scale was the wrong way round for players).
    if (saved.transparency == null && Number.isFinite(saved.opacity)) {
      const t = (1 - saved.opacity) / (1 - MIN_OPACITY);
      saved.transparency = TRANSPARENCY_STEPS.reduce((best, v) => (Math.abs(v - t) < Math.abs(best - t) ? v : best), 0);
    }
    delete saved.opacity;
    // Sizes saved before 0.4.7 were defaults, not choices: take the new (taller) default.
    if (!saved.sizeChosen) {
      delete saved.height;
      delete saved.windowWidth;
    }
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
}

// The language in use: the player's choice, or Windows' display language when it is "auto".
function applyLanguage() {
  i18n.setLanguage(i18n.resolve(config.language, app.getPreferredSystemLanguages()));
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
// Windows only gives keyboard focus to the app the player last used. With the game in front, the
// overlay's own focus() is refused, so the key helper (which may join the foreground thread's input for
// that one call) brings it forward; focus() stays as the first try and the fallback.
let openedAt = 0;
let focusGained = false; // since the last open: did the overlay ever get keyboard focus?
function takeFocus() {
  if (SNAPSHOT) return;
  win.show();
  win.focus();
  win.webContents.focus();
  if (keyHelper && keyHelperReady && !win.isFocused()) {
    const h = win.getNativeWindowHandle();
    const hwnd = h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0));
    keyHelper.stdin.write(`focus ${hwnd}\n`);
  }
  setTimeout(() => keysLog(`open: focused=${win.isFocused()}`), 400);
}

function open() {
  if (!win) return;
  if (state === 'open') {
    takeFocus();
    return;
  }
  const { dock, ...bounds } = openBounds();
  state = 'open';
  openedAt = Date.now();
  focusGained = false;
  win.setFocusable(!SNAPSHOT);
  setBounds(bounds);
  if (SNAPSHOT) win.showInactive();
  else takeFocus();
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

// Open → close. The one exception: the overlay had focus, lost it to the game (with "close when
// clicking the game" off), and the key brings it back instead.
function toggle() {
  if (!win) return;
  if (state === 'open' && (win.isFocused() || !focusGained || config.hideOnBlur)) close();
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
  const screenH = screen.getDisplayMatching(win.getBounds()).workArea.height;
  const limit = beyondMax ? screenH : Math.min(screenH, config.height);
  const target = Math.round(Math.max(MIN_HEIGHT, Math.min(limit, wanted)));
  openHeight = target;
  const [w, current] = win.getSize();
  if (current === target) return;
  win.setResizable(true);
  win.setSize(w, target);
  win.setResizable(false);
}

// Wide content (a table whose rows should stay on one line) asks for more width than the player's
// chosen width. The window widens toward the screen's middle, up to half the screen, and returns to
// the chosen width when the content no longer needs it. The chosen width itself is never changed here.
let widening = false; // our own setBounds must not move the icon (see the 'moved' handler)
function fitWidth(wanted) {
  if (!win || state !== 'open' || !Number.isFinite(wanted)) return;
  const b = win.getBounds();
  const { workArea: a } = screen.getDisplayMatching(b);
  const base = Math.max(MIN_WIDTH, Math.min(a.width, config.windowWidth));
  const width = Math.round(Math.max(base, Math.min(Math.floor(a.width * 0.5), wanted)));
  if (width === b.width) return;
  let x = side === 'right' ? b.x + b.width - width : b.x;
  x = Math.max(a.x, Math.min(a.x + a.width - width, x));
  widening = true;
  setBounds({ x, y: b.y, width, height: b.height });
  setImmediate(() => { widening = false; });
}

// Driven by the renderer's resize grip: transparent windows can't be resized from their edges on
// Windows. Width applies now; the new maximum height applies through the next fit.
function resizeFromGrip(width, maxHeight) {
  if (!win || state !== 'open') return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  config.windowWidth = Math.round(Math.max(MIN_WIDTH, Math.min(workArea.width, width)));
  config.height = Math.round(Math.max(220, Math.min(workArea.height, maxHeight)));
  config.sizeChosen = true;
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
// The saved maximum height, capped to the screen the overlay is on.
function maxHeight() {
  const area = win ? screen.getDisplayMatching(win.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
  return Math.min(area.height, config.height);
}

function sendLayout() {
  win?.webContents.send('overlay:layout', { maxHeight: maxHeight(), zoom: config.zoom, side, dockOpacity: config.dockOpacity });
}

function setTransparency(value) {
  config.transparency = value;
  win.setOpacity(opacityFor(value));
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
  config.sizeChosen = false;
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
    if (manualCheck) dialog.showMessageBox({ type: 'info', title: 'Star Companion', message: T('You have the latest version.'), detail: `Star Companion ${app.getVersion()}`, noLink: true });
  });
  autoUpdater.on('download-progress', (p) => {
    updateStatus = T('Downloading update… {pct}%', { pct: Math.round(p.percent) });
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
    if (manualCheck) dialog.showMessageBox({ type: 'warning', title: 'Star Companion', message: T('Could not check for updates.'), detail: String(err?.message || err), noLink: true });
  });
}

async function askToUpdate(info) {
  if (!manualCheck && info.version === config.skipVersion) return;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'info',
    title: T('Star Companion update'),
    message: T('Star Companion {version} is available', { version: info.version }),
    detail: PORTABLE
      ? T("You have {current}. The portable version can't update itself: download the new one from GitHub.", { current: app.getVersion() })
      : T('You have {current}. Update now? It downloads (about 100 MB), installs and restarts Star Companion.', { current: app.getVersion() }),
    buttons: [PORTABLE ? T('Open download page') : T('Update now'), T('Later')],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: manualCheck ? undefined : T("Don't remind me about this version"),
    noLink: true,
  });
  if (response === 0) {
    if (PORTABLE) shell.openExternal(RELEASES_URL);
    else {
      updateStatus = T('Downloading update…');
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
    if (manual) dialog.showMessageBox({ type: 'info', title: 'Star Companion', message: T('Updates are checked by the installed app.'), detail: T('You are running from source; use git pull.'), noLink: true });
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
    // net.fetch (Chromium's network stack): Web3Forms' free plan only accepts browser requests.
    const res = await net.fetch(FEEDBACK_ENDPOINT, {
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

// ---------- The shortcut key ----------
// Star Citizen registers its keyboard with Raw Input's "no hotkeys" flag, which switches off
// RegisterHotKey-style shortcuts (Electron's globalShortcut) while the game has focus. So on Windows a
// small helper (native/keys) listens with Raw Input in sink mode, the documented passive way for a
// background window to receive keys, and reports "HIT" when the shortcut key goes down. Keys are not
// consumed: the game still gets them. globalShortcut is only the fallback if the helper can't run.
const KEYS_EXE = path.join(__dirname, 'bin', 'StarCompanionKeys.exe');
const VK = {
  Space: 32, Tab: 9, Backspace: 8, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Up: 38, Down: 40, Left: 37, Right: 39, PrintScreen: 44, Scrolllock: 145, Numlock: 144,
  numdiv: 111, nummult: 106, numadd: 107, numsub: 109, numdec: 110,
};
let keyHelper = null;
let keyHelperReady = false;
let keyHelperStarts = 0;
let keysSeen = null; // key presses the helper has seen (diagnostics shown in Settings)
let lastHitAt = null;
const statsWaiters = [];
// Asks the helper how many key presses it has seen; resolves within 200 ms either way.
function refreshKeyStats() {
  if (!(keyHelper && keyHelperReady)) return Promise.resolve();
  return new Promise((resolve) => {
    statsWaiters.push(resolve);
    keyHelper.stdin.write('stats\n');
    setTimeout(resolve, 200);
  });
}

// %APPDATA%\Star Companion\keys.log: when the listener started, each shortcut press and whether the
// overlay got focus. Never which other keys were pressed. Kept short.
const KEYS_LOG = path.join(app.getPath('userData'), 'keys.log');
function keysLog(line) {
  if (SNAPSHOT || UPDATE_TEST) return;
  try {
    if (fs.existsSync(KEYS_LOG) && fs.statSync(KEYS_LOG).size > 200 * 1024) fs.renameSync(KEYS_LOG, KEYS_LOG + '.old');
    fs.appendFileSync(KEYS_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never break the shortcut */ }
}
let recordingHotkey = false;
let quitting = false;

// "F8" → "vk:119", "num5" → "vk:101", "K" → "vk:75", "/" → "char:/" (resolved on the active keyboard
// layout by the helper, so the key that types "/" is used on ABNT2 and US alike). null = not a single key.
function keyToken(accelerator) {
  const a = String(accelerator || '');
  let m;
  if (VK[a]) return `vk:${VK[a]}`;
  if ((m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(a))) return `vk:${111 + Number(m[1])}`;
  if ((m = /^num([0-9])$/.exec(a))) return `vk:${96 + Number(m[1])}`;
  if (/^[A-Z]$/i.test(a)) return `vk:${a.toUpperCase().charCodeAt(0)}`;
  if (/^[0-9]$/.test(a)) return `vk:${a.charCodeAt(0)}`;
  if (a.length === 1) return `char:${a}`;
  return null;
}

function startKeyHelper() {
  if (process.platform !== 'win32' || SNAPSHOT || UPDATE_TEST || !fs.existsSync(KEYS_EXE) || keyHelperStarts >= 3) return;
  keyHelperStarts++;
  const child = spawn(KEYS_EXE, [keyToken(config.hotkey) || ''], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  keyHelper = child;
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line === 'READY') {
        if (process.env.SC_DEBUG_KEYS) console.log('[keys] READY');
        keysLog(`listener ready, shortcut ${config.hotkey} (${keyToken(config.hotkey)})`);
        keyHelperReady = true;
        globalShortcut.unregisterAll(); // the helper now owns the key; both would toggle twice
      } else if (line.startsWith('FOCUS ')) {
        keysLog(`focus handoff: ${line.slice(6)}`);
      } else if (line.startsWith('STATS ')) {
        keysSeen = Number(line.slice(6));
        statsWaiters.splice(0).forEach((done) => done());
      } else if (line.startsWith('ERROR')) {
        keysLog(`listener ${line}`);
      } else if (line === 'HIT' && !recordingHotkey) {
        lastHitAt = Date.now();
        keysLog(`shortcut pressed (state ${state}, game or other app in front: ${!win.isFocused()})`);
        // SC_DEBUG_KEYS: log instead of opening, so a test copy never takes over the screen.
        if (process.env.SC_DEBUG_KEYS) console.log(`[keys] HIT ${config.hotkey}`);
        else toggle();
      }
    }
  });
  child.on('error', () => {});
  child.on('exit', (code) => {
    keysLog(`listener stopped (exit ${code})`);
    if (keyHelper === child) {
      keyHelper = null;
      keyHelperReady = false;
    }
    if (quitting) return;
    registerHotkey(); // fall back to globalShortcut meanwhile
    setTimeout(startKeyHelper, 2000);
  });
}

function stopKeyHelper() {
  quitting = true;
  try { keyHelper?.stdin.end(); keyHelper?.kill(); } catch { /* already gone */ }
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  if (SNAPSHOT || UPDATE_TEST) return true; // a test copy must not grab the key from the player's running copy
  if (keyHelper && keyHelperReady) {
    keyHelper.stdin.write(`keys ${keyToken(config.hotkey) || ''}\n`);
    return true;
  }
  let ok = false;
  try { ok = globalShortcut.register(config.hotkey, toggle); } catch { ok = false; }
  if (!ok) console.warn(`Could not register ${config.hotkey} (already used by another program?)`);
  return ok;
}

function setHotkeyRecording(active) {
  recordingHotkey = !!active;
  if (keyHelper && keyHelperReady) keyHelper.stdin.write(active ? 'pause\n' : 'resume\n');
  if (active) globalShortcut.unregisterAll();
  else registerHotkey();
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

// ---------- Settings panel ----------
// Everything the player can change, shown in the overlay itself (not by opening config.json, which
// Windows hands to whatever program owns .json files). Changes apply and save at once.
function settingsSnapshot() {
  return {
    hotkey: config.hotkey,
    startWithWindows: startsWithWindows(),
    canStartWithWindows: app.isPackaged,
    dock: config.dock,
    dockOpacity: config.dockOpacity,
    transparency: config.transparency,
    zoom: config.zoom,
    hideOnBlur: config.hideOnBlur,
    checkUpdates: config.checkUpdates,
    language: config.language,
    languageInUse: i18n.getLanguage(),
    version: app.getVersion(),
    keys: { listener: !!(keyHelper && keyHelperReady), seen: keysSeen, lastHitAt, log: KEYS_LOG },
    steps: { dockOpacity: DOCK_OPACITY_STEPS, transparency: TRANSPARENCY_STEPS, zoom: ZOOM_STEPS },
  };
}

function applySetting(key, value) {
  switch (key) {
    case 'startWithWindows': setStartWithWindows(!!value); break;
    case 'dock': setDock(!!value); break;
    case 'dockOpacity': if (DOCK_OPACITY_STEPS.includes(value)) setDockOpacity(value); break;
    case 'transparency': if (TRANSPARENCY_STEPS.includes(value)) setTransparency(value); break;
    case 'zoom': if (ZOOM_STEPS.includes(value)) setZoom(value); break;
    case 'hideOnBlur': config.hideOnBlur = !!value; saveConfig(); break;
    case 'checkUpdates': setCheckUpdates(!!value); break;
    case 'language':
      if (!i18n.languages.includes(value)) break;
      config.language = value;
      applyLanguage();
      saveConfig();
      buildTray();
      break;
    default: break;
  }
  return settingsSnapshot();
}

function settingsAction(action) {
  if (action === 'resetLayout') resetLayout();
  else if (action === 'checkUpdates') checkForUpdates(true);
  else if (action === 'notice') win.webContents.send('overlay:notice');
  else if (action === 'showFile') shell.showItemInFolder(CONFIG_FILE); // Explorer, never "open with"
  else if (action === 'showKeysLog') shell.showItemInFolder(fs.existsSync(KEYS_LOG) ? KEYS_LOG : CONFIG_FILE);
  return settingsSnapshot();
}

function openSettings() {
  open();
  win.webContents.send('overlay:settings');
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
  if (/.\+./.test(accelerator)) return { ok: false, error: 'Use a single key on its own, without Ctrl, Alt or Shift.' };
  if (!keyToken(accelerator)) return { ok: false, error: "{key} can't be used as a shortcut.", vars: { key: accelerator } };
  if (SNAPSHOT) return { ok: true, hotkey: accelerator }; // never register real keys from a test copy
  if (!(keyHelper && keyHelperReady)) {
    // Fallback path: globalShortcut can tell when another program holds the key.
    globalShortcut.unregisterAll();
    let ok = false;
    try { ok = globalShortcut.register(accelerator, toggle); } catch { ok = false; }
    globalShortcut.unregisterAll();
    if (!ok) {
      registerHotkey(); // put the old one back
      return { ok: false, error: '{key} is not available — another program may already use it. Try another.', vars: { key: accelerator } };
    }
  }
  config.hotkey = accelerator;
  saveConfig();
  recordingHotkey = false;
  if (keyHelper && keyHelperReady) keyHelper.stdin.write('resume\n');
  registerHotkey();
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
  tray.setToolTip(T('Star Companion — press {key} to open', { key: config.hotkey }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: T('Show / hide ({key})', { key: config.hotkey }), click: toggle },
      { label: T('Settings…'), click: openSettings },
      { type: 'separator' },
      updateStatus
        ? { label: updateStatus, enabled: false }
        : { label: T('Check for updates (v{version})', { version: app.getVersion() }), click: () => checkForUpdates(true) },
      { label: updating ? T('Updating database…') : T('Update database'), enabled: !updating, click: updateData },
      { type: 'separator' },
      { label: T('Send a suggestion…'), click: openFeedback },
      { label: T('Buy me a coffee…'), click: () => shell.openExternal(COFFEE_URL) },
      { type: 'separator' },
      { label: T('Quit'), click: () => app.quit() },
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
  win.setOpacity(opacityFor(config.transparency));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(config.zoom));
  win.on('focus', () => { if (state === 'open') focusGained = true; });
  // The first moments after opening are ignored: while focus is being handed over from the game,
  // Windows can send a blur that would fold the bar straight back.
  win.on('blur', () => {
    if (state !== 'open' || !config.hideOnBlur || win.webContents.isDevToolsOpened()) return;
    if (Date.now() - openedAt < BLUR_GRACE_MS) return keysLog('blur ignored (just opened)');
    close();
  });
  win.on('moved', () => {
    if (state === 'open' && !widening) {
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
      else if (step === '@settings') openSettings();
      else if (step === '@scroll-end') await win.webContents.executeJavaScript('scrollEl.scrollTop = 1e6');
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
ipcMain.handle('app:config', () => ({ language: i18n.getLanguage(), hotkey: config.hotkey, maxHeight: maxHeight(), zoom: config.zoom, dockOpacity: config.dockOpacity, liveGameVersion }));
ipcMain.on('overlay:hide', () => close());
ipcMain.on('overlay:closed', () => finishClose());
ipcMain.on('overlay:geometry', (_e, g) => {
  if (g && [g.inset, g.barTop, g.barHeight].every(Number.isFinite)) geo = g;
});
ipcMain.on('overlay:fit', (_e, height, beyondMax) => fitHeight(Number(height), !!beyondMax));
ipcMain.on('overlay:fit-width', (_e, width) => fitWidth(Number(width)));
ipcMain.handle('settings:get', async () => { await refreshKeyStats(); return settingsSnapshot(); });
ipcMain.handle('settings:set', (_e, key, value) => applySetting(String(key), value));
ipcMain.handle('settings:action', (_e, action) => settingsAction(String(action)));
ipcMain.on('overlay:grip', (_e, phase) => (phase === 'start' ? startGrip() : endGrip()));
ipcMain.on('overlay:zoom', (_e, direction) => stepZoom(Math.sign(Number(direction))));
ipcMain.on('dock:pointer', (_e, phase) => dockPointer(phase));
ipcMain.on('notice:done', (_e, dontShowAgain) => noticeDone(!!dontShowAgain));
ipcMain.on('hotkey:recording', (_e, active) => setHotkeyRecording(active));
ipcMain.handle('hotkey:set', (_e, accelerator) => setHotkey(accelerator));
ipcMain.handle('feedback:send', (_e, f) => (SNAPSHOT ? { ok: true } : sendFeedback(f))); // a test copy never mails
ipcMain.on('link:open', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// Test runs (snapshots, update checks) skip the single-instance lock: otherwise, with the player's
// copy open, they would quit at once and hand it a "second instance" that opens its overlay.
if (!SNAPSHOT && !UPDATE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', open);
  app.whenReady().then(() => {
    config = loadConfig();
    if (process.env.SC_LANG) config.language = process.env.SC_LANG; // dev aid for snapshots
    applyLanguage();
    setupUpdater();
    if (UPDATE_TEST) return checkForUpdates(false);
    createWindow();
    registerHotkey(); // globalShortcut until the key helper reports READY
    startKeyHelper();
    buildTray();
    if (SNAPSHOT) snapshotMode(process.env.SC_SNAPSHOT);
    // The notice first if it is due, else the icon (or the bar once, so the player knows the app runs).
    else win.webContents.once('did-finish-load', startup);
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopKeyHelper();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}
