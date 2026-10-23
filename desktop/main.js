// Cloud's CAD desktop shell (GPL v3). Loads the same offline app; nothing is sent over the network.
// Extra over the browser version: saves (.tap, .dxf, ...) go straight into a save folder you choose.
const { app, BrowserWindow, Menu, shell, session, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const saveCfg = (c) => { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch {} };
let cfg = {};
const usable = (d) => { try { return !!d && fs.statSync(d).isDirectory(); } catch { return false; } };

function uniquePath(dir, name) {
  name = path.basename(name) || 'download';
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), n = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++})${ext}`);   // never overwrite a file
  return p;
}


// ---- 3D printer support: USB serial permission and LAN-only web calls (so a printer page does not need CORS)
const isLan = (h) => {
  h = String(h).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || /^fe80:/.test(h) || /\.local$/.test(h) || /\.lan$/.test(h) || !h.includes('.') && !h.includes(':')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
};
ipcMain.handle('printer-http', async (_e, req) => {
  try {
    const u = new URL(req.url);
    if (!/^https?:$/.test(u.protocol)) return { status: 0, text: 'Only http or https addresses are allowed.' };
    if (!isLan(u.hostname)) return { status: 0, text: 'Only printers on your own network can be reached from here.' };
    const headers = { ...(req.headers || {}) };
    let body;
    if (req.json !== undefined) { body = JSON.stringify(req.json); headers['Content-Type'] = 'application/json'; }
    if (req.form) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(req.form.fields || {})) fd.append(k, String(v));
      if (req.form.file) fd.append(req.form.file.field || 'file', new Blob([String(req.form.file.text)], { type: 'text/plain' }), String(req.form.file.name));
      body = fd;
    }
    const res = await session.fromPartition('printer').fetch(req.url, { method: req.method || 'GET', headers, body });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: e.message || String(e) }; }
});


// ---- Optional: run an installed PrusaSlicer (or SuperSlicer) for slicing. We never bundle or download it.
const { spawn } = require('child_process');
const os = require('os');
function findSlicer() {
  if (cfg.slicerPath && fs.existsSync(cfg.slicerPath)) return cfg.slicerPath;
  const c = [];
  const dirs = (base, re) => { try { return fs.readdirSync(base).filter((n) => re.test(n)).map((n) => path.join(base, n)); } catch { return []; } };
  if (process.platform === 'win32') {
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      for (const d of [...dirs(path.join(pf, 'Prusa3D'), /PrusaSlicer/i), ...dirs(pf, /^(PrusaSlicer|SuperSlicer)/i)]) {
        c.push(path.join(d, 'prusa-slicer-console.exe'), path.join(d, 'prusa-slicer.exe'), path.join(d, 'superslicer_console.exe'), path.join(d, 'superslicer.exe'));
      }
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer', '/Applications/SuperSlicer.app/Contents/MacOS/SuperSlicer', path.join(os.homedir(), 'Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'));
  } else {
    for (const d of (process.env.PATH || '').split(':').concat(['/usr/bin', '/usr/local/bin', '/opt'])) c.push(path.join(d, 'prusa-slicer'), path.join(d, 'superslicer'));
  }
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}
ipcMain.handle('slicer-info', () => ({ path: findSlicer() }));
ipcMain.handle('slicer-choose', async () => {
  const r = await dialog.showOpenDialog({ title: 'Find PrusaSlicer (prusa-slicer-console.exe on Windows)', properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { path: findSlicer() };
  cfg.slicerPath = r.filePaths[0]; saveCfg(cfg); return { path: cfg.slicerPath };
});
let slicerProc = null;
ipcMain.handle('slicer-cancel', () => { if (slicerProc) { slicerProc.kill(); slicerProc = null; } return true; });
ipcMain.handle('slicer-run', async (_e, stl, ini, timeoutMs) => {
  const exe = findSlicer();
  if (!exe) return { ok: false, log: 'PrusaSlicer was not found.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudscad-'));
  const f = { stl: path.join(dir, 'model.stl'), ini: path.join(dir, 'config.ini'), out: path.join(dir, 'out.gcode') };
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  try {
    fs.writeFileSync(f.stl, Buffer.from(stl)); fs.writeFileSync(f.ini, String(ini));
    return await new Promise((resolve) => {
      let log = '', done = false;
      const p = spawn(exe, ['--export-gcode', '--load', f.ini, '--output', f.out, f.stl], { windowsHide: true });
      slicerProc = p;
      const finish = (r) => { if (done) return; done = true; clearTimeout(t); slicerProc = null; resolve(r); };
      const t = setTimeout(() => { p.kill(); finish({ ok: false, log: 'The slicer took too long and was stopped.' }); }, Math.max(10000, +timeoutMs || 600000));
      p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
      p.on('error', (e) => finish({ ok: false, log: e.message }));
      p.on('close', () => { let gcode = null; try { gcode = fs.readFileSync(f.out, 'utf8'); } catch {} finish({ ok: !!gcode, gcode, log: log.slice(-2000) }); });
    });
  } catch (e) { return { ok: false, log: e.message || String(e) }; } finally { cleanup(); }
});


// ---- Built-in slicer: CuraEngine compiled to WebAssembly (AGPL-3.0), runs inside this app in its own process so Cancel really stops it.
const { utilityProcess } = require('electron');
let curaProc = null;
ipcMain.handle('cura-run', (e, stl, settings) => new Promise((resolve) => {
  if (curaProc) { resolve({ ok: false, log: 'The slicer is already working.' }); return; }
  let done = false;
  const p = utilityProcess.fork(path.join(__dirname, 'cura-worker.js'), [], { serviceName: 'Cloud CAD slicer' });
  curaProc = p;
  const finish = (r) => { if (done) return; done = true; clearTimeout(t); curaProc = null; try { p.kill(); } catch {} resolve(r); };
  const t = setTimeout(() => finish({ ok: false, log: 'The slicer took too long and was stopped.' }), 20 * 60 * 1000);
  p.on('message', (m) => { if (m.progress !== undefined) { try { e.sender.send('cura-progress', m.progress); } catch {} } else finish(m); });
  p.on('exit', () => finish({ ok: false, log: 'The slicer stopped.' }));
  p.postMessage({ stl: Buffer.from(stl), settings });
}));
ipcMain.handle('cura-cancel', () => { const p = curaProc; if (p) { curaProc = null; try { p.kill(); } catch {} } return true; });

if (!app.requestSingleInstanceLock()) { app.quit(); } else app.whenReady().then(() => {
  cfg = loadCfg();
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((d) => d.deviceType === 'serial');
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    if (!portList.length) { dialog.showMessageBox({ type: 'info', message: 'No USB printer found.', detail: 'Plug the printer in with its USB cable, turn it on, and try again.' }); callback(''); return; }
    const name = (p) => `${p.displayName || p.portName || 'USB device'}${p.portName ? ' (' + p.portName + ')' : ''}`;
    if (portList.length === 1) { callback(portList[0].portId); return; }
    const shown = portList.slice(0, 8);
    dialog.showMessageBox({ type: 'question', message: 'Which port is the printer?', buttons: shown.map(name).concat(['Cancel']), cancelId: shown.length })
      .then((r) => callback(r.response < shown.length ? shown[r.response].portId : ''));
  });
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|devtools|data|blob):/.test(d.url) }));
  const wb = cfg.win && cfg.win.w >= 600 && cfg.win.h >= 400 ? cfg.win : {};
  const win = new BrowserWindow({ width: wb.w || 1400, height: wb.h || 900, x: Number.isFinite(wb.x) ? wb.x : undefined, y: Number.isFinite(wb.y) ? wb.y : undefined, backgroundColor: '#14110d', title: "Cloud's CAD", icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') } });

  if (wb.max) win.maximize();
  let wt = null;
  const keepBounds = () => { clearTimeout(wt); wt = setTimeout(() => { if (win.isDestroyed() || win.isMinimized()) return; const max = win.isMaximized(); const b = max ? (cfg.win || {}) : win.getBounds(); cfg.win = { x: b.x, y: b.y, w: b.width ?? b.w, h: b.height ?? b.h, max }; saveCfg(cfg); }, 500); };
  win.on('resize', keepBounds); win.on('move', keepBounds); win.on('close', () => { clearTimeout(wt); if (!win.isMinimized()) { const max = win.isMaximized(); const b = max ? (cfg.win || {}) : win.getBounds(); cfg.win = { x: b.x, y: b.y, w: b.width ?? b.w, h: b.height ?? b.h, max }; saveCfg(cfg); } });
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });

  ipcMain.handle('save-file', async (_e, name, bytes) => {
    if (!usable(cfg.saveDir)) return false;      // no folder chosen: the app falls back to the normal Save prompt
    const p = uniquePath(cfg.saveDir, name);     // never overwrites an existing file
    fs.writeFileSync(p, Buffer.from(bytes));
    win.setTitle(`Cloud's CAD - saved ${path.basename(p)}`);
    dialog.showMessageBox(win, { type: 'info', title: 'Saved', message: `Saved ${path.basename(p)}`, detail: `Folder: ${cfg.saveDir}`, buttons: ['OK', 'Show in folder'], defaultId: 0 })
      .then((r) => { if (r.response === 1) shell.showItemInFolder(p); });
    return true;
  });

  // ---- machine folder: the machine's DNC program watches one folder (for example C:\CODE); drop the .tap there and it shows on the pendant
  const machineDir = () => (usable(cfg.machineDir) ? cfg.machineDir : (process.platform === 'win32' && usable('C:\\CODE') ? 'C:\\CODE' : null));
  const machineInfo = () => {
    const dir = machineDir(); let files = [];
    if (dir) { try { files = fs.readdirSync(dir).filter((f) => /\.(tap|nc|gcode)$/i.test(f)).map((f) => { const s = fs.statSync(path.join(dir, f)); return { name: f, size: s.size, mtime: s.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime); } catch {} }
    return { dir, files };
  };
  ipcMain.handle('machine-info', () => machineInfo());
  ipcMain.handle('machine-choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick the folder your machine reads (the one the DNC program watches)', properties: ['openDirectory'], defaultPath: machineDir() || app.getPath('documents') });
    if (!r.canceled && r.filePaths[0]) { cfg.machineDir = r.filePaths[0]; saveCfg(cfg); }
    return machineInfo();
  });
  ipcMain.handle('machine-send', (_e, name, text, mode) => {
    const dir = machineDir(); if (!dir) return { error: 'No machine folder chosen yet.' };
    let base = String(name || 'part').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/\.(tap|nc|gcode)$/i, '').trim() || 'part';
    let p = path.join(dir, base + '.tap');
    if (fs.existsSync(p)) { if (!mode) return { exists: true, name: base + '.tap' }; if (mode === 'new') { let n = 2; while (fs.existsSync(path.join(dir, `${base} ${n}.tap`))) n++; p = path.join(dir, `${base} ${n}.tap`); } }
    try { fs.writeFileSync(p, String(text)); } catch (e) { return { error: 'Could not write there: ' + e.message }; }
    return { ok: true, name: path.basename(p), dir };
  });
  ipcMain.handle('machine-open', () => { const d = machineDir(); if (d) shell.openPath(d); return !!d; });

  const chooseFolder = async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should saved files go?', properties: ['openDirectory', 'createDirectory'], defaultPath: cfg.saveDir || app.getPath('documents') });
    if (!r.canceled && r.filePaths[0]) { cfg.saveDir = r.filePaths[0]; saveCfg(cfg); buildMenu(); }
  };
  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Choose save folder...', accelerator: 'CmdOrCtrl+Shift+S', click: chooseFolder },
        { label: usable(cfg.saveDir) ? `Open save folder (${path.basename(cfg.saveDir)})` : 'Open save folder', enabled: usable(cfg.saveDir), click: () => shell.openPath(cfg.saveDir) },
        { label: 'Ask every time (turn off save folder)', enabled: !!cfg.saveDir, click: () => { delete cfg.saveDir; saveCfg(cfg); buildMenu(); } },
        { type: 'separator' }, { role: 'quit' } ] },
      { label: 'Help', submenu: [
        { label: "About Cloud's CAD", click: () => dialog.showMessageBox(win, { type: 'info', title: 'About', message: "Cloud's CAD " + app.getVersion(), detail: "Free, open-source CAD/CAM for hot-wire foam, CNC and 3D printing.\nLicense: GNU GPL v3.\n\nBuilt on: Electron (MIT), Three.js (MIT), clipper-lib (Boost), dxf-parser (MIT), CuraEngine via cura-wasm (AGPL-3.0).\nNothing is uploaded; the app works offline." }) },
        { label: 'Open the save folder settings', click: chooseFolder } ] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' }] },
    ]));
  }
  buildMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'app.html'));
  win.webContents.once('did-finish-load', () => {
    if (!usable(cfg.saveDir) && !cfg.asked) {
      cfg.asked = true; saveCfg(cfg);
      dialog.showMessageBox(win, { type: 'question', title: 'Save folder', message: 'Pick a folder for your saved files?', detail: 'Your .tap and .dxf files will go straight there, with no Save dialog. You can change this later under File.', buttons: ['Choose folder...', 'Not now'], defaultId: 0 })
        .then((r) => { if (r.response === 0) chooseFolder(); });
    }
  });
});
app.on('window-all-closed', () => app.quit());
