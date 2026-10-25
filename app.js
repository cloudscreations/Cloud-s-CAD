// Cloud's CAD - browser UI. License: GPL v3
import { fmtLen } from './fmtlen.js';
import { dwgToDxfText } from './dwg.js';
import { initSim } from './simulate.js';
import { readDxf, chain, rev, simplifySplines, convertSegments, parseTap, tapToDxf, flatten, DEFAULT_POST, TO_IN } from './core.js';
import * as S from './sketch.js';
import { ask } from './ask.js';
import * as T from './trace.js';
import * as M from './mesh.js';
import { createDrawView } from './ui-draw.js';
import { initHelp } from './help.js';
import { buildSheet } from './sheet.js';
import { applyStart } from './startpoint.js';
import { initPrint } from './print-ui.js';
import { store } from './store.js';
import { initLibrary } from './library.js';
import { initMachineLink } from './machine-link.js';
import { initMachineSettings } from './machine-settings.js';
import * as SH from './shapetools.js';
import * as NEST from './nest.js';
import { initWorkspaces } from './workspaces.js';
import { initSolids } from './solids-ui.js';
import { initSheet } from './sheet-ui.js';
import { initCmdSearch } from './cmdsearch.js';
import { initPhysics } from './physics-ui.js';

const $ = (id) => document.getElementById(id);
const state = {
  tab: 'draw', units: 'in', doc: new S.Sketch(), sel: new Set(), grid: 0.01,
  snaps: { end: true, mid: true, center: true, inter: true, grid: false, ortho: false, showGrid: true, showOpen: true, showDims: false },
  opts: { offsetD: 0.25, filletR: 0.25, chamferD: 0.25, copy: false, keep: true, sides: 6, points: 5, ratio: 0.4, bisLen: 1, divN: 2, circR: 1 },
  report: null, name: 'drawing', model: null, rawModel: null, result: null,
  slots: { front: { src: 'none' }, side: { src: 'none' }, top: { src: 'none' } },
};
let sheetUI = null, physUI = null, solidsUI = null, solidFlag = false;
let draw = null, viewer = null, printUI = null, library = null, workspaces = null;
const fmt = (v, d = 4) => { const s = (+v).toFixed(d); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };

function download(name, data, type = 'application/octet-stream') {
  // Desktop app: save straight into the folder the user picked (File > Choose save folder). Falls back to a normal download.
  if (window.cloudDesktop && window.cloudDesktop.save) {
    new Blob([data], { type }).arrayBuffer().then((buf) => window.cloudDesktop.save(name, new Uint8Array(buf))).then((ok) => { if (!ok) browserDownload(name, data, type); }, () => browserDownload(name, data, type));
    return;
  }
  browserDownload(name, data, type);
}
function browserDownload(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- tabs
const TAB_HINTS = { draw: 'Draw a profile or open a DWG/DXF file, then check it is one closed outline.', d3: 'Look at the 3D model: turn it, slice it, or take a profile from it.', sheet: 'Bend a flat sheet: draw the side view, get the flat pattern to cut.', phys: 'Drop it, slide it, tilt the floor: see if a part tips or slides.', model: 'Build a 3D shape from your 2D profile (extrude, revolve, sweep).', machine: 'Turn the drawing into G-code (.tap), preview the cut, and send it to the machine.', print: 'Slice a 3D model for a 3D printer and send it to the printer.', library: 'Save profiles you use again, and insert them into a drawing.' };
function setTab(t) {
  state.tab = t; syncEmpty();
  const th = $('tabHint'); if (th) th.textContent = TAB_HINTS[t] || '';
  document.body.dataset.tab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'draw') { viewer && viewer.stop(); draw.render(); }
  if (t === 'd3') { ensureViewer(); if (viewer) { viewer.start(); viewer.resize(); } refreshSlots(); updateModelInfo(); }
  if (t === 'machine') { viewer && viewer.stop(); updateMachine(); }
  if (t === 'print') { viewer && viewer.stop(); printUI && printUI.refresh(); }
  if (t === 'model') { viewer && viewer.stop(); ensureModeler(); }
  if (t === 'sheet' && sheetUI) { viewer && viewer.stop(); sheetUI.enter(); } else if (sheetUI) sheetUI.leave();
  if (t === 'phys' && physUI) { viewer && viewer.stop(); physUI.enter(); } else if (physUI) physUI.leave();
  if (t !== 'model' && modeler) modeler.stop();
  if (t === 'library') { viewer && viewer.stop(); library && library.refresh(); }
}
let modeler = null, modelerFailed = false;
async function ensureModeler() {
  if (modelerFailed) return;
  if (!modeler) {
    try {
      const { createModeler } = await import('./modeler.js');
      modeler = createModeler(document.getElementById('tab-model'), {
        dark: document.documentElement.dataset.theme !== 'light', onToast: toast,
        onSend: (pos) => { setModel(pos); setTab('d3'); toast('Sent to the 3D tab. From there you can slice it in 3D Print, or take a profile or slice from it.'); },
        onDownload: (name, pos, kind) => {
          if (kind === 'stl') download(name, M.writeSTL(pos));
          else { const L = []; for (let i = 0; i < pos.length; i += 3) L.push(`v ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}`); for (let i = 1; i <= pos.length / 3; i += 3) L.push(`f ${i} ${i + 1} ${i + 2}`); download(name, L.join('\n') + '\n', 'text/plain'); }
        },
      });
    } catch (e) { modelerFailed = true; $('noGL2').hidden = false; return; }
  }
  if (state.tab === 'model') { modeler.start(); }
}
let viewerFailed = false;
async function ensureViewer() {
  if (viewer || viewerFailed) return;
  try {
    const { createViewer } = await import('./view3d.js');
    viewer = createViewer($('viewer'));
    viewer.setBg(document.documentElement.dataset.theme !== 'light');
    viewer.setMesh(state.model);
    viewer.frame();
    if (state.tab === 'd3') { viewer.start(); }
  } catch (e) {
    viewerFailed = true;
    $('noGL').hidden = false;
  }
}

// ---------------------------------------------------------------- drawing changes
let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('cloudcad-autosave', JSON.stringify({ units: state.units, name: state.name, startPt: state.startPt || null, ents: state.doc.ents, dims: state.dims || [], others: workspaces ? workspaces.exportOthers() : [] })); } catch (e) { /* storage full or blocked */ }
    if (Date.now() - lastSnap > 120000) snapshot('auto');
  }, 400);
}
let hintOff = false; try { hintOff = localStorage.getItem('cc_hint_off') === '1'; } catch (e) { /* ok */ }
function syncEmpty() { const e = $('emptyHint'); if (e) e.hidden = !!(hintOff || state.doc.ents.length || state.bg || state.tab !== 'draw'); }
function onChange(selOnly) {
  syncEmpty();
  if (!selOnly) autosave();
  if (workspaces) workspaces.refreshLabel();
  const ents = state.doc.ents;
  if (!selOnly) {
    const tolDoc = 0.002 / TO_IN[state.units];
    state.report = S.profileReport(ents, tolDoc * 1.5);
    const r = state.report;
    const sb = $('sumBox');
    if (sb) {
      const bb = ents.length ? S.bbox(ents) : null;
      sb.hidden = !bb;
      if (bb) {
        const ok = r.paths === 1 && !r.open.length, loose = r.open.length / 2;
        sb.innerHTML = `<b>${fmt(bb.w, 3)} \u00d7 ${fmt(bb.h, 3)} ${esc(state.units)}</b> &middot; ${ents.length} object${ents.length === 1 ? '' : 's'}<br>` +
          (ok ? '<span class="ok">\u2713 One closed outline: ready to cut</span>' : loose ? `<span class="bad">${loose} open piece${loose === 1 ? '' : 's'}: red circles show the gaps to close</span>` : `<span class="ok">\u2713 ${r.closed} closed outline${r.closed === 1 ? '' : 's'}</span>`);
      }
    }
    $('report').innerHTML = !ents.length ? '' :
      r.paths === 1 && !r.open.length ? '<span class="pill">One closed outline</span>' :
      `${r.closed} closed outline${r.closed === 1 ? '' : 's'}, ${r.open.length / 2} open piece${r.open.length === 2 ? '' : 's'}${r.open.length ? ' (red circles show the loose ends)' : ''}.`;
  }
  // selection panel
  const sel = ents.filter((e) => state.sel.has(e.id));
  const info = $('selInfo');
  $('selEdit').hidden = true; $('editLine').hidden = true; $('editRad').hidden = true;
  if (!sel.length) info.textContent = 'Nothing selected.';
  else if (sel.length === 1) {
    const e = sel[0];
    $('selEdit').hidden = false;
    if (e.t === 'L') { info.textContent = 'Line'; $('editLine').hidden = false; $('eLen').value = fmt(S.entLength(e), 5); $('eAng').value = fmt(S.lineAngleDeg(e), 4); }
    else if (e.t === 'C') { info.textContent = 'Circle'; $('editRad').hidden = false; $('eRad').value = fmt(e.r, 5); }
    else { info.textContent = 'Arc'; $('editRad').hidden = false; $('eRad').value = fmt(S.arcParams(e).r, 5); }
  } else {
    const b = S.bbox(sel);
    info.textContent = `${sel.length} objects, ${fmt(b.w, 3)} x ${fmt(b.h, 3)} ${state.units}`;
  }
  draw && draw.render();
  if (state.tab === 'machine') updateMachine();
  $('undo').disabled = !state.doc.past.length;
  $('redo').disabled = !state.doc.future.length;
}
function editSel(fn) {
  const id = [...state.sel][0];
  const list = state.doc.ents.map((e) => {
    if (e.id !== id) return e;
    const n = fn(e);
    return n || e;
  });
  state.doc.set(list);
  onChange();
}

// ---------------------------------------------------------------- units
function setUnits(u, convert) {
  const old = state.units;
  if (convert && old !== u && state.doc.ents.length) {
    const k = TO_IN[old] / TO_IN[u];
    const all = state.doc.ents.map((e) => e.id);
    state.doc.set(S.scaleEnts(state.doc.ents, all, [0, 0], k)); state.dims = [];
  }
  state.units = u;
  $('docUnits').value = u;
  const g = { in: 0.01, mm: 0.1, cm: 0.01, ft: 0.01 }[u];
  state.grid = g; $('grid').value = g;
  state.opts.filletR = state.opts.chamferD = state.opts.offsetD = { in: 0.25, mm: 5, cm: 0.5, ft: 0.25 }[u];
  state.opts.bisLen = state.opts.circR = $('oBis').value = $('oCircR').value = { in: 1, mm: 25, cm: 2.5, ft: 0.1 }[u];
  $('filletR').value = $('chamferD').value = $('offsetD').value = state.opts.filletR;
  onChange();
}

// ---------------------------------------------------------------- file import / export
function entsFromDxfText(text) {
  const r = readDxf(text);
  const unit = r.units && TO_IN[r.units] && ['in', 'mm', 'cm', 'ft'].includes(r.units) ? r.units : (r.units ? 'mm' : null);
  const u = unit || 'in';
  const base = TO_IN[u];
  const chains = simplifySplines(chain(r.segs, 0.002 / base), 0.002 / base);
  const segs = chains.flat();
  return { ents: S.fromSegments(segs), units: u, warnings: r.warnings.slice().concat(r.units ? [] : ['This DXF has no units saved. Assuming inches. Change Units in the right panel if the size looks wrong.']) };
}
let bannerT = 0;
function banner(msg, kind) {
  const b = $('banner'); if (!b || !msg) return;
  $('bannerTxt').textContent = msg; b.className = kind; b.hidden = false;
  clearTimeout(bannerT);
  if (kind !== 'err') bannerT = setTimeout(() => { b.hidden = true; }, 7000);
}
const ERR_RE = /^(Could not|Couldn't|Nothing|There is no|The profile is|Even turned|One piece|Choose |Select |Draw |Trace failed|Mirror and|\d+ pieces? need|The tether|Skipped|No |Not )/i;
function toast(msg, kind) {
  const h = $('hint');
  if (h) h.textContent = msg;
  const m = $('messages');
  if (state.tab === 'machine' && m) m.insertAdjacentHTML('afterbegin', `<div class="msg info">${esc(msg)}</div>`);
  state.lastToast = msg;
  banner(msg, kind || (ERR_RE.test(msg) ? 'err' : 'info'));
}
window.__banner = banner;
const toastErr = (m) => toast(m, 'err');
function addToDrawing(ents, replace) {
  if (replace) state.startPt = null;
  if (replace) state.doc.set(ents); else state.doc.add(ents);
  state.sel.clear();
  onChange();
  draw.fit();
}
function loadText(name, text, kind) {
  const m = name.match(/^(.*?)(\.[^.]*)?$/);
  state.name = (m && m[1]) || 'drawing';
  const ext = ((m && m[2]) || '').toLowerCase();
  if (ext === '.cloudcad' || ext === '.json') {
    const p = JSON.parse(text);
    snapshot('before opening ' + name);
    state.units = p.units || 'in';
    $('docUnits').value = state.units;
    state.doc.set(p.ents.map(({ id, ...e }) => e)); state.dims = Array.isArray(p.dims) ? p.dims : [];
    state.sel.clear(); state.startPt = null;
    setTab('draw'); draw.fit(); onChange();
    if (p.recipe && solidsUI) solidsUI.setRecipe(p.recipe);
    toast('Project opened. Undo brings your previous drawing back.');
    return;
  }
  if (['.tap', '.nc', '.gcode', '.txt'].includes(ext)) {
    const p = parseTap(text);
    snapshot('before opening ' + name);
    setUnitsQuiet('in');
    addToDrawing(S.fromSegments(p.segs), true);
    setTab('draw');
    toast(`Machine file opened as a drawing (${p.segs.length} moves, inches). Undo brings your previous drawing back.`);
    return;
  }
  const r = entsFromDxfText(text);
  snapshot('before opening ' + name);
  setUnitsQuiet(r.units);
  addToDrawing(r.ents, true);
  setTab(state.tab === 'machine' ? 'machine' : 'draw');
  toast(r.warnings.length ? r.warnings.join(' ') : `${kind || 'DXF'} opened (${r.ents.length} objects, ${r.units}). Undo brings your previous drawing back.`);
  checkUnits();
}
// Does the size look wrong for the unit the file claims? Offer to switch (the numbers stay the same, only the unit changes).
async function checkUnits() {
  const b = S.bbox(state.doc.ents);
  if (!b) return;
  const g = SH.guessUnits(state.units, b.w, b.h);
  if (!g) return;
  const nm = { in: 'inches', mm: 'millimeters', cm: 'centimeters', ft: 'feet' };
  const ans = await ask(`This file says it is in ${nm[state.units]}, but ${g.why}. Press OK to treat it as ${nm[g.unit]} (type ${g.unit}), or change the box to ${state.units} to keep ${nm[state.units]}:`, g.unit);
  if (ans && ans.trim().toLowerCase() === g.unit) { setUnitsQuiet(g.unit); onChange(); draw.fit(); toast(`Switched to ${g.unit}. Nothing was scaled, only the unit changed.`); }
}
// ---- history: snapshots so you can go back to an earlier drawing, even after closing the app
let lastSnap = 0;
function snapshot(reason) {
  try {
    if (!state.doc.ents.length) return;
    const now = Date.now(); lastSnap = now;
    store.put('history', { id: 'h' + now.toString(36), t: now, reason: reason || 'auto', name: state.name || 'drawing', units: state.units, count: state.doc.ents.length, ents: state.doc.ents.map(({ id, ...e }) => e) })
      .then(() => store.all('history')).then((all) => { all.sort((p, q) => q.t - p.t); return Promise.all(all.slice(60).map((x) => store.del('history', x.id))); }).catch(() => {});
  } catch (e) { /* history is best effort */ }
}
async function showHistory() {
  const dlg = $('histDlg'), list = $('histList');
  let all = [];
  try { all = (await store.all('history')).sort((p, q) => q.t - p.t); } catch (e) { /* ignore */ }
  list.innerHTML = all.length ? '' : '<p class="hint">Nothing saved yet. Earlier versions are kept automatically while you work, and before you open another file or clear the drawing.</p>';
  for (const h of all) {
    const row = document.createElement('div'); row.className = 'histRow';
    const when = new Date(h.t).toLocaleString();
    row.innerHTML = `<div><b>${esc(h.name)}</b> <span class="hint">${esc(when)} &middot; ${h.count} objects &middot; ${esc(h.reason)}</span></div>`;
    const b = document.createElement('button'); b.textContent = 'Go back to this';
    b.addEventListener('click', () => { snapshot('before going back'); setUnitsQuiet(h.units || 'in'); state.name = h.name; state.doc.set(h.ents.map((e) => ({ ...e }))); state.sel.clear(); dlg.close(); setTab('draw'); onChange(); draw.fit(); toast('Brought back that version. Undo returns to what you had.'); });
    row.appendChild(b); list.appendChild(row);
  }
  dlg.showModal();
}
function setUnitsQuiet(u) {
  state.units = u; $('docUnits').value = u;
  const g = { in: 0.01, mm: 0.1, cm: 0.01, ft: 0.01 }[u]; state.grid = g; $('grid').value = g;
  state.opts.filletR = state.opts.chamferD = { in: 0.25, mm: 5, cm: 0.5, ft: 0.25 }[u];
  $('filletR').value = $('chamferD').value = state.opts.filletR;
  state.opts.bisLen = state.opts.circR = $('oBis').value = $('oCircR').value = { in: 1, mm: 25, cm: 2.5, ft: 0.1 }[u];
}
function rebindDoc() { draw && draw.setDoc(state.doc); }

async function parseModelBuf(name, buf) {
  const ext = (name.match(/\.[^.]*$/) || [''])[0].toLowerCase();
  let pos;
  if (ext === '.stl') pos = M.parseSTL(buf);
  else if (ext === '.obj') pos = M.parseOBJ(new TextDecoder().decode(buf));
  else {
    const v = await import('./view3d.js');
    pos = ext === '.glb' || ext === '.gltf' ? await v.parseGLB(buf) : v.parsePLY(buf);
  }
  if (!pos || !pos.length) throw new Error('No triangles found in that file.');
  return pos;
}
async function loadModelBuffer(name, buf) {
  const pos = await parseModelBuf(name, buf);
  state.rawModel = pos;
  state.model = M.toOrigin(pos);
  $('applyModel').disabled = false;
  setModel(state.model);
  setTab('d3');
  const sz = M.bboxOf(state.model).size;
  $('mSize').value = fmt(Math.max(...sz), 3);
}

// Bring a second drawing into the one that is open (instead of replacing it).
function addEntsFrom(ents, units, label) {
  if (!ents.length) throw new Error('That file has no drawing objects in it.');
  if (units !== state.units) {   // other file is in different units: convert so sizes stay true
    const k = TO_IN[units] / TO_IN[state.units];
    const tmp = new S.Sketch(); tmp.set(ents);
    ents = S.scaleEnts(tmp.ents, tmp.ents.map((e) => e.id), [0, 0], k).map(({ id, ...e }) => e);
  }
  const before = new Set(state.doc.ents.map((e) => e.id));
  state.doc.add(ents);
  state.sel.clear();
  state.doc.ents.forEach((e) => { if (!before.has(e.id)) state.sel.add(e.id); });
  setTab('draw'); onChange(true); onChange(); draw.fit(); draw.render();
  toast(`Added ${label || ents.length + ' objects'}${units !== state.units ? ` (converted from ${units})` : ''}. They are selected: Move, Rotate or Mirror them into place, with snap on. Undo removes them.`);
}
function insertText(name, text) {
  const ext = ((name.match(/\.[^.]*$/) || [''])[0]).toLowerCase();
  let ents, units = state.units;
  if (ext === '.cloudcad' || ext === '.json') { const p = JSON.parse(text); ents = p.ents.map(({ id, ...e }) => e); units = p.units || 'in'; }
  else if (['.tap', '.nc', '.gcode', '.txt'].includes(ext)) { ents = S.fromSegments(parseTap(text).segs); units = 'in'; }
  else { const r = entsFromDxfText(text); ents = r.ents; units = r.units; }
  addEntsFrom(ents, units);
}
function insertFile(f) {
  const rd = new FileReader();
  rd.onerror = () => toast('Could not read that file.');
  if (/\.dwg$/i.test(f.name)) {
    rd.onload = async () => { try { toast('Reading the DWG file...'); insertText(f.name.replace(/\.dwg$/i, '.dxf'), await dwgToDxfText(rd.result)); } catch (e) { toastErr('Could not add that drawing: ' + (e.message || e)); } };
    rd.readAsArrayBuffer(f);
    return;
  }
  rd.onload = () => { try { insertText(f.name, String(rd.result)); } catch (e) { toastErr('Could not add that drawing: ' + (e.message || e)); } };
  rd.readAsText(f);
}
function openFile(f) {
  const ext = (f.name.match(/\.[^.]*$/) || [''])[0].toLowerCase();
  const rd = new FileReader();
  rd.onerror = () => toast('Could not read that file.');
  if (['.stl', '.obj', '.glb', '.ply'].includes(ext)) {
    rd.onload = () => loadModelBuffer(f.name, rd.result).catch((e) => toastErr('Could not open model: ' + e.message));
    rd.readAsArrayBuffer(f);
  } else if (ext === '.dwg') {
    rd.onload = async () => { try { toast('Reading the DWG file...'); loadText(f.name.replace(/\.dwg$/i, '.dxf'), await dwgToDxfText(rd.result), 'DWG'); } catch (e) { toastErr('Could not open file: ' + (e.message || e)); } };
    rd.readAsArrayBuffer(f);
  } else {
    rd.onload = () => { try { loadText(f.name, String(rd.result)); } catch (e) { toastErr('Could not open file: ' + (e.message || e)); } };
    rd.readAsText(f);
  }
}

// ---------------------------------------------------------------- machine tab
const pair = (a, b) => { const x = $(a).value.trim(), y = $(b).value.trim(); return x === '' && y === '' ? null : [parseFloat(x) || 0, parseFloat(y) || 0]; };
const textLines = (id) => $(id).value.replace(/\r/g, '').split('\n');
function machineOptions() {
  const footer = textLines('footer');
  while (footer.length && footer[footer.length - 1] === '') footer.pop();
  return {
    unitsIn: state.units, fitWidth: num('fitWidth'), fitHeight: num('fitHeight'), scale: num('scale') || 1,
    tol: num('tol') || 0.002, curveTol: num('curveTol') || 0.002, rotate: parseInt($('rotate').value, 10) || 0,
    reverse: $('reverse').checked, mirrorX: $('mirrorX').checked, mirrorY: $('mirrorY').checked, allowMulti: $('allowMulti').checked,
    leadIn: pair('inX', 'inY'), leadOut: pair('outX', 'outY'), header: textLines('header'), footer,
    decimals: Math.min(6, Math.max(2, parseInt($('decimals').value, 10) || 4)),
  };
}
const colorAt = (t) => `hsl(${Math.round(200 - 195 * t)},85%,60%)`;
function drawSvg(segs, { mode = 'cut', marks = [] } = {}) {
  const pts = [];
  const polys = segs.map((s) => { const p = flatten(s); pts.push(...p); return p; });
  marks.forEach((m) => pts.push(m.p));
  if (!pts.length) return '';
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0 || 1, h = y1 - y0 || 1, pad = Math.max(w, h) * 0.08, r = Math.max(w, h) / 70;
  const body = polys.map((p, i) => {
    const t = polys.length > 1 ? i / (polys.length - 1) : 0;
    return `<polyline points="${p.map((q) => q[0].toFixed(4) + ',' + (-q[1]).toFixed(4)).join(' ')}" fill="none" stroke="${mode === 'cut' ? colorAt(t) : '#8a8f98'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  let arrows = '';
  if (mode === 'cut') {
    const ar = Math.max(w, h) / 55;
    segs.forEach((sg, i) => {
      const p = polys[i];
      let L = 0; for (let k = 1; k < p.length; k++) L += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      if (L < Math.max(w, h) * 0.09) return;
      let acc = 0, mid = null;
      for (let k = 1; k < p.length; k++) { const l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); if (acc + l >= L / 2) { const f = (L / 2 - acc) / (l || 1); mid = { x: p[k - 1][0] + (p[k][0] - p[k - 1][0]) * f, y: p[k - 1][1] + (p[k][1] - p[k - 1][1]) * f, dx: p[k][0] - p[k - 1][0], dy: p[k][1] - p[k - 1][1] }; break; } acc += l; }
      if (!mid) return;
      const n = Math.hypot(mid.dx, mid.dy) || 1, ux = mid.dx / n, uy = -mid.dy / n, vx = -uy, vy = ux;
      const X = mid.x, Y = -mid.y;
      const pts = [[X + ux * ar, Y + uy * ar], [X - ux * ar * 0.7 + vx * ar * 0.6, Y - uy * ar * 0.7 + vy * ar * 0.6], [X - ux * ar * 0.7 - vx * ar * 0.6, Y - uy * ar * 0.7 - vy * ar * 0.6]];
      arrows += `<polygon points="${pts.map((q) => q[0].toFixed(4) + ',' + q[1].toFixed(4)).join(' ')}" fill="${colorAt(segs.length > 1 ? i / (segs.length - 1) : 0)}" stroke="#000" stroke-width=".6" vector-effect="non-scaling-stroke" opacity=".9"/>`;
    });
  }
  const dots = marks.map((m) => `<circle cx="${m.p[0].toFixed(4)}" cy="${(-m.p[1]).toFixed(4)}" r="${r.toFixed(4)}" fill="${m.color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(x0 - pad).toFixed(4)} ${(-(y1 + pad)).toFixed(4)} ${(w + 2 * pad).toFixed(4)} ${(h + 2 * pad).toFixed(4)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Toolpath preview">${body}${arrows}${dots}</svg>`;
}
function pathLength(segs) { let L = 0; for (const s of segs) { const p = flatten(s, 2); for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); } return L; }
let sim = null;
function showMachine(msgs, stats, svg, code, tap) {
  if (!sim && $('sim')) sim = initSim($('sim'), () => state.units);
  if (sim) { try { sim.load(tap || ''); } catch (e) { $('sim').hidden = true; } }
  $('messages').innerHTML = msgs.map((m) => `<div class="msg ${m.kind}">${esc(m.text)}</div>`).join('');
  $('stats').innerHTML = stats.map((s) => `<div><span>${esc(s[0])}</span><b>${esc(s[1])}</b></div>`).join('');
  $('preview').innerHTML = svg || '<p class="hint">Draw something (or open a DXF) and the cut path appears here.</p>';
  $('code').textContent = code || '';
}
function updateMachine() {
  $('clearStart').disabled = !state.startPt;
  $('startInfo').textContent = state.startPt ? `Cut starts at ${fmt(state.startPt[0], 3)}, ${fmt(state.startPt[1], 3)} ${state.units}.` : 'Cut starts at the first point of the drawing. Use Cut start in the Draw tab to choose it.';
  $('dlTap').disabled = $('copy').disabled = true;
  state.result = null;
  const ents = state.doc.ents;
  if (!ents.length) { showMachine([], [], '', ''); return; }
  try {
    const res = convertSegments(state.startPt ? applyStart(S.toSegments(ents), state.startPt, 0.002 / TO_IN[state.units] * 1.5) : S.toSegments(ents), { units: state.units, warnings: [], splines: new Set(ents.filter((e) => e.sp !== undefined).map((e) => e.sp)).size }, machineOptions());
    state.result = res;
    const msgs = [];
    if (res.error) msgs.push({ kind: 'err', text: res.error });
    res.warnings.forEach((w) => msgs.push({ kind: 'warn', text: w }));
    (res.notes || []).forEach((n) => msgs.push({ kind: 'info', text: n }));
    if (res.tap) {
      const parsed = parseTap(res.tap), s = res.stats;
      msgs.push({ kind: 'info', text: 'The picture is drawn from the finished G-code, so it shows what the machine will actually do. Check the size, then do a dry run before cutting foam.' });
      showMachine(msgs, [
        ['Size', `${s.width.toFixed(4)} x ${s.height.toFixed(4)} in`],
        ['Paths / moves', `${s.paths} / ${s.moves} (${s.arcs} arcs)`],
        ['Cut length', `${pathLength(parsed.segs).toFixed(2)} in`],
        ['Wire must start at', `profile point ${s.start[0].toFixed(3)}, ${s.start[1].toFixed(3)}`],
      ], drawSvg(parsed.segs, { marks: [{ p: [0, 0], color: '#2a9d8f' }, { p: parsed.end, color: '#e76f51' }] }), res.tap.replace(/\r/g, ''), res.tap);
      $('dlTap').disabled = $('copy').disabled = false;
    } else {
      const marks = (res.gaps || []).flatMap((g) => [{ p: g.p, color: '#d62828' }, { p: g.q, color: '#d62828' }]);
      showMachine(msgs, [], drawSvg(res.chains.flat(), { mode: 'raw', marks }), '');
    }
  } catch (e) {
    showMachine([{ kind: 'err', text: 'Could not make the machine file: ' + (e && e.message ? e.message : e) }], [], '', '');
  }
}

// ---------------------------------------------------------------- 3D tab
function setModel(pos) {
  state.model = pos;
  if (!solidFlag && solidsUI) solidsUI.modelChanged(true);
  if (viewer) { viewer.setMesh(pos); viewer.frame(); }
  else ensureViewer();
  updateModelInfo();
  $('exportSTL').disabled = !pos; $('toBuild').disabled = !pos;
  $('secGo').disabled = !pos;
  if (pos) {
    const bb = M.bboxOf(pos);
    $('secZ').min = 0; $('secZ').max = bb.size[2]; $('secZ').step = bb.size[2] / 400; $('secZ').value = bb.size[2] / 2;
    updateSecLabel();
  }
}
function updateSecLabel() { $('secVal').textContent = state.model ? `Height ${fmt(+$('secZ').value, 4)} from the bottom` : ''; }
function updateModelInfo() {
  const el = $('modelInfo');
  if (!state.model) { el.textContent = 'No model yet. Extrude your drawing, open a model file, or carve one from views.'; return; }
  const b = M.bboxOf(state.model);
  el.innerHTML = `<b>${fmt(b.size[0], 3)} x ${fmt(b.size[1], 3)} x ${fmt(b.size[2], 3)}</b> (X x Y x Z)<br>${state.model.length / 9} triangles, volume ${fmt(M.meshVolume(state.model), 3)}`;
}
function drawingLoops() {
  const tol = 0.002 / TO_IN[state.units];
  return M.loopsFromEnts(state.doc.ents, tol, tol * 5);
}
function maskFromDrawing(target = 400) {
  const { loops } = drawingLoops();
  if (!loops.length) return null;
  const all = loops.flat();
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const px = Math.max(x1 - x0, y1 - y0) / target || 1;
  const w = Math.max(1, Math.ceil((x1 - x0) / px)), h = Math.max(1, Math.ceil((y1 - y0) / px));
  return { mask: T.rasterLoops(loops, x0, y1, px, w, h), w, h };
}
const imageCache = {};
function refreshSlots() {
  const el = $('slots');
  el.innerHTML = ['front', 'side', 'top'].map((v) => `<div class="row" style="margin-bottom:6px"><div><label>${v[0].toUpperCase() + v.slice(1)} view</label>
    <select data-slot="${v}"><option value="none">Not used</option><option value="drawing">My drawing</option><option value="model">Current model</option><option value="image">A picture…</option></select></div>
    <div><label>&nbsp;</label><input type="file" accept="image/*" data-slotfile="${v}" ${state.slots[v].src === 'image' ? '' : 'hidden'}></div></div>`).join('');
  el.querySelectorAll('[data-slot]').forEach((s) => {
    s.value = state.slots[s.dataset.slot].src;
    s.addEventListener('change', () => { state.slots[s.dataset.slot].src = s.value; refreshSlots(); });
  });
  el.querySelectorAll('[data-slotfile]').forEach((f) => f.addEventListener('change', async () => {
    if (!f.files[0]) return;
    const m = await imageToMask(f.files[0], 128, false);
    state.slots[f.dataset.slotfile].mask = m;
    toast3('Picture loaded for ' + f.dataset.slotfile + ' view.');
  }));
}
function toast3(msg) { $('cvMsg').textContent = msg; }
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = url;
  });
}
async function imageToMask(file, threshold, invert, maxPx = 700, colorOpt) {
  const { img, url } = await loadImage(file);
  const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const d = ctx.getImageData(0, 0, w, h);
  let mask, used = null;
  if (colorOpt) {
    used = colorOpt === 'auto' ? T.dominantColor(d.data, w, h) : colorOpt;
    mask = used ? T.maskFromColor(d.data, w, h, used, 70) : new Uint8Array(w * h);
  } else mask = T.maskFromRGBA(d.data, w, h, { threshold, invert });
  return { mask, w, h, crop: T.cropMask(mask, w, h), color: used };
}
function carveNow() {
  const views = {}, used = [];
  for (const v of ['front', 'side', 'top']) {
    const s = state.slots[v];
    let m = null;
    if (s.src === 'drawing') m = maskFromDrawing();
    else if (s.src === 'model') { if (state.model) m = M.silhouette(state.model, v, 400); }
    else if (s.src === 'image') m = s.mask && s.mask.crop ? s.mask.crop : null;
    if (s.src !== 'none' && !m) { toast3(`The ${v} view has nothing to use yet.`); return; }
    if (m) { views[v] = m; used.push(v); }
  }
  if (!used.length) { toast3('Pick at least one view first.'); return; }
  const dims = { W: num('cvW'), D: num('cvD'), H: num('cvH') };
  if (!(dims.W > 0 && dims.D > 0 && dims.H > 0)) { toast3('Width, depth and height must be bigger than zero.'); return; }
  const r = M.carve(views, dims, parseInt($('cvN').value, 10));
  if (!r.voxels) { toast3('The views do not overlap into a solid. Check that each outline is filled and the sizes match.'); return; }
  state.rawModel = null;
  setModel(r.positions);
  toast3(`Carved from ${used.join(' + ')}. ${used.length === 1 ? 'With one view this is the outline pushed straight through; add a second view for a real 3D shape.' : ''}`);
}
function profileFromModel(view) {
  if (!state.model) return;
  const sil = M.silhouette(state.model, view, 1400);
  const loops = M.silhouetteLoops(sil);
  if (!loops.length) { toast3('No outline found.'); return; }
  const ents = M.loopsToLineEnts(loops);
  addToDrawing(ents, $('profReplace').checked);
  setTab('draw');
  toast(`${view[0].toUpperCase() + view.slice(1)} outline added to the drawing (${ents.length} lines).`);
}
function sliceModel() {
  const loops = M.sectionLoops(state.model, 2, +$('secZ').value + M.bboxOf(state.model).min[2]);
  if (!loops.length) { toast3('The slice at that height is empty.'); return; }
  addToDrawing(M.loopsToLineEnts(M.toLowerLeft(loops)), $('profReplace').checked);
  setTab('draw');
  toast('Slice added to the drawing.');
}

// ---------------------------------------------------------------- picture tracing (2D)
let traceFile = null;
function loadBg(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onerror = () => rej(new Error('Could not read that image.'));
    rd.onload = () => {
      const img = new Image();
      img.onload = () => res({ url: String(rd.result), w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => rej(new Error('Could not read that image.'));
      img.src = String(rd.result);
    };
    rd.readAsDataURL(file);
  });
}
function bgSync() {
  const bg = state.bg;
  $('bgCtl').hidden = !bg;
  if (!bg) return;
  $('bgW').value = fmt(bg.width, 4);
  $('bgOp').value = Math.round(bg.opacity * 100);
  document.querySelectorAll('.u').forEach((u) => (u.textContent = state.units));
  draw.render();
}
function useBg(info) {
  const v = draw.view, sz = draw.size();
  const width = (sz.w / v.s) * 0.6;
  state.bg = { url: info.url, w: info.w, h: info.h, width, x: v.cx - width / 2, y: v.cy - (width * info.h / info.w) / 2, opacity: 0.55, visible: true };
  bgSync();
}
let pickedColor = null;
async function traceNow() {
  if (!traceFile) { toast('Choose a picture first.'); return; }
  const mode = $('imgMode').value;
  const colorOpt = mode === 'dark' ? null : mode === 'pick' && pickedColor ? pickedColor : 'auto';
  const m = await imageToMask(traceFile, +$('imgTh').value, $('imgInv').checked, 1400, colorOpt);
  const c = m.crop;
  if (!c) { toast(mode === 'dark' ? 'Nothing dark found at that threshold. Move the Threshold slider, or tick "light on a dark background".' : 'Could not find a shape color. Try "Dark shapes" mode.'); return; }
  const raw = T.traceContours(c.mask, c.w, c.h);
  const smooth = raw.map((l) => T.simplifyLoop(T.smoothLoop(l, 1), num('imgTol') || 1.2));
  const areas = smooth.map((l) => Math.abs(T.signedArea(l)));
  const big = Math.max(0, ...areas);
  const loops = smooth.filter((l, i) => l.length >= 3 && areas[i] > 25 && areas[i] >= big * 0.004);
  if (!loops.length) { toast('Could not find a shape to trace.'); return; }
  const all = loops.flat();
  const wpx = Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]));
  const realW = num('imgW');
  const scale = realW > 0 ? realW / wpx : 1 / 40;
  const ents = $('imgSmooth').checked ? T.loopsToSmoothEnts(loops, scale) : T.loopsToEnts(loops, scale);
  addToDrawing(ents, false);
  const outers = T.classifyLoops(loops).filter((x) => !x.hole).length;
  const dropped = raw.length - loops.length;
  toast(`Traced ${outers} shape${outers === 1 ? '' : 's'}${loops.length > outers ? ` (+${loops.length - outers} hole${loops.length - outers === 1 ? '' : 's'})` : ''}, ${ents.length} lines${dropped > 0 ? `; ignored ${dropped} tiny speck${dropped === 1 ? '' : 's'}` : ''}. ${realW > 0 ? `Whole picture width set to ${realW} ${state.units}.` : 'No real width given, so the size is a guess.'} Double-click a shape to select it, then "Set width…" or "Set height…" to fix its size.`);
}

// ---------------------------------------------------------------- project save
function saveProject() {
  const data = JSON.stringify({ app: "Cloud's CAD", version: 1, units: state.units, ents: state.doc.ents, dims: state.dims || [], recipe: solidsUI ? solidsUI.getRecipe() : null });
  download(state.name + '.cloudcad', data, 'application/json');
}

// ---------------------------------------------------------------- init
function scaleSelectionTo(axis) {
  const ents = state.doc.ents;
  const ids = state.sel.size ? [...state.sel] : ents.map((e) => e.id);
  const sub = ents.filter((e) => ids.includes(e.id));
  const b = S.bbox(sub);
  if (!b) return;
  const cur = axis === 'w' ? b.w : b.h;
  ask(`New ${axis === 'w' ? 'width' : 'height'} in ${state.units} (now ${fmt(cur, 4)}):`, fmt(cur, 4)).then((ans) => {
    const val = parseFloat(ans);
    if (!(val > 0) || !(cur > 0)) return;
    const keep = $('keepProp').checked, k = val / cur;
    const out = keep ? S.scaleEnts(ents, ids, [b.x0, b.y0], k) : S.scaleXY(ents, ids, [b.x0, b.y0], axis === 'w' ? k : 1, axis === 'h' ? k : 1);
    const had = new Set(ents.map((e) => e.id)), was = new Set(ids);
    state.doc.set(out);
    if (!keep && was.size && state.sel.size) { state.sel.clear(); state.doc.ents.forEach((e) => { if (was.has(e.id) || !had.has(e.id)) state.sel.add(e.id); }); }
    onChange();
    if (!keep && out.converted) toast(`Only the ${axis === 'w' ? 'width' : 'height'} changed. ${out.converted} round piece${out.converted === 1 ? ' was' : 's were'} turned into many short straight lines so they could stretch.`);
  });
}
function scaleSelectionBy() {
  const ents = state.doc.ents;
  const ids = state.sel.size ? [...state.sel] : ents.map((e) => e.id);
  const b = S.bbox(ents.filter((e) => ids.includes(e.id)));
  if (!b) return;
  ask('Scale by what factor? (2 = twice as big, 0.5 = half)', '1.5').then((ans) => {
    const k = parseFloat(ans);
    if (!(k > 0)) return;
    state.doc.set(S.scaleEnts(ents, ids, [b.x0, b.y0], k));
    onChange();
  });
}
function selCenter() { const b = S.bbox(state.doc.ents.filter((e) => state.sel.has(e.id))); return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0]; }

function init() {
  $('header').value = DEFAULT_POST.header.join('\n');
  $('footer').value = DEFAULT_POST.footer.join('\n');
  draw = createDrawView({
    svg: $('cv'), state, onChange,
    els: { bgChanged: () => bgSync(), hint: $('hint'), coords: $('coords'), num: $('num'), toolBtns: [...document.querySelectorAll('#tools [data-tool]')], toolOpts: [...document.querySelectorAll('.props [data-for]')] },
  });
  document.querySelectorAll('#tools [data-tool]').forEach((b) => b.addEventListener('click', () => draw.setTool(b.dataset.tool)));
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('toggle23').addEventListener('click', () => setTab(state.tab === 'd3' ? 'draw' : 'd3'));
  $('openBtn').addEventListener('click', () => $('openFile').click());
  $('addBtn').addEventListener('click', () => $('addFile').click());
  $('addFile').addEventListener('change', (e) => { [...e.target.files].forEach(insertFile); e.target.value = ''; });
  $('openFile').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]); });
  $('saveProj').addEventListener('click', saveProject);
  $('revBtn').addEventListener('click', () => {
    const ids = state.sel.size ? [...state.sel] : state.doc.ents.map((e) => e.id);
    if (!ids.length) return toast('Nothing to reverse yet.');
    state.doc.set(S.reverseEnts(state.doc.ents, ids)); onChange(); draw.render();
    toast('Direction reversed' + (state.sel.size ? ' on the selection.' : ' on everything.') + ' Circles are left alone. Undo brings it back.');
  });
  $('infoBtn').addEventListener('click', () => {
    const sub = state.sel.size ? state.doc.ents.filter((e) => state.sel.has(e.id)) : state.doc.ents;
    if (!sub.length) return toast('Draw something first.');
    const r = S.sizeInfo(sub, 0.002 / TO_IN[state.units]);
    toast(`${state.sel.size ? 'Selection' : 'Whole drawing'}: ${sub.length} pieces, total length ${fmtLen(r.length, state.units)}` + (r.closed ? `, area inside ${r.closed} closed outline(s) ${fmt(r.area, 3)} sq ${state.units} (holes not subtracted).` : ', no closed outlines.'));
  });
  $('dimClear').addEventListener('click', () => { state.dims = []; onChange(true); draw.render(); toast('Dimensions cleared.'); });
  const root = document.documentElement;
  const applyTheme = (th) => { root.dataset.theme = th; $('themeBtn').textContent = th === 'dark' ? '☀ Light' : '☾ Dark'; if (viewer) viewer.setBg(th === 'dark'); if (modeler) modeler.setBg(th === 'dark'); draw.render(); };
  let saved = 'dark';
  try { saved = localStorage.getItem('cloudcad-theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(saved === 'light' ? 'light' : 'dark');
  $('themeBtn').addEventListener('click', () => { const n = root.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(n); try { localStorage.setItem('cloudcad-theme', n); } catch (e) { /* ignore */ } });

  $('undo').addEventListener('click', () => { state.doc.undo(); state.sel.clear(); onChange(); });
  $('redo').addEventListener('click', () => { state.doc.redo(); state.sel.clear(); onChange(); });
  $('del').addEventListener('click', () => draw.deleteSelected());
  $('fitView').addEventListener('click', () => draw.fit());

  $('docUnits').addEventListener('change', () => {
    const u = $('docUnits').value;
    if (state.doc.ents.length && confirm(`Convert the drawing to ${u}? OK = resize the drawing to the new unit (same real size). Cancel = just relabel (numbers stay the same).`)) setUnits(u, true);
    else setUnits(u, false);
  });
  $('grid').addEventListener('input', () => { const g = num('grid'); if (g > 0) { state.grid = g; draw.render(); } });
  const snapSync = () => { Object.assign(state.snaps, { grid: $('snapGrid').checked, end: $('snapEnd').checked, mid: $('snapEnd').checked, center: $('snapEnd').checked, inter: $('snapEnd').checked, ortho: $('snapOrtho').checked, showGrid: $('showGrid').checked, showOpen: $('showOpen').checked, showDims: $('showDims').checked }); draw.render(); };
  ['snapGrid', 'snapEnd', 'snapOrtho', 'showGrid', 'showOpen', 'showDims'].forEach((id) => $(id).addEventListener('change', snapSync));
  $('offsetD').addEventListener('input', () => (state.opts.offsetD = num('offsetD')));
  $('filletR').addEventListener('input', () => (state.opts.filletR = num('filletR')));
  $('chamferD').addEventListener('input', () => (state.opts.chamferD = num('chamferD')));
  $('oSides').addEventListener('input', () => (state.opts.sides = Math.max(3, Math.round(num('oSides')) || 3)));
  $('oPoints').addEventListener('input', () => (state.opts.points = Math.max(3, Math.round(num('oPoints')) || 3)));
  $('oRatio').addEventListener('input', () => (state.opts.ratio = Math.min(0.95, Math.max(0.05, num('oRatio') || 0.4))));
  $('oBis').addEventListener('input', () => (state.opts.bisLen = num('oBis')));
  $('oDiv').addEventListener('input', () => (state.opts.divN = Math.max(2, Math.round(num('oDiv')) || 2)));
  $('oCircR').addEventListener('input', () => (state.opts.circR = num('oCircR')));
  $('rotCopy').addEventListener('change', () => (state.opts.copy = $('rotCopy').checked));

  $('eLen').addEventListener('change', () => { const v = num('eLen'); if (v > 0) editSel((e) => (e.t === 'L' ? S.setLineLength(e, v) : null)); });
  $('eAng').addEventListener('change', () => { const v = parseFloat($('eAng').value); if (Number.isFinite(v)) editSel((e) => (e.t === 'L' ? S.setLineAngle(e, v) : null)); });
  $('eRad').addEventListener('change', () => { const v = num('eRad'); if (v > 0) editSel((e) => S.setRadius(e, v)); });
  $('scaleTo').addEventListener('click', () => scaleSelectionTo('w'));
  $('scaleToH').addEventListener('click', () => scaleSelectionTo('h'));
  $('scaleBy').addEventListener('click', scaleSelectionBy);
  $('selAll').addEventListener('click', () => { state.doc.ents.forEach((e) => state.sel.add(e.id)); onChange(true); draw.render(); });
  $('explodeBtn').addEventListener('click', () => {
    if (!state.sel.size) { toast('Select a circle or curve first (Select tool), then press Explode.'); return; }
    const r = S.explode(state.doc.ents, [...state.sel]);
    if (!r.n) { toast('Nothing to explode there. Lines and arcs are already single pieces.'); return; }
    state.doc.set(r.ents); state.sel.clear(); onChange(); toast(`Exploded ${r.n} object(s): circles became two arcs, curves became plain lines.`);
  });
  $('joinBtn').addEventListener('click', () => {
    const tol = 0.02 / TO_IN[state.units];
    const r = S.join(state.doc.ents, [...state.sel], tol);
    if (!r.moved && !r.merged) { toast('Nothing to join: no gaps under 0.02 in and no straight lines to merge.'); return; }
    state.doc.set(r.ents); onChange(); toast(`Joined: closed ${r.moved} gap end(s), merged ${r.merged} straight piece(s).`);
  });
  $('laGo').addEventListener('click', () => { if (!state.sel.size) return toast('Select something first.'); state.doc.set(S.linearArray(state.doc.ents, [...state.sel], Math.max(2, num('laN')), num('laX'), num('laY'))); onChange(); });
  $('paGo').addEventListener('click', () => { if (!state.sel.size) return toast('Select something first.'); const c = $('paC').value === 's' ? selCenter() : [0, 0]; state.doc.set(S.polarArray(state.doc.ents, [...state.sel], c, Math.max(2, num('paN')), (num('paA') * Math.PI) / 180)); onChange(); });
  $('cleanBtn').addEventListener('click', () => {
    const k = 1 / TO_IN[state.units];
    const r = SH.cleanupAll(state.doc.ents, { tol: 0.002 * k, speck: 0.02 * k });
    state.doc.set(r.ents); state.sel.clear(); onChange();
    const rp = S.profileReport(r.ents, 0.003 * k);
    toast(`${r.summary} Now: ${rp.closed} closed outline${rp.closed === 1 ? '' : 's'}${rp.open.length ? `, ${rp.open.length / 2} open piece${rp.open.length === 2 ? '' : 's'} still have loose ends (red circles)` : ''}.`);
  });
  $('mjGo').addEventListener('click', () => {
    const ids = state.sel.size ? [...state.sel] : state.doc.ents.map((e) => e.id);
    if (!ids.length) { toast('Draw or select half of a profile first.'); return; }
    const axis = SH.edgeAxis(state.doc.ents.filter((e) => ids.includes(e.id)), $('mjSide').value);
    if (!axis) return;
    const r = SH.mirrorJoin(state.doc.ents, ids, axis[0], axis[1], 0.002 / TO_IN[state.units]);
    state.doc.set(r.ents); state.sel.clear(); onChange(); draw.fit();
    const rp = S.profileReport(r.ents, 0.003 / TO_IN[state.units]);
    toast(rp.paths === 1 && !rp.open.length ? 'Mirrored and joined: one closed outline.' : `Mirrored and joined. ${rp.closed} closed outline(s), ${rp.open.length / 2} open piece(s) left. Check the red circles, or try the other edge.`);
  });
  // Works out the nest from the current settings. Returns { error } or { r, turned, pairs, rect } without changing the drawing.
  function computeNest() {
    const k = 1 / TO_IN[state.units], ids = state.sel.size ? [...state.sel] : state.doc.ents.map((e) => e.id);
    const pick = state.doc.ents.filter((e) => ids.includes(e.id));
    let outs = NEST.outlinesOf(pick, 0.003 * k), turned = 0;
    if (!outs.length) return { error: 'There is no closed outline to nest. Draw or select a closed profile first (red circles mark gaps that need closing).' };
    if ($('nPair').checked) { const m = NEST.mirrorOutlines(outs); outs = outs.flatMap((o, i) => [o, m[i]]); }
    if ($('nFit').checked) {
      const f = NEST.rotateToFit(outs, num('nH'));
      if (f.fail) return { error: `Even turned to its flattest angle the profile is ${f.h.toFixed(3)} tall, and the block is only ${num('nH')} tall. Use a taller block.` };
      outs = f.outlines; turned = f.deg;
    }
    const r = NEST.nestRow(outs, { W: num('nW'), H: num('nH'), gap: num('nGap'), margin: num('nMargin'), tetherW: num('nTW'), tetherPct: num('nTP'), count: Math.round(num('nCount')) || 0, leads: $('nLeads').value, alternate: $('nAlt').checked, even: $('nPair').checked });
    if (r.error) return { error: r.error };
    const dx = $('nSide').value === 'left' ? -num('nW') : 0;
    if (dx) r.ents = r.ents.map((e) => { const o = { ...e }; for (const q of ['a', 'b', 'c']) if (e[q]) o[q] = [e[q][0] + dx, e[q][1]]; return o; });
    return { r, turned, pairs: $('nPair').checked, rect: [dx, 0, dx + num('nW'), num('nH')], k };
  }
  function nestPreview() {
    if (!$('nPrev').checked) { if (state.preview) { state.preview = null; draw.render(); } return; }
    const c = computeNest();
    state.preview = c.error ? { ents: [], rect: [$('nSide').value === 'left' ? -num('nW') : 0, 0, $('nSide').value === 'left' ? 0 : num('nW'), num('nH')] } : { ents: c.r.ents, rect: c.rect };
    draw.render();
    if (c.error) banner(c.error, 'err');
  }
  ['nW', 'nH', 'nGap', 'nMargin', 'nTW', 'nTP', 'nCount', 'nLeads', 'nAlt', 'nFit', 'nPair', 'nSide', 'nPrev'].forEach((id) => { $(id).addEventListener('input', nestPreview); $(id).addEventListener('change', nestPreview); });
  $('nestGo').addEventListener('click', () => {
    const c = computeNest();
    if (c.error) { toast(c.error, 'err'); return; }
    const { r, turned, k } = c;
    state.preview = null; $('nPrev').checked = false;
    snapshot('before nesting');
    state.doc.set(r.ents); state.sel.clear(); onChange(); draw.fit();
    const rp = S.profileReport(r.ents, 0.003 * k);
    toast(`Nested ${r.count} piece${r.count === 1 ? '' : 's'} in ${num('nW')} x ${num('nH')}. ${rp.closed ? 'One closed loop.' : `${rp.paths} cut path${rp.paths === 1 ? '' : 's'}.`}${turned ? ` The profile was turned ${turned} degrees to fit the block height.` : ''} Undo brings your profile back.`);
  });
  $('smGo').addEventListener('click', () => {
    const k = 1 / TO_IN[state.units], st = Math.max(1, Math.min(10, parseFloat($('smStrength').value) || 3));
    const r = SH.smoothChains(state.doc.ents, [...state.sel], { tol: 0.003 * st * k, cornerDeg: 40, gap: 0.003 * k });
    if (!r.n) { toast('Nothing to smooth: select some plain lines (or clear the selection to use everything).'); return; }
    state.doc.set(r.ents); state.sel.clear(); onChange();
    toast(`Smoothed ${r.n} outline${r.n === 1 ? '' : 's'}. Sharp corners were kept. Undo if it is too much, then lower the strength.`);
  });
  $('histBtn').addEventListener('click', showHistory);
  $('histClose').addEventListener('click', () => $('histDlg').close());
  library = initLibrary({ $, state, S, SH, store, toast, TO_IN,
    addEnts: (ents, units, label) => addEntsFrom(ents, units, label),
    replaceWith: (ents, units, name) => { snapshot('before opening ' + name); state.name = name; setUnitsQuiet(units); addToDrawing(ents, true); setTab('draw'); toast(`Opened "${name}". Undo brings your previous drawing back.`); },
    download });
  $('clearBtn').addEventListener('click', () => { if (!state.doc.ents.length || confirm('Clear the whole drawing? (Undo brings it back.)')) { snapshot('before clearing'); state.doc.clear(); state.sel.clear(); onChange(); } });

  $('imgFile').addEventListener('change', (e) => {
    traceFile = e.target.files[0] || null;
    if (traceFile) { const url = URL.createObjectURL(traceFile); $('imgPrev').src = url; $('imgPrev').hidden = false; }
  });
  $('bgUse').addEventListener('click', async () => {
    if (!traceFile) { toast('Choose a picture first.'); return; }
    try { useBg(await loadBg(traceFile)); toast('Picture placed behind the grid. Use "Set size by 2 points" so it is the right size, then trace over it.'); } catch (e) { toast(e.message); }
  });
  $('bgOp').addEventListener('input', () => { if (state.bg) { state.bg.opacity = num('bgOp') / 100; draw.render(); } });
  $('bgW').addEventListener('change', () => {
    const bg = state.bg, w2 = num('bgW');
    if (!bg || !(w2 > 0)) return;
    const k = w2 / bg.width, cx = bg.x + bg.width / 2, cy = bg.y + (bg.width * bg.h / bg.w) / 2;
    bg.width = w2; bg.x = cx - w2 / 2; bg.y = cy - (w2 * bg.h / bg.w) / 2; bgSync();
  });
  $('bgRot').addEventListener('change', async () => {
    const bg = state.bg, m = $('bgRot').value;
    if (!bg || m === '0') return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = bg.w; c.height = bg.h;
      const g = c.getContext('2d');
      if (m === '1') { g.translate(bg.w, 0); g.scale(-1, 1); } else { g.translate(0, bg.h); g.scale(1, -1); }
      g.drawImage(img, 0, 0);
      bg.url = c.toDataURL('image/png'); $('bgRot').value = '0'; draw.render();
    };
    img.src = bg.url;
  });
  $('bgCal').addEventListener('click', () => draw.setTool('calib'));
  $('bgMove').addEventListener('click', () => draw.setTool('bgmove'));
  $('bgFit').addEventListener('click', () => draw.fitToBg());
  $('bgHide').addEventListener('click', () => { if (state.bg) { state.bg.visible = state.bg.visible === false; draw.render(); } });
  $('bgDel').addEventListener('click', () => { if (state.bg && confirm('Remove the picture? (Your drawing is kept.)')) { state.bg = null; bgSync(); } });
  $('imgPrev').addEventListener('click', (e) => {
    const img = $('imgPrev');
    if (!img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * img.naturalWidth), y = Math.floor(((e.clientY - r.top) / r.height) * img.naturalHeight);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const p = g.getImageData(x, y, 1, 1).data;
    pickedColor = [p[0], p[1], p[2]];
    $('imgMode').value = 'pick';
    $('pickSwatch').style.background = `rgb(${p[0]},${p[1]},${p[2]})`;
    toast(`Will trace the color you clicked (${p[0]}, ${p[1]}, ${p[2]}).`);
  });
  $('imgGo').addEventListener('click', () => traceNow().catch((e) => toast('Trace failed: ' + e.message)));

  $('viewFit').addEventListener('click', () => viewer && viewer.frame());
  $('toBuild').addEventListener('click', async () => { if (!state.model) return; await ensureModeler(); if (modeler) { modeler.loadPositions(state.model, state.name || 'Model'); setTab('model'); } });
  $('exportSTL').addEventListener('click', () => state.model && download(state.name + '.stl', M.writeSTL(state.model)));
  $('exGo').addEventListener('click', () => {
    const { loops, open } = drawingLoops();
    if (!loops.length) { $('exMsg').textContent = open ? 'The outline is not closed, so it cannot be extruded. Red circles in the Draw tab show the gaps.' : 'Draw a closed shape first.'; return; }
    const pos = M.extrudeLoops(loops, num('exDepth'));
    if (!pos.length) { $('exMsg').textContent = 'Thickness must be bigger than zero.'; return; }
    state.rawModel = null;
    setModel(pos);
    solidsUI && solidsUI.make('extrude');
    printUI && printUI.setUnits(state.units);
    $('exMsg').textContent = `Extruded ${loops.length} outline(s).${open ? ` ${open} open piece(s) were skipped.` : ''}`;
  });
  $('openModel').addEventListener('click', () => $('modelFile').click());
  $('modelFile').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('applyModel').addEventListener('click', () => {
    if (!state.rawModel) return;
    let p = M.upToZ(state.rawModel, $('upAxis').value);
    p = M.toOrigin(p);
    const want = num('mSize');
    if (want > 0) { const cur = Math.max(...M.bboxOf(p).size); if (cur > 0) p = M.toOrigin(M.scalePositions(p, want / cur)); }
    setModel(p);
  });
  document.querySelectorAll('[data-sil]').forEach((b) => b.addEventListener('click', () => profileFromModel(b.dataset.sil)));
  $('secZ').addEventListener('input', updateSecLabel);
  $('secGo').addEventListener('click', sliceModel);
  $('cvGo').addEventListener('click', carveNow);

  document.querySelectorAll('[data-opt]').forEach((el) => { el.addEventListener('input', () => state.tab === 'machine' && updateMachine()); el.addEventListener('change', () => state.tab === 'machine' && updateMachine()); });
  $('fitWidth').addEventListener('input', () => { if (num('fitWidth')) $('fitHeight').value = ''; });
  $('fitHeight').addEventListener('input', () => { if (num('fitHeight')) $('fitWidth').value = ''; });
  const sheetSvg = () => buildSheet(state.doc.ents, { units: state.units, name: state.name, startPt: state.startPt, dims: state.dims || [] });
  $('dlSheet').addEventListener('click', () => state.doc.ents.length && download(state.name + '-sheet.svg', sheetSvg(), 'image/svg+xml'));
  $('printSheet').addEventListener('click', () => {
    if (!state.doc.ents.length) { toast('Draw something first.'); return; }
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.srcdoc = `<!doctype html><html><head><style>@page{size:11in 8.5in;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${sheetSvg()}</body></html>`;
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not open the print window. Use Download sheet instead.'); } setTimeout(() => f.remove(), 60000); };
    document.body.appendChild(f);
  });
  $('clearStart').addEventListener('click', () => { state.startPt = null; updateMachine(); draw.render(); });
  initMachineSettings({ $, toast, download });
  initMachineLink({ $, toast, getTap: () => state.result && state.result.tap, getName: () => state.name, fallbackDownload: () => state.result && state.result.tap && download(state.name + '.tap', state.result.tap) });
  $('dlTap').addEventListener('click', () => state.result && state.result.tap && download(state.name + '.tap', state.result.tap));
  $('dlDxf').addEventListener('click', () => state.doc.ents.length && download(state.name + '.dxf', tapToDxf(S.toSegments(state.doc.ents), state.units)));
  $('copy').addEventListener('click', async () => {
    const text = state.result && state.result.tap ? state.result.tap : '';
    try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy G-code'), 1200);
  });

  draw.setTool('select');
  // ----- phone / tablet layout: automatic on touch devices, or with ?mobile=1 ; the desktop layout stays as it was -----
  {
    const q = new URLSearchParams(location.search); let pref = q.get('mobile');
    try { if (pref !== null) localStorage.setItem('cloudcad-mobile', pref); else pref = localStorage.getItem('cloudcad-mobile'); } catch (e) { /* ignore */ }
    const auto = !!window.CLOUD_MOBILE_DEFAULT || (window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches);
    const setMobile = (on) => { document.body.classList.toggle('mobile', on); document.body.classList.remove('showTools', 'showProps'); setTimeout(() => { draw && draw.render(); viewer && viewer.resize(); }, 50); };
    setMobile(pref === '1' ? true : pref === '0' ? false : auto);
    $('mobBtn').addEventListener('click', () => { try { localStorage.setItem('cloudcad-mobile', '0'); } catch (e) { /* ignore */ } setMobile(false); });
    const drawer = (which) => { const on = !document.body.classList.contains(which); document.body.classList.remove('showTools', 'showProps'); if (on) document.body.classList.add(which); };
    $('mTools').addEventListener('click', () => drawer('showTools')); $('mProps').addEventListener('click', () => drawer('showProps'));
    $('scrim').addEventListener('click', () => document.body.classList.remove('showTools', 'showProps'));
    $('tools').addEventListener('click', (e) => { if (e.target.closest('[data-tool]')) document.body.classList.remove('showTools'); });
    $('mUndo').addEventListener('click', () => $('undo').click()); $('mRedo').addEventListener('click', () => $('redo').click()); $('mDel').addEventListener('click', () => $('del').click()); $('mFit').addEventListener('click', () => $('fitView').click());
    $('mDone').addEventListener('click', () => document.getElementById('cv').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    window.addEventListener('resize', () => draw && draw.render());
  }
  printUI = initPrint({ $, state, toast, download });
  { const mm = $('moreMenu'); if (mm) { mm.addEventListener('click', (e) => { if (e.target.closest('.moreList button')) setTimeout(() => (mm.open = false), 0); }); document.addEventListener('click', (e) => { if (mm.open && !mm.contains(e.target)) mm.open = false; }); } }
  const cmdSearch = initCmdSearch(); if ($('cmdBtn')) $('cmdBtn').addEventListener('click', () => cmdSearch.open());
  const vf = () => import('./view3d.js');
  sheetUI = initSheet({ $, state, toast, fmt, getViewerFactory: vf, mmPerUnit: () => TO_IN[state.units] * 25.4,
    getPaths: () => { const tol = 0.002 / TO_IN[state.units]; return M.openChains(state.doc.ents, tol, tol * 5); },
    setModel: (p) => { setModel(M.toOrigin(p)); setTab('d3'); },
    addEnts: (e, u, label) => addEntsFrom(e, u, label) });
  physUI = initPhysics({ $, state, toast, getViewerFactory: vf, mmPerUnit: () => TO_IN[state.units] * 25.4 });
  solidsUI = initSolids({
    $, state, toast, fmt, getViewer: () => viewer,
    setModel: (p) => { solidFlag = true; try { setModel(p); } finally { solidFlag = false; } },
    getLoops: () => { if ($('exSel') && $('exSel').checked && state.sel.size) { const tol = 0.002 / TO_IN[state.units]; return M.loopsFromEnts(state.doc.ents.filter((e) => state.sel.has(e.id)), tol, tol * 5).loops; } return drawingLoops().loops; },
    getPaths: () => { const tol = 0.002 / TO_IN[state.units]; return M.openChains(state.doc.ents, tol, tol * 5); },
    mmPerUnit: () => TO_IN[state.units] * 25.4,
    openModelFile: (f) => f.arrayBuffer().then((b) => parseModelBuf(f.name, b)).then((p) => M.toOrigin(p)),
  });
  const help = initHelp({ setTab, setTool: (t) => draw.setTool(t) });
  try {
    const raw = localStorage.getItem('cloudcad-autosave');
    const p = raw ? JSON.parse(raw) : null;
    if (p && Array.isArray(p.ents) && p.ents.length) {
      setUnitsQuiet(['in', 'mm', 'cm', 'ft'].includes(p.units) ? p.units : 'in');
      state.doc.set(p.ents.map(({ id, ...e }) => e));
      state.startPt = p.startPt || null;
      state.dims = Array.isArray(p.dims) ? p.dims : [];
      state.restored = p.ents.length;
    }
  } catch (e) { /* ignore a broken save */ }
  onChange();
  draw.fit();
  workspaces = initWorkspaces({ $, state, S, TO_IN, getDraw: () => draw, setUnitsQuiet, onChange, bgSync, setModel, toast, setTab });
  try { const p0 = JSON.parse(localStorage.getItem('cloudcad-autosave') || 'null'); if (p0 && p0.others && p0.others.length) { workspaces.importOthers(p0.others); if (p0.name) { state.name = p0.name; workspaces.refreshLabel(); } } } catch (e) { /* ignore */ }
  let welcomed = false;
  try { welcomed = !!localStorage.getItem('cloudcad-welcomed'); } catch (e) { /* ignore */ }
  if (!welcomed && !state.restored) help.showWelcome();
  if (state.restored) toast(`Welcome back: your last drawing (${state.restored} objects) was restored. Use Clear drawing under Copies > Clean up to start fresh.`);
  window.addEventListener('beforeunload', () => { try { localStorage.setItem('cloudcad-autosave', JSON.stringify({ units: state.units, name: state.name, startPt: state.startPt || null, ents: state.doc.ents, dims: state.dims || [], others: workspaces ? workspaces.exportOthers() : [] })); } catch (e) { /* ignore */ } });
  $('emptyX').addEventListener('click', () => { hintOff = true; try { localStorage.setItem('cc_hint_off', '1'); } catch (e) { /* ok */ } syncEmpty(); });
  $('topUndo').addEventListener('click', () => $('undo').click());
  $('topRedo').addEventListener('click', () => $('redo').click());
  syncEmpty(); if ($('tabHint')) $('tabHint').textContent = TAB_HINTS.draw;
  $('bannerX').addEventListener('click', () => { $('banner').hidden = true; });
  if (window.cloudDesktop && window.cloudDesktop.onOpenFile) window.cloudDesktop.onOpenFile((name, bytes) => { try { openFile(new File([bytes], name)); } catch (e) { toast('Could not open ' + name + ': ' + (e.message || e)); } });
  window.__cloud = { get workspaces() { return workspaces; }, printUI, help, bgSync, useBg, state, draw, loadText, setTab, updateMachine, onChange, carveNow, setModel, M, S, traceNow };
}
document.addEventListener('DOMContentLoaded', init);
