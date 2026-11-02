'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { parseMvrBuffer } = require('./lib/mvr');
const { parseGdtfBuffer } = require('./lib/gdtf');
const { SacnReceiver } = require('./lib/sacn');
const { demoRig, demoFrame } = require('./lib/demo');

let win = null;
const sacn = new SacnReceiver();
let demoTimer = null;
let demoStart = 0;
let currentRig = null;

// DMX fan-out: coalesce updates to ~44 fps per universe
const pending = new Map();
let flushTimer = null;
function queueDmx(universe, data) {
  pending.set(universe, Buffer.from(data));
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!win || win.isDestroyed()) return;
      const frames = [];
      for (const [u, d] of pending) frames.push({ universe: u, data: d });
      pending.clear();
      win.webContents.send('dmx', frames);
    }, 23);
  }
}

sacn.on('dmx', ({ universe, data }) => {
  if (demoTimer) return; // demo mode owns the output
  queueDmx(universe, data);
});
sacn.on('error', (err) => win && !win.isDestroyed() && win.webContents.send('log', `sACN: ${err.message}`));
sacn.on('listening', (info) => win && !win.isDestroyed() && win.webContents.send('log', `sACN listening on UDP ${info.port}`));
sacn.on('source', (s) => win && !win.isDestroyed() && win.webContents.send('log', `sACN source "${s.name}" on universe ${s.universe} (priority ${s.priority})`));

function universesInRig(rig) {
  const set = new Set();
  for (const f of rig.scene.fixtures) if (f.universe) set.add(f.universe);
  if (!set.size) set.add(1);
  return [...set].sort((a, b) => a - b);
}

function setRig(rig) {
  currentRig = rig;
  for (const u of [...sacn.universes.keys()]) sacn.unlisten(u);
  for (const u of universesInRig(rig)) sacn.listen(u);
  if (win && !win.isDestroyed()) win.webContents.send('rig', rig);
}

function setDemoDmx(on) {
  if (on && !demoTimer) {
    demoStart = Date.now();
    demoTimer = setInterval(() => queueDmx(1, demoFrame((Date.now() - demoStart) / 1000)), 25);
  } else if (!on && demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  return !!demoTimer;
}

async function openMvr(filePath) {
  const buf = await fs.readFile(filePath);
  const rig = await parseMvrBuffer(buf);
  rig.name = path.basename(filePath);
  setRig(rig);
  return { ok: true, fixtures: rig.scene.fixtures.length, missing: rig.missing };
}

async function openGdtf(filePath) {
  const buf = await fs.readFile(filePath);
  const profile = await parseGdtfBuffer(buf);
  profile.spec = path.basename(filePath);
  if (!currentRig) setRig({ scene: { fixtures: [], trusses: [], sceneObjects: [], layers: [], focusPoints: [] }, profiles: {}, missing: [], name: 'Manual rig' });
  currentRig.profiles[profile.spec] = profile;
  if (win && !win.isDestroyed()) win.webContents.send('profile', profile);
  return { ok: true, name: profile.name, modes: profile.modes.map((m) => m.name) };
}

ipcMain.handle('open-mvr-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open MVR', filters: [{ name: 'MVR', extensions: ['mvr'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    return await openMvr(r.filePaths[0]);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('open-gdtf-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Load GDTF', filters: [{ name: 'GDTF', extensions: ['gdtf'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    return await openGdtf(r.filePaths[0]);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('open-path', async (_e, p) => {
  try {
    return /\.gdtf$/i.test(p) ? await openGdtf(p) : await openMvr(p);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('load-demo', () => {
  setRig(demoRig());
  return { ok: true };
});
ipcMain.handle('demo-dmx', (_e, on) => setDemoDmx(on));
ipcMain.handle('sacn-status', () => ({ ...sacn.status(), demo: !!demoTimer }));
ipcMain.handle('sacn-listen', (_e, universe) => {
  sacn.listen(universe);
  return sacn.status();
});
ipcMain.handle('add-fixture', (_e, fx) => {
  // Manual patch: used when a GDTF is loaded without an MVR
  if (!currentRig) return { ok: false, error: 'No rig' };
  currentRig.scene.fixtures.push(fx);
  setRig(currentRig);
  return { ok: true };
});
ipcMain.handle('get-rig', () => currentRig);

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'LightBox Previs',
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    if (currentRig) win.webContents.send('rig', currentRig);
  });

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open MVR…', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu', 'open-mvr') },
        { label: 'Load GDTF…', accelerator: 'CmdOrCtrl+G', click: () => win.webContents.send('menu', 'open-gdtf') },
        { type: 'separator' },
        { label: 'Load demo rig', accelerator: 'CmdOrCtrl+D', click: () => win.webContents.send('menu', 'demo-rig') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  sacn.start();
  sacn.listen(1);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  sacn.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('open-file', (e, p) => {
  e.preventDefault();
  app.whenReady().then(() => (/\.gdtf$/i.test(p) ? openGdtf(p) : openMvr(p)).catch(() => {}));
});
