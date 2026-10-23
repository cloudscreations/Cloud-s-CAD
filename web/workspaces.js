// Cloud's CAD - several drawings open at once (workstations), with copy and paste between them. License: GPL v3
import { ask } from './ask.js';

export function initWorkspaces({ $, state, S, TO_IN, getDraw, setUnitsQuiet, onChange, bgSync, setModel, toast, setTab }) {
  const list = []; let active = null, nextN = 1, clip = null;
  const bar = $('wsBar');

  const capture = (w) => { w.name = state.name; w.doc = state.doc; w.units = state.units; w.startPt = state.startPt || null; w.bg = state.bg || null; w.model = state.model; w.rawModel = state.rawModel; w.sel = state.sel; const d = getDraw(); if (d) w.view = { ...d.view }; };
  function make(name) { return { id: nextN++, name: name || 'drawing ' + (nextN - 1), doc: new S.Sketch(), units: state.units, startPt: null, bg: null, model: null, rawModel: null, sel: new Set(), view: { cx: 0, cy: 0, s: 40 }, fresh: true }; }

  function apply(w) {
    const d = getDraw();
    state.name = w.name; state.doc = w.doc; state.startPt = w.startPt; state.bg = w.bg; state.rawModel = w.rawModel; state.sel = w.sel; state.report = null; state.result = null;
    setUnitsQuiet(w.units);
    if (d) { d.setDoc(state.doc); Object.assign(d.view, w.view); }
    bgSync(); setModel(w.model);
    onChange(); if (d) d.render();
    if (w.fresh && d) { w.fresh = false; d.fit(); }
  }
  function switchTo(w) {
    if (w === active) return;
    if (active) capture(active);
    active = w; apply(w); render();
    if (document.body.dataset.tab !== 'draw' && document.body.dataset.tab !== 'd3') setTab('draw');
  }
  function add(name, from) {
    if (active) capture(active);
    const w = make(name);
    if (from) { w.units = from.units; w.doc.set(from.doc.ents.map(({ id, ...e }) => ({ ...e }))); w.startPt = from.startPt; w.fresh = true; }
    list.push(w); switchTo(w); return w;
  }
  function close(w) {
    if (list.length < 2) { toast('This is the only workstation. Use Clear drawing to start over.'); return; }
    const ents = (w === active ? state.doc : w.doc).ents.length;
    if (ents && !window.confirm(`Close "${w === active ? state.name : w.name}"? Its ${ents} objects will be lost (save it first if you need it).`)) return;
    const i = list.indexOf(w); list.splice(i, 1);
    if (w === active) { active = null; switchTo(list[Math.max(0, i - 1)]); } else render();
  }
  function rename(w) { ask('Name for this workstation:', w === active ? state.name : w.name).then((v) => { if (v && v.trim()) { if (w === active) state.name = v.trim(); w.name = v.trim(); render(); } }); }

  function render() {
    if (!bar) return;
    bar.innerHTML = '';
    list.forEach((w) => {
      const b = document.createElement('div'); b.className = 'wsTab' + (w === active ? ' on' : ''); b.title = 'Click to switch. Double-click to rename.';
      const n = document.createElement('span'); n.textContent = w === active ? state.name : w.name; n.className = 'wsName';
      const x = document.createElement('button'); x.textContent = '×'; x.className = 'wsX'; x.title = 'Close this workstation';
      b.append(n, x); bar.append(b);
      b.addEventListener('click', () => switchTo(w)); b.addEventListener('dblclick', () => rename(w));
      x.addEventListener('click', (e) => { e.stopPropagation(); close(w); });
    });
    const plus = document.createElement('button'); plus.className = 'wsAdd'; plus.textContent = '+ New'; plus.title = 'Open a blank drawing in a new workstation (Ctrl+T)';
    const dup = document.createElement('button'); dup.className = 'wsAdd'; dup.textContent = 'Duplicate'; dup.title = 'Open a copy of this drawing in a new workstation';
    const cp = document.createElement('button'); cp.className = 'wsAdd'; cp.textContent = 'Copy'; cp.title = 'Copy the selected pieces (Ctrl+C). Paste them into any workstation.';
    const ps = document.createElement('button'); ps.className = 'wsAdd'; ps.textContent = 'Paste'; ps.title = 'Paste the copied pieces here (Ctrl+V)';
    const sp = document.createElement('span'); sp.className = 'sp';
    bar.append(plus, dup, sp, cp, ps);
    plus.addEventListener('click', () => add()); dup.addEventListener('click', () => add(state.name + ' copy', { units: state.units, doc: state.doc, startPt: state.startPt }));
    cp.addEventListener('click', copySel); ps.addEventListener('click', paste);
  }
  function refreshLabel() { const el = bar && bar.querySelector('.wsTab.on .wsName'); if (el && el.textContent !== state.name) el.textContent = state.name; }

  function copySel(cut) {
    const ids = [...state.sel]; if (!ids.length) { toast('Select some pieces first, then Copy.'); return; }
    const pick = state.doc.ents.filter((e) => state.sel.has(e.id));
    clip = { units: state.units, from: active, ents: pick.map(({ id, ...e }) => ({ ...e })) };
    toast(`Copied ${pick.length} piece${pick.length === 1 ? '' : 's'}. Switch to another workstation and press Paste (Ctrl+V).`);
    if (cut === true) { state.doc.set(S.remove(state.doc.ents, ids)); state.sel.clear(); onChange(); getDraw().render(); }
  }
  function paste() {
    if (!clip) { toast('Nothing copied yet. Select pieces and press Copy first.'); return; }
    let ents = clip.ents.map((e) => ({ ...e }));
    const sp = new Map(); ents.forEach((e) => { if (e.sp !== undefined) { if (!sp.has(e.sp)) sp.set(e.sp, S.newCurveId()); e.sp = sp.get(e.sp); } });
    const k = TO_IN[clip.units] / TO_IN[state.units];
    const tmp = new S.Sketch(); tmp.set(ents);
    let out = Math.abs(k - 1) > 1e-12 ? S.scaleEnts(tmp.ents, tmp.ents.map((e) => e.id), [0, 0], k) : tmp.ents;
    const off = clip.from === active ? 0.25 / TO_IN[state.units] : 0;   // pasting into the same drawing: nudge so it is not hidden on top
    out = out.map(({ id, ...e }) => e);
    if (off) { const t = new S.Sketch(); t.set(out); out = S.move(t.ents, t.ents.map((e) => e.id), off, -off).map(({ id, ...e }) => e); }
    const before = new Set(state.doc.ents.map((e) => e.id));
    state.doc.add(out); state.sel.clear(); state.doc.ents.forEach((e) => { if (!before.has(e.id)) state.sel.add(e.id); });
    onChange(); getDraw().render();
    toast(`Pasted ${out.length} piece${out.length === 1 ? '' : 's'}${clip.units !== state.units ? ` (converted from ${clip.units})` : ''}. They are selected. Undo removes them.`);
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (document.body.dataset.tab !== 'draw') return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!ctrl) return;
    if (k === 'c') { e.preventDefault(); copySel(); } else if (k === 'x') { e.preventDefault(); copySel(true); } else if (k === 'v') { e.preventDefault(); paste(); } else if (k === 't') { e.preventDefault(); add(); }
    else if (e.altKey === false && k === 'tab') { e.preventDefault(); const i = list.indexOf(active); switchTo(list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]); }
  });

  // start with the drawing that is already open
  const first = make(state.name); first.fresh = false; first.doc = state.doc; first.units = state.units; first.sel = state.sel; first.startPt = state.startPt || null; first.bg = state.bg || null; first.model = state.model;
  list.push(first); active = first; render();
  const exportOthers = () => list.filter((w) => w !== active).map((w) => ({ name: w.name, units: w.units, startPt: w.startPt, ents: w.doc.ents.map(({ id, ...e }) => e) }));
  function importOthers(arr) { for (const o of arr || []) { const w = make(o.name); w.units = ['in', 'mm', 'cm', 'ft'].includes(o.units) ? o.units : 'in'; w.startPt = o.startPt || null; w.doc.set((o.ents || []).map((e) => ({ ...e }))); w.fresh = true; list.push(w); } render(); }
  return { exportOthers, importOthers, add, switchTo, copySel, paste, refreshLabel, render, get list() { return list; }, get active() { return active; } };
}
