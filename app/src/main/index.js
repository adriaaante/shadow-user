'use strict';
/**
 * index.js — Driftly main process.
 * Wires the engine together: monitor → metrics, scheduler + run mode → generator,
 * store ⇄ config, and exposes a small IPC surface to the renderer (see preload).
 */

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, powerSaveBlocker,
} = require('electron');

const store = require('./store');
const metrics = require('./metrics');
const monitor = require('./monitor');
const generator = require('./generator');
const scheduler = require('./scheduler');
const backend = require('./input-backend');

let win = null;
let tray = null;
let saveTimer = null;
let tickTimer = null;
app.isQuiting = false;

/* --------------------------- engine reconciliation --------------------------- */
function desiredGeneratorOn() {
  // Driftly is free — the generator runs purely by the chosen run mode.
  const mode = store.getConfig().runMode;
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return scheduler.active; // 'schedule'
}

// OS-level screen keep-awake. Unlike the browser's Wake Lock, this holds even
// when the window is minimized or in the background, so while the generator runs
// the display never sleeps — the guarantee the web version can't make.
// We hold BOTH a display-sleep and an app-suspension blocker, and RE-ASSERT them on a
// timer (see the keep-awake interval in bootstrap). Re-asserting matters because on some
// Windows power plans / GPU drivers the execution state can be dropped after a while or
// when the window is minimized/unfocused — a single start-once call then silently lapses
// and the screen sleeps even though the cursor is moving (synthetic mouse motion does not
// reliably reset the OS idle timer). Re-grabbing it guarantees the display stays on for as
// long as Driftly is generating, regardless of focus or minimize state.
let psbDisplay = null;
let psbSuspend = null;
function keepAwakeHeld() {
  try { return psbDisplay !== null && powerSaveBlocker.isStarted(psbDisplay); } catch (_) { return false; }
}
function syncPowerBlocker(on) {
  try {
    if (on) {
      if (psbDisplay === null || !powerSaveBlocker.isStarted(psbDisplay)) psbDisplay = powerSaveBlocker.start('prevent-display-sleep');
      if (psbSuspend === null || !powerSaveBlocker.isStarted(psbSuspend)) psbSuspend = powerSaveBlocker.start('prevent-app-suspension');
    } else {
      if (psbDisplay !== null && powerSaveBlocker.isStarted(psbDisplay)) powerSaveBlocker.stop(psbDisplay);
      if (psbSuspend !== null && powerSaveBlocker.isStarted(psbSuspend)) powerSaveBlocker.stop(psbSuspend);
      psbDisplay = null; psbSuspend = null;
    }
  } catch (e) { console.error('[keepawake]', e && e.message); }
}

function reconcile() {
  const want = desiredGeneratorOn();
  if (want && !generator.running) generator.start();
  if (!want && generator.running) generator.stop();
  syncPowerBlocker(want);
  metrics.setGeneratorEnabled(want);
  updateTray();
  pushStatus();
}

function applyConfig() {
  const c = store.getConfig();
  generator.configure(c.generator);
  scheduler.configure(c.schedule);
  if (app.isReady() && typeof app.setLoginItemSettings === 'function') {
    try { app.setLoginItemSettings({ openAtLogin: !!c.prefs.launchAtLogin }); } catch (_) { /* noop */ }
  }
  reconcile();
}

function status() {
  const c = store.getConfig();
  return {
    runMode: c.runMode,
    generatorOn: generator.running,
    scheduleActive: scheduler.active,
    minutesUntilScheduleChange: scheduler.minutesUntilChange(),
    backendMode: backend.mode,         // 'real' | 'simulation'
    monitorMode: monitor.mode,         // 'global' | 'self-report'
    keepAwake: keepAwakeHeld(),        // display kept awake right now?
    genStats: generator.stats,
  };
}

/* ------------------------------- IPC surface -------------------------------- */
function registerIpc() {
  ipcMain.handle('app:getInitial', () => ({
    config: store.getConfig(),
    status: status(),
    paths: store.paths(),
    version: app.getVersion(),
  }));

  ipcMain.handle('config:patch', (_e, patch) => {
    store.patchConfig(patch || {});
    applyConfig();
    return { config: store.getConfig(), status: status() };
  });

  ipcMain.handle('run:setMode', (_e, mode) => {
    if (['schedule', 'always', 'off'].includes(mode)) {
      store.patchConfig({ runMode: mode });
      reconcile();
    }
    return { config: store.getConfig(), status: status() };
  });

  ipcMain.handle('metrics:series', (_e, minutes) => metrics.series(minutes || 60));
  ipcMain.handle('metrics:summary', () => metrics.summary());
  ipcMain.handle('metrics:live', () => metrics.live());

  ipcMain.handle('metrics:reset', () => { metrics.reset(); persistMetrics(); return true; });

  ipcMain.handle('metrics:export', async (_e, format) => {
    const ext = format === 'csv' ? 'csv' : 'json';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Driftly metrics',
      defaultPath: `driftly-metrics.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false };
    // UTF-8 BOM for CSV so Excel renders Cyrillic + honors the sep= hint.
    const data = ext === 'csv' ? '\uFEFF' + metrics.exportCSV() : metrics.exportJSON();
    try { fs.writeFileSync(filePath, data); return { ok: true, filePath }; } catch (e) { return { ok: false, error: String(e) }; }
  });

  ipcMain.handle('app:openDataFolder', () => shell.openPath(store.paths().dir));
}

/* --------------------------------- window ---------------------------------- */
function iconPath(name) {
  const p = path.join(__dirname, '..', '..', 'build', name);
  return fs.existsSync(p) ? p : null;
}

function createWindow() {
  const icon = iconPath('icon.png');
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#08080c',
    title: 'Driftly',
    icon: icon || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // don't throttle when minimized/hidden — keep timers live
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Open external links (e.g. the legal pages) in the default browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });

  win.on('close', (e) => {
    if (!app.isQuiting && store.getConfig().prefs.minimizeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
}

/* ---------------------------------- tray ----------------------------------- */
function updateTray() {
  if (!tray) return;
  const s = status();
  const onLabel = s.generatorOn ? 'Driftly: активна' : 'Driftly: пауза';
  const menu = Menu.buildFromTemplate([
    { label: onLabel, enabled: false },
    { type: 'separator' },
    { label: 'По расписанию', type: 'radio', checked: s.runMode === 'schedule', click: () => setMode('schedule') },
    { label: 'Всегда включена', type: 'radio', checked: s.runMode === 'always', click: () => setMode('always') },
    { label: 'Выключена', type: 'radio', checked: s.runMode === 'off', click: () => setMode('off') },
    { type: 'separator' },
    { label: 'Открыть Driftly', click: () => showWindow() },
    { label: 'Выход', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip(onLabel);
  tray.setContextMenu(menu);
}

function setMode(mode) {
  store.patchConfig({ runMode: mode });
  reconcile();
  if (win) win.webContents.send('config:changed', { config: store.getConfig(), status: status() });
}

function createTray() {
  const p = iconPath('tray.png') || iconPath('icon.png');
  if (!p) return;
  try {
    const img = nativeImage.createFromPath(p);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.on('click', () => showWindow());
    updateTray();
  } catch (_) { tray = null; }
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

/* ------------------------------- persistence ------------------------------- */
function persistMetrics() { store.saveMetrics(metrics.dump()); }

function pushStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('status', status());
}

/* --------------------------------- bootstrap -------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    store.init(app.getPath('userData'));
    metrics.load(store.loadMetrics());

    monitor.onActivity((ev) => metrics.record(ev));
    monitor.start();

    scheduler.start(() => reconcile());
    applyConfig();

    registerIpc();
    createWindow();
    createTray();

    tickTimer = setInterval(() => {
      if (win && !win.isDestroyed()) win.webContents.send('tick', { live: metrics.live(), status: status() });
    }, 1000);
    saveTimer = setInterval(persistMetrics, 30000);

    // Keep-awake watchdog: re-assert the display blocker every 20 s so a dropped execution
    // state (some Windows power plans do this, especially while minimized) can never leave
    // the screen free to sleep while the generator is running.
    setInterval(() => { try { syncPowerBlocker(desiredGeneratorOn()); } catch (_) { /* noop */ } }, 20000);

    // Keep-awake input nudge (real backend only): the display blocker stops the monitor
    // powering off, but NOT the screensaver, and a synthetic cursor move may not reset the
    // OS idle timer. An invisible F15 key tap — the classic harmless anti-idle key — resets
    // BOTH idle timers via SendInput. Only fires after ~25 s of genuine idle (skips it while
    // the real user is active) and is bracketed so it's tagged synthetic, not real input.
    setInterval(async () => {
      if (!desiredGeneratorOn() || backend.mode !== 'real') return;
      if (monitor.msSinceRealActivity() < 25000) return;
      try { monitor.beginInject(); await backend.tapKey('f15'); } catch (_) { /* noop */ } finally { monitor.endInject(); }
    }, 25000);

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray on win/linux; only fully quit when asked.
    if (process.platform !== 'darwin' && !store.getConfig().prefs.minimizeToTray) app.quit();
  });

  app.on('before-quit', () => {
    app.isQuiting = true;
    if (tickTimer) clearInterval(tickTimer);
    if (saveTimer) clearInterval(saveTimer);
    try { generator.stop(); monitor.stop(); scheduler.stop(); } catch (_) { /* noop */ }
    persistMetrics();
  });
}
