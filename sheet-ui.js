// Cloud's CAD - Sheet metal tab. License: GPL v3
import { planSheet, foldedSolid, flatEnts } from './sheetmetal.js';

export function initSheet({ $, state, toast, getPaths, getViewerFactory, setModel, addEnts, fmt, mmPerUnit }) {
  let viewer = null, plan = null, path = null, solid = null;
  const msg = (t, bad) => { $('shMsg').textContent = t; $('shMsg').style.color = bad ? '#e5484d' : ''; };
  const val = (id) => parseFloat($(id).value);

  async function ensureViewer() {
    if (viewer) return viewer;
    const { createViewer } = await getViewerFactory();
    try { viewer = createViewer($('shView')); } catch (e) { viewer = null; msg('3D preview needs WebGL; the numbers and flat pattern still work.'); }
    return viewer;
  }
  function drawFlat() {
    const svg = $('flatSvg'); svg.innerHTML = '';
    if (!plan) return;
    const L = plan.flatLength, W = val('shW'), pad = Math.max(L, W) * 0.04;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${L + pad * 2} ${W + pad * 2}`);
    const ns = 'http://www.w3.org/2000/svg', mk = (n, a) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); };
    const sw = Math.max(L, W) / 150;
    mk('rect', { x: 0, y: 0, width: L, height: W, fill: 'none', stroke: '#6aa3ff', 'stroke-width': sw });
    for (const b of plan.lines) mk('rect', { x: b.x0, y: 0, width: b.x1 - b.x0, height: W, fill: 'rgba(255,170,30,.25)', stroke: '#ffa31a', 'stroke-width': sw * 0.6, 'stroke-dasharray': `${sw * 3} ${sw * 2}` });
  }
  async function build() {
    const paths = getPaths();
    if (!paths.length) { plan = null; solid = null; $('shOut').textContent = ''; $('shFlat').disabled = $('shSolid').disabled = true; drawFlat(); msg('No open line found. In the Draw tab draw one open line (not a closed shape) for the side view of the part.', true); return; }
    path = paths[0];
    const T = val('shT'), W = val('shW'), R = val('shR'), K = parseFloat($('shK').value);
    if (!(T > 0) || !(W > 0) || !(R >= 0)) { msg('Thickness and width must be bigger than 0.', true); return; }
    try {
      const r = foldedSolid(path, { T, R, K, W });
      plan = r.plan; solid = r.pos;
      msg(paths.length > 1 ? 'Using the longest open line. ' + (paths.length - 1) + ' other open line(s) are ignored.' : '');
      const u = state.units;
      $('shOut').innerHTML = `<b>Flat size: ${fmt(plan.flatLength, 3)} × ${fmt(W, 3)} ${u}</b><br>${plan.bends.length} bend${plan.bends.length === 1 ? '' : 's'}: ` + (plan.bends.map((b) => Math.round(b.deg) + '°').join(', ') || 'none') + `<br>Blank area ${fmt(plan.flatLength * W, 2)} ${u}²`;
      $('shFlat').disabled = $('shSolid').disabled = false;
      drawFlat();
      const v = await ensureViewer();
      if (v) { v.start(); v.resize(); v.setMesh(solid); v.frame(); }
      $('shRead').textContent = 'Folded part. Drag to turn it.';
      if (!plan.bends.length) msg('The line is straight, so there are no bends yet. Add a corner.');
    } catch (e) { plan = null; solid = null; $('shFlat').disabled = $('shSolid').disabled = true; drawFlat(); msg(e.message || String(e), true); }
  }
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(build, 300); };
  ['shT', 'shW', 'shR', 'shK'].forEach((id) => $(id).addEventListener('input', later));
  $('shGet').addEventListener('click', build);
  $('shFlat').addEventListener('click', () => { if (plan) addEnts(flatEnts(plan, val('shW')), state.units, 'the flat pattern (outline plus a line down the middle of each bend)'); });
  $('shSolid').addEventListener('click', () => { if (solid) { setModel(solid); toast('The folded part is now the 3D model. You can print it, hollow it, or export STL from the 3D tab.'); } });

  return {
    enter() { document.querySelectorAll('.uName').forEach((e) => (e.textContent = state.units)); if (viewer) { viewer.start(); viewer.resize(); } if (!plan) { const k = mmPerUnit(); if (!$('shT').dataset.set) { $('shT').value = +(2 / k).toPrecision(3); $('shW').value = +(30 / k).toPrecision(3); $('shR').value = +(2 / k).toPrecision(3); $('shT').dataset.set = 1; } build(); } },
    leave() { viewer && viewer.stop(); },
  };
}
