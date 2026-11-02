'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('previs', {
  pathForFile: (f) => {
    try {
      return webUtils.getPathForFile(f);
    } catch (_) {
      return f.path || null;
    }
  },
  openMvrDialog: () => ipcRenderer.invoke('open-mvr-dialog'),
  openGdtfDialog: () => ipcRenderer.invoke('open-gdtf-dialog'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  loadDemo: () => ipcRenderer.invoke('load-demo'),
  setDemoDmx: (on) => ipcRenderer.invoke('demo-dmx', on),
  sacnStatus: () => ipcRenderer.invoke('sacn-status'),
  sacnListen: (u) => ipcRenderer.invoke('sacn-listen', u),
  addFixture: (fx) => ipcRenderer.invoke('add-fixture', fx),
  getRig: () => ipcRenderer.invoke('get-rig'),
  onDmx: (cb) => ipcRenderer.on('dmx', (_e, frames) => cb(frames)),
  onRig: (cb) => ipcRenderer.on('rig', (_e, rig) => cb(rig)),
  onProfile: (cb) => ipcRenderer.on('profile', (_e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (_e, msg) => cb(msg)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
});
