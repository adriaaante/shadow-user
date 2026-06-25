'use strict';
/**
 * index.js — Driftly main process.
 * Wires the engine together: monitor → metrics, scheduler + run mode → generator,
 * store ⇄ config, and exposes a small IPC surface to the renderer (see preload).
 */

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell,
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
  const mode = store.getConfig().runMode;
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return scheduler.active; // 'schedule'
}

function reconcile() {
  const want = desiredGeneratorOn();
  if (want && !generator.running) generator.start();
  if (!want && generator.running) generator.stop();
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
    genStats: generator.stats,
  };
}

/* ------------------------------- IPC surface -------------------------------- */
function registerIpc() {
  ipcMain.handle('app:getInitial', () => ({
    config: store.getConfig(),
    status: status(),
    paths: store.paths(),
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
    const data = ext === 'csv' ? metrics.exportCSV() : metrics.exportJSON();
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
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

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
