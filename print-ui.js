// Cloud's CAD - the 3D Print tab (slice a model, preview it, run a printer). License: GPL v3
import { sliceAsync, placeModel, mergeSettings } from './slicer.js';
import { buildStl, buildPrusaIni, parseGcode, buildCuraSettings, centerForCura } from './extslicer.js';
import { PRINTERS, MATERIALS, QUALITIES, BASE_SPEEDS } from './printprofiles.js';
import { SerialPrinter, openWebSerial, Moonraker, OctoPrint, browserHttp } from './printer.js';

const UNIT_MM = { mm: 1, in: 25.4, cm: 10 };
const TYPE_COLOR = { outer: '#f4a62a', wall: '#b9772a', infill: '#5aa9c9', solid: '#3fb8a4', support: '#d05fb0', skirt: '#9aa3b2' };
// [element id, settings path, kind, to-setting, to-field]
const FIELDS = [
  ['pLayer', 'layerHeight'], ['pFirst', 'firstLayerHeight'], ['pWidth', 'lineWidth'], ['pWalls', 'walls'], ['pTop', 'topThickness'], ['pBottom', 'bottomThickness'],
  ['pInfill', 'infillDensity', 'num', (v) => v / 100, (v) => Math.round(v * 100)], ['pPattern', 'infillPattern', 'str'], ['pSupAngle', 'supportAngle'],
  ['pNozzle', 'nozzleTemp'], ['pNozzle1', 'firstLayerNozzleTemp'], ['pBed', 'bedTemp'], ['pFan', 'fan'],
  ['pSpOuter', 'speed.outerWall'], ['pSpWall', 'speed.wall'], ['pSpInfill', 'speed.infill'], ['pSpTravel', 'speed.travel'], ['pSpFirst', 'speed.firstLayer'],
  ['pBrimW', 'brimWidth'], ['pRetract', 'retractDist'], ['pRetractSp', 'retractSpeed'], ['pZhop', 'zHop'],
  ['pFlow', 'flow', 'num', (v) => v / 100, (v) => Math.round(v * 100)],
  ['pBedX', 'bed.x'], ['pBedY', 'bed.y'], ['pBedZ', 'bed.z'],
  ['pRelE', 'relativeE', 'bool'], ['pCenter', 'originCenter', 'bool'], ['pSupport', 'support', 'bool'], ['pAdhesion', 'adhesion', 'str'],
  ['pStart', 'startGcode', 'str'], ['pEnd', 'endGcode', 'str'],
];
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] = a[ks[i]] || {}; a[ks[ks.length - 1]] = v; };
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const html = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function initPrint({ $, state, toast, download }) {
  const P = { result: null, layer: 0, rot: [0, 0, 0], conn: null, poll: null, busy: false, lastStatus: null };
  const el = (id) => $(id);

  // ---------- selects and presets ----------
  const fill = (id, obj) => { el(id).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${html(v.name)}</option>`).join(''); };
  fill('pPrinter', PRINTERS); fill('pMaterial', MATERIALS); fill('pQuality', QUALITIES);
  el('pQuality').value = 'standard';
  const putField = (id, val) => { const e = el(id); if (e.type === 'checkbox') e.checked = !!val; else e.value = val; };
  const getField = (id) => { const e = el(id); return e.type === 'checkbox' ? e.checked : e.value; };
  function applyPreset() {
    const pr = PRINTERS[el('pPrinter').value], ma = MATERIALS[el('pMaterial').value], q = QUALITIES[el('pQuality').value];
    const s = mergeSettings({});
    Object.assign(s, q, { bed: { ...pr.bed }, retractDist: +(pr.retractDist * ma.retractScale).toFixed(2), retractSpeed: pr.retractSpeed, relativeE: pr.relativeE, originCenter: false,
      nozzleTemp: ma.nozzleTemp, firstLayerNozzleTemp: ma.firstLayerNozzleTemp, bedTemp: ma.bedTemp, fan: ma.fan, density: ma.density, support: el('pSupport').checked, adhesion: el('pAdhesion').value });
    s.speed = {}; for (const [k, v] of Object.entries(BASE_SPEEDS)) s.speed[k] = Math.round(v * (k === 'travel' || k === 'zMove' ? Math.min(1, ma.speedScale + 0.3) : ma.speedScale));
    for (const [id, path, kind, , toField] of FIELDS) { if (['pSupport', 'pAdhesion', 'pStart', 'pEnd', 'pCenter'].includes(id)) continue; const v = getPath(s, path); putField(id, toField ? toField(v) : v); }
    el('pCenter').checked = false;
    el('pMatNote').textContent = ma.note;
    invalidate(); save(); refresh();
  }
  function readSettings() {
    const o = {};
    for (const [id, path, kind, toSet] of FIELDS) {
      let v = getField(id);
      if (kind === 'bool') v = !!v; else if (kind === 'str') v = String(v); else { v = parseFloat(v); if (!Number.isFinite(v)) continue; if (toSet) v = toSet(v); }
      setPath(o, path, v);
    }
    o.density = MATERIALS[el('pMaterial').value].density;
    return o;
  }

  // ---------- the model on the bed ----------
  function placed() {
    if (!state.model || !state.model.length) return null;
    const s = readSettings();
    const k = UNIT_MM[el('pUnits').value] * ((parseFloat(el('pScale').value) || 100) / 100);
    return placeModel(state.model, { scale: k, rotX: P.rot[0], rotY: P.rot[1], rotZ: P.rot[2], bed: s.bed, originCenter: s.originCenter, dx: parseFloat(el('pDx').value) || 0, dy: parseFloat(el('pDy').value) || 0 });
  }
  function describe() {
    const pm = placed(), box = el('pModelInfo');
    if (!pm) { box.textContent = 'No model yet. Open an STL/OBJ in the 3D tab, extrude your drawing, or use Open file.'; el('pSlice').disabled = false; return pm; }
    const s = readSettings();
    box.innerHTML = `<b>${pm.size.map((v) => v.toFixed(1)).join(' x ')} mm</b> (X x Y x Z) &nbsp; ${pm.fits ? '<span style="color:#3fb8a4">fits the bed</span>' : `<span style="color:#e76f51">too big for the ${s.bed.x} x ${s.bed.y} x ${s.bed.z} bed. Use Fit to bed or lower Size %.</span>`}`;
    if (document.activeElement !== el('pLongest')) el('pLongest').value = Math.max(...pm.size).toFixed(1);
    return pm;
  }
  function invalidate() { P.result = null; P.layer = 0; el('pSave').disabled = true; el('pStats').textContent = ''; el('pWarn').innerHTML = ''; const sl = el('pvLayer'); sl.disabled = true; sl.max = 0; el('pvLayerTxt').textContent = ''; updateStartBtn(); }

  // ---------- preview ----------
  const cv = el('pvCanvas');
  function drawPreview() {
    if (document.body.dataset.tab !== 'print') return;
    const wrap = el('pvWrap'); const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    const W = Math.max(50, Math.round(r.width || wrap.clientWidth || 600)), H = Math.max(50, Math.round(r.height || 400));
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext && cv.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.body), bg = css.getPropertyValue('--cv-bg').trim() || '#14110d', dot = css.getPropertyValue('--cv-dotmajor').trim() || '#555', ink = css.getPropertyValue('--cv-lbl').trim() || '#ccc';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const s = readSettings(), bx = s.bed.x, by = s.bed.y, ox = s.originCenter ? -bx / 2 : 0, oy = s.originCenter ? -by / 2 : 0;
    const pad = 28;
    let sc = Math.min((W - pad * 2) / bx, (H - pad * 2) / by);
    let X = (x) => pad + (x - ox) * sc + (W - pad * 2 - bx * sc) / 2, Y = (y) => H - pad - (y - oy) * sc - (H - pad * 2 - by * sc) / 2;
    if (P.result && P.bounds) {                                  // once sliced, zoom in on the part
      const b = P.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      sc = Math.min((W - pad * 2) / Math.max(1, (b.x1 - b.x0) * 1.2), (H - pad * 2) / Math.max(1, (b.y1 - b.y0) * 1.2));
      X = (x) => W / 2 + (x - cx) * sc; Y = (y) => H / 2 - (y - cy) * sc;
    }
    g.strokeStyle = dot; g.lineWidth = 1; g.strokeRect(X(ox), Y(oy + by), bx * sc, by * sc);
    g.fillStyle = dot; g.globalAlpha = 0.5;
    for (let x = 0; x <= bx; x += 10) for (let y = 0; y <= by; y += 10) g.fillRect(X(ox + x) - 0.5, Y(oy + y) - 0.5, 1, 1);
    g.globalAlpha = 1; g.fillStyle = ink; g.font = '11px system-ui'; g.fillText(`${bx} x ${by} mm bed`, 10, H - 8);
    if (P.result) {
      const layers = P.result.layers, cur = Math.min(P.layer, layers.length - 1);
      const lo = el('pvLower').checked ? Math.max(0, cur - 6) : cur;
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = lo; i <= cur; i++) {
        const faint = i < cur; g.globalAlpha = faint ? 0.12 + 0.1 * ((i - lo) / Math.max(1, cur - lo)) : 1;
        g.lineWidth = Math.max(1, s.lineWidth * sc * (faint ? 0.8 : 1));
        const byType = {};
        for (const p of layers[i].paths) (byType[p.t] = byType[p.t] || []).push(p.p);
        for (const [t, list] of Object.entries(byType)) {
          g.strokeStyle = TYPE_COLOR[t] || '#aaa'; g.beginPath();
          for (const p of list) { g.moveTo(X(p[0]), Y(p[1])); for (let k = 2; k < p.length; k += 2) g.lineTo(X(p[k]), Y(p[k + 1])); }
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      el('pvLayerTxt').textContent = `Layer ${cur + 1} of ${layers.length}, height ${layers[cur].z.toFixed(2)} mm`;
    } else {
      const pm = placed();
      if (pm) {
        const xs = [], ys = [];
        for (let i = 0; i < pm.pos.length; i += 3) { xs.push(pm.pos[i]); ys.push(pm.pos[i + 1]); }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const v of xs) { if (v < x0) x0 = v; if (v > x1) x1 = v; } for (const v of ys) { if (v < y0) y0 = v; if (v > y1) y1 = v; }
        const ox2 = s.originCenter ? 0 : 0;
        g.fillStyle = pm.fits ? 'rgba(244,166,42,.25)' : 'rgba(231,111,81,.3)'; g.strokeStyle = pm.fits ? '#f4a62a' : '#e76f51';
        g.fillRect(X(x0 + ox2), Y(y1), (x1 - x0) * sc, (y1 - y0) * sc); g.strokeRect(X(x0 + ox2), Y(y1), (x1 - x0) * sc, (y1 - y0) * sc);
        g.fillStyle = ink; g.fillText('Footprint on the bed. Press "Slice the model" to see the layers.', pad, 16);
      } else { g.fillStyle = ink; g.font = '14px system-ui'; g.fillText('Open or make a 3D model first (3D tab), then come back here.', pad, 30); }
    }
  }
  const redraw = () => requestAnimationFrame(drawPreview);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(el('pvWrap'));
  el('pvLayer').addEventListener('input', () => { P.layer = +el('pvLayer').value; drawPreview(); });
  el('pvLower').addEventListener('change', drawPreview);

  // ---------- slicing ----------
  async function doSlice() {
    if (P.busy) { P.cancel = true; if (window.cloudDesktop && window.cloudDesktop.slicer) window.cloudDesktop.slicer.cancel(); if (window.cloudDesktop.cura) window.cloudDesktop.cura.cancel(); return; }
    const pm = placed();
    if (!pm) { toast('Open or make a 3D model first.'); return; }
    if (!pm.fits) { el('pWarn').innerHTML = '<div class="msg err">The model is bigger than the bed. Use "Fit to bed" or lower Size %.</div>'; return; }
    const s = readSettings();
    P.busy = true; P.cancel = false; invalidate();
    el('pSlice').textContent = 'Cancel slicing';
    try {
      let res;
      if (el('pEngine').value === 'cura' && window.cloudDesktop && window.cloudDesktop.cura) {
        el('pProg').textContent = 'Cura engine is working...';
        window.cloudDesktop.cura.onProgress((v) => { if (P.busy) el('pProg').textContent = `${Math.round(v)}%  Cura engine`; });
        const r = await window.cloudDesktop.cura.run(buildStl(centerForCura(pm.pos, s)), buildCuraSettings(s));
        if (P.cancel) throw new Error('Cancelled.');
        if (!r.ok) throw new Error('The Cura engine could not slice this model. ' + String(r.log || '').slice(0, 200));
        res = parseGcode(r.gcode, { filamentDia: s.filamentDia, density: s.density });
        if (!res.layers.length) throw new Error(res.warnings[0]);
      } else if (el('pEngine').value === 'prusa' && P.slicerPath) {
        el('pProg').textContent = 'PrusaSlicer is working...';
        const r = await window.cloudDesktop.slicer.run(buildStl(pm.pos), buildPrusaIni(s), 900000);
        if (P.cancel) throw new Error('Cancelled.');
        if (!r.ok) throw new Error('PrusaSlicer could not slice this model. ' + String(r.log || '').split('\n').filter((l) => /error|fail|manifold|empty|cannot/i.test(l)).slice(0, 3).join(' '));
        res = parseGcode(r.gcode, { filamentDia: s.filamentDia, density: s.density });
        if (!res.layers.length) throw new Error(res.warnings[0]);
      } else res = await sliceAsync(pm.pos, s, (f, msg) => { el('pProg').textContent = `${Math.round(f * 100)}%  ${msg}`; }, () => P.cancel);
      P.result = res; P.settings = s; P.layer = 0;
      { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const L of res.layers) for (const pa of L.paths) for (let k = 0; k < pa.p.length; k += 2) { const x = pa.p[k], y = pa.p[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } P.bounds = { x0, y0, x1, y1 }; }
      const st = res.stats;
      el('pStats').innerHTML = `<b>${st.layers}</b> layers, <b>${fmtTime(st.seconds)}</b>, <b>${st.filamentMeters.toFixed(1)} m</b> of filament (about <b>${st.grams.toFixed(0)} g</b>).<br>Estimates are rough: speed limits in your printer's firmware change the real time.`;
      el('pWarn').innerHTML = res.warnings.map((w) => `<div class="msg warn">${html(w)}</div>`).join('');
      const sl = el('pvLayer'); sl.max = st.layers - 1; sl.value = Math.min(st.layers - 1, 0); sl.disabled = false; P.layer = 0;
      el('pSave').disabled = false; el('pProg').textContent = 'Done.'; updateStartBtn();
    } catch (e) { el('pProg').textContent = ''; el('pWarn').innerHTML = `<div class="msg err">${html(e.message || e)}</div>`; }
    P.busy = false; el('pSlice').textContent = 'Slice the model'; drawPreview();
  }
  el('pSlice').addEventListener('click', doSlice);
  const gname = () => (state.name || 'model').replace(/[^\w.-]+/g, '_') + '.gcode';
  el('pSave').addEventListener('click', () => { if (P.result) download(gname(), P.result.gcode, 'text/plain'); });

  // ---------- inputs ----------
  function onEdit() { invalidate(); save(); describe(); drawPreview(); }
  for (const [id] of FIELDS) el(id).addEventListener(el(id).type === 'checkbox' || el(id).tagName === 'SELECT' ? 'change' : 'input', onEdit);
  ['pPrinter', 'pMaterial', 'pQuality'].forEach((id) => el(id).addEventListener('change', applyPreset));
  el('pUnits').addEventListener('change', onEdit); el('pScale').addEventListener('input', onEdit); el('pDx').addEventListener('input', onEdit); el('pDy').addEventListener('input', onEdit);
  el('pLongest').addEventListener('input', () => {
    const pm = state.model && state.model.length ? placeModel(state.model, { scale: UNIT_MM[el('pUnits').value] }) : null;
    const want = parseFloat(el('pLongest').value);
    if (pm && want > 0) { el('pScale').value = ((want / Math.max(...pm.size)) * 100).toFixed(2); invalidate(); describe(); drawPreview(); save(); }
  });
  el('pFitBed').addEventListener('click', () => {
    if (!state.model) return;
    const s = readSettings(), base = placeModel(state.model, { scale: UNIT_MM[el('pUnits').value], rotX: P.rot[0], rotY: P.rot[1], rotZ: P.rot[2], bed: s.bed });
    const k = Math.min(s.bed.x / base.size[0], s.bed.y / base.size[1], s.bed.z / base.size[2]) * 0.97;
    el('pScale').value = (k * 100).toFixed(2); el('pLongest').value = ''; onEdit();
  });
  document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => { P.rot[{ x: 0, y: 1, z: 2 }[b.dataset.rot]] = (P.rot[{ x: 0, y: 1, z: 2 }[b.dataset.rot]] + 90) % 360; onEdit(); }));
  el('pRotReset').addEventListener('click', () => { P.rot = [0, 0, 0]; onEdit(); });
  el('pResetAll').addEventListener('click', () => { try { localStorage.removeItem('cloudcad-print'); } catch (e) { /* */ } el('pStart').value = ''; el('pEnd').value = ''; el('pSupport').checked = false; el('pAdhesion').value = 'skirt'; applyPreset(); });

  // ---------- remembering settings ----------
  function save() {
    try { localStorage.setItem('cloudcad-print', JSON.stringify({ printer: el('pPrinter').value, material: el('pMaterial').value, quality: el('pQuality').value, f: Object.fromEntries(FIELDS.map(([id]) => [id, getField(id)])), host: el('cHost').value, kind: el('cKind').value })); } catch (e) { /* private window */ }
  }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem('cloudcad-print') || 'null');
      if (!o) return false;
      el('pPrinter').value = o.printer in PRINTERS ? o.printer : 'generic'; el('pMaterial').value = o.material in MATERIALS ? o.material : 'pla'; el('pQuality').value = o.quality in QUALITIES ? o.quality : 'standard';
      for (const [id, v] of Object.entries(o.f || {})) if (el(id)) putField(id, v);
      if (o.host) el('cHost').value = o.host; if (o.kind) { el('cKind').value = o.kind; }
      el('pMatNote').textContent = MATERIALS[el('pMaterial').value].note;
      return true;
    } catch (e) { return false; }
  }
  if (!load()) applyPreset();

  // ---------- optional external slicer (desktop app only) ----------
  const ds = window.cloudDesktop && window.cloudDesktop.slicer;
  if (!ds) { el('pEngineBox').hidden = false; el('pEngine').hidden = true; el('pEngine').previousElementSibling.hidden = true; el('pEngineNote').textContent = 'This is the basic slicer. The desktop app has the full Cura slicing engine built in (better supports, bridging and walls).'; }
  if (ds) {
    el('pEngineBox').hidden = false;
    const showEngine = () => {
      const v = el('pEngine').value, on = v === 'prusa';
      el('pFindSlicer').hidden = !on || !!P.slicerPath;
      el('pEngineNote').textContent = v === 'cura' ? 'Cura engine (the same slicer inside Ultimaker Cura) is built into this app. Your settings above are sent to it.' : v === 'builtin' ? 'The basic slicer is simple: no bridging or fancy supports. Use it only if the others fail.'
        : P.slicerPath ? 'Using ' + P.slicerPath + '. Your settings above are sent to it.' : 'PrusaSlicer was not found. Install it from prusa3d.com, then press Find.';
    };
    const refreshSlicer = async () => { try { P.slicerPath = (await ds.info()).path; } catch (e) { P.slicerPath = null; } showEngine(); };
    el('pEngine').addEventListener('change', () => { try { localStorage.setItem('cloudcad-engine-set', '1'); localStorage.setItem('cloudcad-engine', el('pEngine').value); } catch (e) { /* ignore */ } showEngine(); invalidate(); });
    el('pFindSlicer').addEventListener('click', async () => { try { P.slicerPath = (await ds.choose()).path; } catch (e) { /* ignore */ } showEngine(); });
    try { const sv = localStorage.getItem('cloudcad-engine'); if (sv) el('pEngine').value = sv; } catch (e) { /* ignore */ }
    refreshSlicer();
  }

  // ================= the printer =================
  const log = (d, l) => { const pre = el('cLog'); pre.textContent += `${d} ${l}\n`; if (pre.textContent.length > 20000) pre.textContent = pre.textContent.slice(-12000); pre.scrollTop = pre.scrollHeight; };
  const msg = (t, bad) => { el('cMsg').textContent = t || ''; el('cMsg').style.color = bad ? '#e76f51' : ''; };
  const netHttp = () => (window.cloudDesktop && window.cloudDesktop.http ? (req) => window.cloudDesktop.http(req) : browserHttp());
  function kindChanged() { const k = el('cKind').value; el('cNet').hidden = k === 'serial'; el('cUsb').hidden = k !== 'serial'; el('cUpload').hidden = k === 'serial'; }
  el('cKind').addEventListener('change', () => { kindChanged(); save(); }); kindChanged();
  el('cHost').addEventListener('change', save);
  function showStatus(st) {
    P.lastStatus = st;
    el('cLive').hidden = !P.conn;
    if (!st) return;
    const stateTxt = { idle: 'Ready', printing: 'Printing', paused: 'Paused', error: 'Error', disconnected: 'Not connected', connecting: 'Connecting' }[st.state] || st.state;
    el('cState').textContent = `${stateTxt}${st.file && st.state !== 'idle' ? ': ' + st.file : ''}${st.state === 'printing' || st.state === 'paused' ? ` ${Math.round(st.progress * 100)}%` : ''}${st.error && st.state === 'error' ? ' - ' + st.error : ''}`;
    el('cState').className = 'msg ' + (st.state === 'error' ? 'err' : st.state === 'printing' ? 'warn' : 'info');
    el('cTemps').textContent = `Nozzle ${st.temps.hotend.toFixed(0)} / ${st.temps.hotendTarget.toFixed(0)} °C     Bed ${st.temps.bed.toFixed(0)} / ${st.temps.bedTarget.toFixed(0)} °C`;
    el('cBar').style.width = Math.round((st.progress || 0) * 100) + '%';
  }
  function updateStartBtn() { el('cStart').disabled = !P.conn || !P.result; el('cUpload').disabled = !P.conn || !P.result; }
  async function connect() {
    const k = el('cKind').value; msg('Connecting...');
    try {
      let c;
      if (k === 'serial') {
        const tr = await (window.__openSerial || openWebSerial)(parseInt(el('cBaud').value, 10));
        c = new SerialPrinter(tr, { log }); c.onChange = showStatus; await c.connect();
      } else {
        const host = el('cHost').value.trim(); if (!host) throw new Error('Type the printer\'s address first.');
        c = k === 'moonraker' ? new Moonraker(host, netHttp(), { apiKey: el('cKey').value }) : new OctoPrint(host, netHttp(), { apiKey: el('cKey').value });
        await c.connect();
        const poll = async () => { try { showStatus(await c.status()); } catch (e) { msg('Lost contact with the printer: ' + e.message, true); } };
        await poll(); P.poll = setInterval(poll, 2000);
      }
      P.conn = c; el('cConnect').disabled = true; el('cDisconnect').disabled = false; msg('Connected.'); showStatus(c.status ? (k === 'serial' ? c.status() : P.lastStatus) : null); updateStartBtn(); save();
    } catch (e) { msg(e.message || String(e), true); P.conn = null; }
  }
  async function disconnect() {
    clearInterval(P.poll); try { P.conn && (await P.conn.disconnect()); } catch (e) { /* */ }
    P.conn = null; el('cLive').hidden = true; el('cConnect').disabled = false; el('cDisconnect').disabled = true; msg('Disconnected.'); updateStartBtn();
  }
  el('cConnect').addEventListener('click', connect); el('cDisconnect').addEventListener('click', disconnect);
  const run = (fn) => async () => { if (!P.conn) return; try { await fn(P.conn); msg(''); } catch (e) { msg(e.message || String(e), true); } };
  const step = () => parseFloat(el('cStep').value) || 10;
  document.querySelectorAll('[data-jog]').forEach((b) => b.addEventListener('click', run(async (c) => {
    const j = b.dataset.jog;
    if (j === 'home') return c.home();
    const ax = j[0], sign = j[1] === '-' ? -1 : 1;
    return c.jog(ax, sign * step(), ax === 'z' ? 600 : 3000);
  })));
  el('cHomeXY').addEventListener('click', run((c) => c.home('xy'))); el('cHomeZ').addEventListener('click', run((c) => c.home('z')));
  const feed = (mm) => (c) => (c.extrude ? c.extrude(mm) : c.gcode(c instanceof Moonraker ? `M83\nG1 E${mm} F150` : ['M83', `G1 E${mm} F150`]));
  const hotOK = () => { const t = parseFloat(el('cHot').value); return t; };
  el('cExt').addEventListener('click', run(async (c) => { if (P.lastStatus && P.lastStatus.temps.hotend < 170) throw new Error('Heat the nozzle first (at least 170 °C), or the extruder can break.'); return feed(5)(c); }));
  el('cRet').addEventListener('click', run(async (c) => { if (P.lastStatus && P.lastStatus.temps.hotend < 170) throw new Error('Heat the nozzle first (at least 170 °C).'); return feed(-5)(c); }));
  el('cHotSet').addEventListener('click', run((c) => c.setHotend(hotOK()))); el('cBedSet').addEventListener('click', run((c) => c.setBed(parseFloat(el('cBedT').value))));
  el('cPreheat').addEventListener('click', run(async (c) => { const s = readSettings(); el('cHot').value = s.nozzleTemp; el('cBedT').value = s.bedTemp; await c.setBed(s.bedTemp); return c.setHotend(s.nozzleTemp); }));
  el('cCool').addEventListener('click', run((c) => c.heatOff())); el('cFanSet').addEventListener('click', run((c) => c.fan(parseFloat(el('cFan').value) || 0)));
  el('cMotors').addEventListener('click', run((c) => c.motorsOff()));
  el('cPause').addEventListener('click', run((c) => c.pause())); el('cResume').addEventListener('click', run((c) => c.resume()));
  el('cCancel').addEventListener('click', run(async (c) => { if (confirm('Stop this print? The heaters will turn off.')) await c.cancel(); }));
  el('cEstop').addEventListener('click', async () => { if (!P.conn) return; try { await P.conn.emergencyStop(); msg('EMERGENCY STOP sent. Power-cycle the printer before using it again.', true); } catch (e) { msg(e.message, true); } });
  el('cStart').addEventListener('click', run(async (c) => {
    if (!P.result) throw new Error('Slice the model first.');
    if (!confirm(`Start printing "${gname()}"?\n\nCheck: the bed is clear, filament is loaded, and you will stay near the printer for the first layers.`)) return;
    if (c.startPrint) c.startPrint(P.result.gcode, gname()); else { await c.upload(gname(), P.result.gcode, { print: true }); msg('Sent to the printer. It starts printing now.'); }
  }));
  el('cUpload').addEventListener('click', run(async (c) => { if (!P.result) throw new Error('Slice the model first.'); await c.upload(gname(), P.result.gcode, { print: false }); msg(`Uploaded ${gname()}. Start it from the printer's own screen or web page.`); }));
  el('cCmd').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim() && P.conn) { const cmd = e.target.value.trim(); e.target.value = ''; (P.conn.send ? P.conn.send(cmd) : P.conn.gcode(cmd)).catch((er) => msg(er.message, true)); log('>', cmd); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.busy) P.cancel = true; });

  function refresh() { describe(); drawPreview(); updateStartBtn(); }
  return { refresh, state: P, applyPreset, readSettings, doSlice, connect, disconnect, drawPreview, setUnits: (u) => { if (UNIT_MM[u]) { el('pUnits').value = u; onEdit(); } } };
}
