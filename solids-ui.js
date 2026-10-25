// Cloud's CAD - 3D tab panels: make solids, edit history, print check, arrange. License: GPL v3
import { evaluate, BASES, STEPS } from './features.js';
import { reorient, arrangePieces, splitBodies } from './printcheck.js';
import { SCREWS } from './solids.js';
import { runChecks, combineModels, repairModel, cancelWork } from './solids-client.js';
import * as M from './mesh.js';

export function initSolids({ $, state, getViewer, setModel, getLoops, getPaths, toast, mmPerUnit, fmt, openModelFile }) {
  let recipe = null, token = 0, timer = null, prev = null, checkRes = null;
  const busy = (on, msg) => { $('sbCancel').hidden = !on; $('sbMsg').textContent = msg || ''; $('sbMsg').className = 'small hint'; document.body.style.cursor = on ? 'progress' : ''; };
  const err = (m) => { $('sbMsg').textContent = m; $('sbMsg').className = 'small hint err'; };
  const dflt = () => { const b = state.model ? M.bboxOf(state.model) : null; const m = b ? Math.min(...b.size.filter((v) => v > 0)) : 1; return Math.max(+(m * 0.1).toPrecision(2), 1e-4); };

  function render() {
    const box = $('hist'); box.innerHTML = '';
    if (!recipe) { box.innerHTML = '<div class="small hint">Make a solid above, or open a model, and its steps show here. Change any number to rebuild.</div>'; return; }
    const row = (title, def, vals, onChange, onDelete, bad) => {
      const d = document.createElement('div'); d.className = 'hrow' + (bad ? ' bad' : '');
      const t = document.createElement('div'); t.className = 'ht'; t.textContent = title; d.appendChild(t);
      const f = document.createElement('div'); f.className = 'hf';
      for (const fld of def.fields) {
        if (fld.hidden) continue;
        const l = document.createElement('label'); l.textContent = fld.label + (fld.unit === 'u' ? ' (' + state.units + ')' : fld.unit ? ' ' + fld.unit : '');
        const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.value = vals[fld.k];
        i.addEventListener('input', () => { const v = parseFloat(i.value); if (isFinite(v)) { vals[fld.k] = v; onChange(); } });
        l.appendChild(i); f.appendChild(l);
      }
      d.appendChild(f);
      if (onDelete) { const x = document.createElement('button'); x.className = 'hx'; x.textContent = '✕'; x.title = 'Remove this step'; x.addEventListener('click', onDelete); d.appendChild(x); }
      box.appendChild(d);
    };
    row('1. ' + BASES[recipe.base.kind].label, BASES[recipe.base.kind], recipe.base, schedule, null, recipe.errAt === -1);
    recipe.steps.forEach((s, i) => row(i + 2 + '. ' + STEPS[s.kind].label, STEPS[s.kind], s, schedule, () => { recipe.steps.splice(i, 1); schedule(0); render(); }, recipe.errAt === i));
  }
  function schedule(ms = 350) { clearTimeout(timer); timer = setTimeout(rebuild, ms); }
  async function rebuild() {
    if (!recipe) return;
    const my = ++token; busy(true, 'Rebuilding…');
    try {
      const pos = await evaluate(recipe, { loops: getLoops(), paths: getPaths(), baseModel: recipe.baseModel });
      if (my !== token || !recipe) return;
      recipe.errAt = null; setModel(pos); busy(false, '');
      document.querySelectorAll('#hist .hrow.bad').forEach((e) => e.classList.remove('bad'));
      checkRes = null; $('pcOut').innerHTML = ''; getViewer() && getViewer().setOverlay([]);
    } catch (e) {
      if (my !== token || !recipe) return;
      recipe.errAt = e.step === undefined ? -1 : e.step; busy(false); err(e.message || String(e));
      render();
    }
  }
  const remember = () => { prev = state.model ? { model: state.model, recipe: recipe ? JSON.parse(JSON.stringify({ ...recipe, baseModel: undefined })) : null, baseModel: recipe && recipe.baseModel } : null; $('sbUndo').disabled = !prev; };

  function make(kind) {
    remember();
    const k = kind || $('sbKind').value, base = { kind: k };
    if (k === 'extrude') base.depth = parseFloat($('exDepth').value) || dflt();
    if (k === 'revolve') base.degrees = 360;
    if (k === 'loft') { const b = M.bboxOf(state.model || new Float32Array(0)); base.height = parseFloat($('exDepth').value) || 2; }
    recipe = { base, steps: [] }; render(); rebuild();
  }
  function fromModel() { // an opened/edited model becomes the base so steps can be added
    if (recipe && recipe.base.kind === 'model') return;
    remember();
    recipe = { base: { kind: 'model' }, steps: [], baseModel: state.model }; render();
  }
  function addStep() {
    if (!state.model) { err('Make or open a model first.'); return; }
    if (!recipe) fromModel();
    const kind = $('stKind').value, d = dflt(), s = { kind };
    if (kind === 'round' || kind === 'roundIn') s.r = d;
    if (kind === 'chamfer') s.d = d;
    if (kind === 'shell' || kind === 'cup') s.t = d;
    if (kind === 'offset') s.d = +(0.2 / mmPerUnit()).toPrecision(2);
    if (kind === 'hole') { const b = M.bboxOf(state.model); const sc = SCREWS[$('stScrew').value]; s.x = +(b.size[0] / 2).toPrecision(4); s.y = +(b.size[1] / 2).toPrecision(4); s.dia = +(($('stTap').checked ? sc.tap : sc.clear) / mmPerUnit()).toPrecision(3); s.depth = 0; }
    remember(); recipe.steps.push(s); render(); rebuild();
  }

  $('sbCancel').addEventListener('click', () => { token++; cancelWork(); busy(false); $('sbMsg').textContent = 'Stopped. Your last good model is still shown.'; $('pcOut').textContent = ''; });
  $('sbGo').addEventListener('click', () => make());
  $('stAdd').addEventListener('click', addStep);
  $('stKind').addEventListener('change', () => { $('stScrewRow').hidden = $('stKind').value !== 'hole'; });
  $('sbUndo').addEventListener('click', () => {
    if (!prev) return; token++; const p = prev; prev = null; $('sbUndo').disabled = true;
    recipe = p.recipe ? { ...p.recipe, baseModel: p.baseModel } : null; setModel(p.model); render(); $('sbMsg').textContent = 'Went back one change.';
  });

  // ---- print check
  const bed = () => ({ x: parseFloat($('pBedX').value) || 220, y: parseFloat($('pBedY').value) || 220, z: parseFloat($('pBedZ').value) || 250 });
  $('pcGo').addEventListener('click', async () => {
    if (!state.model) { $('pcOut').textContent = 'Make or open a model first.'; return; }
    $('pcOut').textContent = 'Checking…'; busy(true, '');
    try {
      const k = mmPerUnit(), mm = M.scalePositions(state.model, k);
      const r = await runChecks(mm, { angle: parseFloat($('pSupAngle') && $('pSupAngle').value) || 45, minWall: parseFloat($('pcWall').value) || 1.2, bed: bed() });
      checkRes = r;
      $('pcOut').innerHTML = r.notes.map((n) => `<div class="pcn ${n.kind}">${n.kind === 'ok' ? '✔' : n.kind === 'warn' ? '⚠' : '✖'} ${n.msg}</div>`).join('');
      const v = getViewer(), back = (a) => (a && a.length ? M.scalePositions(a, 1 / k) : a);
      v && v.setOverlay([{ pos: back(r.thinPos), color: 0xff2d2d }, { pos: back(r.overhangPos), color: 0xffa31a }]);
      $('pcBest').disabled = !r.best || r.best.name === 'as it is';
      $('pcBest').textContent = r.best && r.best.name !== 'as it is' ? 'Lay it ' + r.best.name + ' (best way to print)' : 'Already the best way to print';
    } catch (e) { $('pcOut').textContent = e.message || String(e); }
    finally { busy(false, $('sbMsg').textContent); }
  });
  $('pcBest').addEventListener('click', () => {
    if (!checkRes) return; remember();
    const p = reorient(state.model, checkRes.best.up);
    recipe = null; setModel(M.toOrigin(p)); render(); getViewer() && getViewer().setOverlay([]); $('pcOut').textContent = 'Turned. Run the check again to see the result.';
  });

  $('pcFix').addEventListener('click', async () => {
    if (!state.model) { $('pcOut').textContent = 'Make or open a model first.'; return; }
    try { const r = await repairModel(state.model); remember(); recipe = null; setModel(r); render(); $('pcOut').textContent = 'Repaired: the model is now sealed. Run the check again.'; }
    catch (e) { $('pcOut').textContent = e.message || String(e); }
  });

  // ---- arrange
  $('arGo').addEventListener('click', () => {
    if (!state.model) { $('arMsg').textContent = 'Make or open a model first.'; return; }
    const k = mmPerUnit(), n = Math.max(1, Math.min(100, parseInt($('arN').value) || 1));
    let pieces = splitBodies(state.model);
    if (pieces.length === 1 && n > 1) pieces = Array.from({ length: n }, () => state.model);
    else if (pieces.length > 1 && n > 1) { const base = pieces; pieces = []; for (let i = 0; i < n; i++) pieces.push(...base); }
    const b = bed(), r = arrangePieces(pieces, b.x / k, b.y / k, (parseFloat($('arGap').value) || 5) / k, true);
    remember(); recipe = null; setModel(r.pos); render();
    $('arMsg').textContent = r.left ? `${pieces.length - r.left} of ${pieces.length} fit. ${r.left} did not fit and sit beside the bed. Use a bigger bed or fewer.` : `All ${pieces.length} laid out on your ${b.x} × ${b.y} mm bed.`;
  });

  // ---- combine
  $('cmbFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !state.model) return;
    try {
      const pos = await openModelFile(f); const k = mmPerUnit();
      remember();
      const r = await combineModels(state.model, pos, $('cmbOp').value);
      recipe = null; setModel(r); render(); $('sbMsg').textContent = 'Combined.';
    } catch (e2) { err(e2.message || String(e2)); }
  });
  $('cmbBtn').addEventListener('click', () => { if (!state.model) { err('Make or open a model first.'); return; } $('cmbFile').click(); });

  return {
    make, getRecipe: () => (recipe ? { base: recipe.base, steps: recipe.steps } : null),
    setRecipe(r) { if (r && r.base && r.base.kind !== 'model') { recipe = { base: r.base, steps: r.steps || [] }; render(); rebuild(); } },
    modelChanged(external) { if (external) { token++; recipe = null; render(); } },
  };
}
