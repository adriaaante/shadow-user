'use strict';
/**
 * preload.js — safe bridge between the renderer (UI) and the main process.
 * The renderer has no Node access; it can only call this whitelisted API.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('driftly', {
  getInitial: () => ipcRenderer.invoke('app:getInitial'),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  setRunMode: (mode) => ipcRenderer.invoke('run:setMode', mode),

  metricsSeries: (minutes) => ipcRenderer.invoke('metrics:series', minutes),
  metricsSummary: () => ipcRenderer.invoke('metrics:summary'),
  metricsLive: () => ipcRenderer.invoke('metrics:live'),
  metricsReset: () => ipcRenderer.invoke('metrics:reset'),
  metricsExport: (format) => ipcRenderer.invoke('metrics:export', format),

  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),

  // subscription / licensing
  licenseGet: () => ipcRenderer.invoke('license:get'),
  licenseSetApi: (url) => ipcRenderer.invoke('license:setApi', url),
  licenseSignIn: (email) => ipcRenderer.invoke('license:signIn', email),
  licenseStartTrial: (card) => ipcRenderer.invoke('license:startTrial', card),
  licenseRetry: () => ipcRenderer.invoke('license:retry'),
  licenseCancel: () => ipcRenderer.invoke('license:cancel'),
  licenseSignOut: () => ipcRenderer.invoke('license:signOut'),
  licenseRefresh: () => ipcRenderer.invoke('license:refresh'),

  onTick: (cb) => ipcRenderer.on('tick', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (_e, data) => cb(data)),
});
