// Cloud's CAD - 2D drawing editor (SVG). License: GPL v3
import * as S from './sketch.js';
import { fmtLen } from './fmtlen.js';
import { ask, askKeep } from './ask.js';
import { CONSTRUCT, simplifyPath, deleteNode } from './construct.js';

const NS = 'http://www.w3.org/2000/svg';
const f = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
const trimNum = (v, d = 4) => { const s = f(v).toFixed(d); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

function parseLenInput(t) {
  if (t == null) return NaN;
  const m = String(t).trim().replace(/["\u201d]$/, '').match(/^(?:(\d+(?:\.\d+)?)\s+)?(\d+)\/(\d+)$/);
  if (m) return (m[1] ? parseFloat(m[1]) : 0) + parseInt(m[2], 10) / parseInt(m[3], 10);
  return parseFloat(t);
}
export const TOOL_HINTS = {
  dim: 'Dimension: click the two ends of what you want to measure, then click where the dimension line should sit. It stays on the drawing.',
  dimAng: 'Angle: click the corner point, then a point on one side, then a point on the other side. The angle stays on the drawing.',
  dimRad: 'Radius: click a circle or an arc. Its radius stays on the drawing.',
  hand: 'Pan: drag to move the view. Pinch with two fingers to zoom (or use two fingers any time).',
  select: 'Click a piece to select it. Drag a box to select many. Double-click selects the whole shape. Esc clears. (Drag a selected line to move it; Ctrl+click on a curve adds a point.)',
  offset: 'Parallel copy: type the distance in the right panel, click the line, arc or circle, then click the side where the copy should go.',
  measure: 'Measure: click two points. The distance, angle and across/up are shown. Press Esc to clear.',
  start: 'Click the point on the outline where the cut should START. For a closed shape the wire goes all the way around and ends there. For an open path, click near the end you want to start from.',
  curve: 'Smooth curve for tracing: click points along the shape one at a time. Enter, double-click or right-click finishes. Backspace removes the last point. Click the first point to close it.',
  calibAll: 'Calibrate: click one end of something you know the size of, then the other end, then type its real length. Select pieces first to change only those; with nothing selected, the whole drawing and picture are scaled.',
  calib: 'Set the picture size: click one point on the picture, then a second point, then type the real distance between them.',
  bgmove: 'Move the picture: click a point on it, then click where that point should go.',
  line: 'Click the start point, then each next point. Right-click or Esc to stop. Type a length (or length<angle, or dx,dy) and press Enter.',
  rect: 'Click one corner, then the opposite corner. Or type width,height and press Enter.',
  circle: 'Click the center, then a point on the edge. Or type the radius and press Enter.',
  arc: 'Click the start, then any point the arc passes through, then the end.',
  trim: 'Click the part of a line or arc you want to remove (up to where it crosses another).',
  fillet: 'Click two lines to round their corner. Set the radius on the right.',
  chamfer: 'Click two lines to cut their corner. Set the distance on the right.',
  move: 'Select objects first, then click a base point and a target point, or type dx,dy.',
  copy: 'Select objects first, then click a base point and a target point, or type dx,dy.',
  rotate: 'Select objects first, then click the center. Click a point to start the angle and another to end it, or type degrees.',
  mirror: 'Select objects first, then click two points that define the mirror line.',
  scale: 'Select objects first. Click the fixed point (the scale center), then type a factor like 1.5 and press Enter. Or click a point, then click where that point should end up.',
  extend: 'Click near the end of a line you want to lengthen. It grows until it meets the next object in its way.',
  break: 'Click a line or arc where you want to cut it in two. The two halves can then be moved or deleted separately.',
  stretch: 'Drag a box around the end points you want to pull (click two corners), then click a base point and a target point, or type dx,dy. Everything fully inside moves; lines crossing the box stretch.',
};

Object.entries(CONSTRUCT).forEach(([k, spec]) => { TOOL_HINTS[k] = spec.hints[0]; });
TOOL_HINTS.freehand = 'Hold the mouse button and draw the shape freehand. When you let go it becomes a smooth, editable curve.';
TOOL_HINTS.delnode = 'Click a corner where two straight lines meet. The corner point is removed and the two lines become one.';

export function createDrawView({ svg, state, els, onChange }) {
  let doc = state.doc;
  const v = { cx: 0, cy: 0, s: 40 }; // world centre, pixels per unit
  const st = {
    tool: 'select', pts: [], hover: null, snap: null, ortho: false, panning: null, box: null, drag: null,
    first: null, pickA: null, space: false, msg: '', temp: null, picks: [], free: null,
  };
  const size = () => {
    const r = svg.getBoundingClientRect();
    return { w: r.width || 900, h: r.height || 600 };
  };
  const toWorld = (px, py) => { const { w, h } = size(); return [v.cx + (px - w / 2) / v.s, v.cy - (py - h / 2) / v.s]; };
  let curW = 0, curH = 0;
  const sx = (x) => (x - v.cx) * v.s + (curW || size().w) / 2;
  const sy = (y) => (curH || size().h) / 2 - (y - v.cy) * v.s;
  const mouse = (e) => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const tolWorld = (px = 9) => px / v.s;
  const sel = () => state.sel;
  const selIds = () => [...state.sel];
  const ents = () => doc.ents;
  const say = (m) => { st.msg = m; if (els.hint) els.hint.textContent = m || TOOL_HINTS[st.tool]; if (m && /^(Select the objects|Nothing|Select |Could not|Can't|Cannot|No )/.test(m) && window.__banner) window.__banner(m, 'err'); };

  // ----- snapping -----
  function snapPoint(raw, anchor) {
    let p = raw, kind = null;
    const opts = state.snaps;
    const cands = S.snapCandidates(ents(), raw, tolWorld(11), { end: opts.end, mid: opts.mid, center: opts.center, quad: opts.center, inter: opts.inter });
    if (cands.length) { p = cands[0].pt; kind = cands[0].kind; }
    else if (opts.grid) {
      const g = gridLevel();   // only the dots you can actually see
      p = [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g];
      kind = 'grid';
    }
    if ((st.ortho || state.snaps.ortho) && anchor && kind !== 'end') {
      const dx = Math.abs(p[0] - anchor[0]), dy = Math.abs(p[1] - anchor[1]);
      p = dx >= dy ? [p[0], anchor[1]] : [anchor[0], p[1]];
    }
    return { p, kind };
  }
  const anchorPt = () => (st.pts.length ? st.pts[st.pts.length - 1] : null);

  // ----- drawing helpers -----
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
  function entPath(e) {
    if (e.t === 'L') return `M${sx(e.a[0]).toFixed(2)},${sy(e.a[1]).toFixed(2)}L${sx(e.b[0]).toFixed(2)},${sy(e.b[1]).toFixed(2)}`;
    const { r, sweep } = S.arcParams(e);
    const R = (r * v.s).toFixed(2);
    return `M${sx(e.a[0]).toFixed(2)},${sy(e.a[1]).toFixed(2)}A${R},${R} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${e.ccw ? 0 : 1} ${sx(e.b[0]).toFixed(2)},${sy(e.b[1]).toFixed(2)}`;
  }
  function drawEnt(parent, e, cls) {
    if (e.t === 'C') el('circle', { cx: sx(e.c[0]).toFixed(2), cy: sy(e.c[1]).toFixed(2), r: (e.r * v.s).toFixed(2), class: cls, fill: 'none' }, parent);
    else el('path', { d: entPath(e), class: cls, fill: 'none' }, parent);
  }
  // The grid steps by tens like LibreCAD: the finest grid (default .01) while zoomed in, then .1, 1, 10 ... as you zoom out.
  // Small dots are the current step; big dots are every 10th one. Snapping uses the same visible step.
  function gridLevel() {
    let g = state.grid > 0 ? state.grid : 0.01, n = 0;
    while (g * v.s < 7 && n++ < 14) g *= 10;
    return Math.round(g * 1e9) / 1e9;
  }
  // The dots live on a canvas behind the drawing (thousands of dots are far too slow as SVG pieces) and are only repainted when the view changes.
  let gridKey = ''; const gridG = el('g', { class: 'grid' }, null);
  let gridCv = null;
  function ensureGridCanvas() {
    if (gridCv || !svg.parentNode || /jsdom/i.test(navigator.userAgent)) return;
    gridCv = document.createElement('canvas'); gridCv.setAttribute('aria-hidden', 'true');
    gridCv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    svg.parentNode.insertBefore(gridCv, svg); svg.style.position = 'relative'; svg.style.background = 'transparent';
  }
  function paintDots(w, h, g, on) {
    ensureGridCanvas(); if (!gridCv) return;
    const dpr = window.devicePixelRatio || 1, W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (gridCv.width !== W || gridCv.height !== H) { gridCv.width = W; gridCv.height = H; }
    const c = gridCv.getContext && gridCv.getContext('2d'); if (!c) return; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    gridCv.style.zIndex = state.bg && state.bg.visible !== false ? '2' : '0';   // over the picture, under the drawing otherwise
    if (!on) return;
    const cs = getComputedStyle(svg), minor = cs.getPropertyValue('--cv-dot').trim() || '#3a475c', major = cs.getPropertyValue('--cv-dotmajor').trim() || '#6b7d99';
    const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(w, h);
    const i0 = Math.ceil(x0 / g), i1 = Math.floor(x1 / g), j0 = Math.ceil(y0 / g), j1 = Math.floor(y1 / g);
    const px = (i) => Math.round(sx(i * g) * dpr), py = (j) => Math.round(sy(j * g) * dpr), m = Math.max(1, Math.round(dpr)), M = Math.max(2, Math.round(1.6 * dpr));
    c.fillStyle = minor;
    for (let i = i0; i <= i1; i++) { const X = px(i); for (let j = j0; j <= j1; j++) { if (i % 10 === 0 && j % 10 === 0) continue; c.fillRect(X - (m >> 1), py(j) - (m >> 1), m + 1, m + 1); } }
    c.fillStyle = major;
    for (let i = i0; i <= i1; i++) { if (i % 10) continue; const X = px(i); for (let j = j0; j <= j1; j++) { if (j % 10) continue; c.fillRect(X - M, py(j) - M, M * 2 + 1, M * 2 + 1); } }
  }
  function gridLines(parent) {
    const { w, h } = size();
    el('path', { d: `M${sx(0).toFixed(1)},0V${h}M0,${sy(0).toFixed(1)}H${w}`, class: 'axis' }, parent);
  }
  function snapMarker(parent, p, kind) {
    const X = sx(p[0]), Y = sy(p[1]);
    if (kind === 'end') el('rect', { x: X - 5, y: Y - 5, width: 10, height: 10, class: 'snap' }, parent);
    else if (kind === 'mid') el('path', { d: `M${X - 5},${Y + 4}L${X + 5},${Y + 4}L${X},${Y - 5}Z`, class: 'snap' }, parent);
    else if (kind === 'center' || kind === 'quad') el('circle', { cx: X, cy: Y, r: 5, class: 'snap' }, parent);
    else if (kind === 'cross') el('path', { d: `M${X - 5},${Y - 5}L${X + 5},${Y + 5}M${X + 5},${Y - 5}L${X - 5},${Y + 5}`, class: 'snap' }, parent);
    else if (kind === 'grid') el('path', { d: `M${X - 4},${Y}H${X + 4}M${X},${Y - 4}V${Y + 4}`, class: 'snap faint' }, parent);
  }

  // ----- tool previews: return temp entities and extra labels -----
  function preview() {
    const out = [];
    const p = st.hover;
    if (!p) return out;
    const a = anchorPt();
    if (st.tool === 'line' && a) out.push({ t: 'L', a, b: p });
    if (st.tool === 'rect' && a) out.push(...S.rectangle(a, p));
    if (st.tool === 'curve' && st.pts.length) out.push(...S.curveEnts([...st.pts, p], false, 'pv'));
    if (st.tool === 'measure' && st.pts.length === 1) out.push({ t: 'L', a: st.pts[0], b: p });
    if ((st.tool === 'calib' || st.tool === 'calibAll') && st.pts.length === 1) out.push({ t: 'L', a: st.pts[0], b: p });
    if (st.tool === 'bgmove' && st.pts.length === 1) out.push({ t: 'L', a: st.pts[0], b: p });
    if (st.tool === 'circle' && a) { const r = S.dist(a, p); if (r > 1e-9) out.push({ t: 'C', c: a, r }); }
    if (st.tool === 'arc') {
      if (st.pts.length === 1) out.push({ t: 'L', a: st.pts[0], b: p });
      if (st.pts.length === 2) { const arc = S.arcFrom3(st.pts[0], st.pts[1], p); out.push(arc || { t: 'L', a: st.pts[0], b: p }); }
    }
    if (['move', 'copy'].includes(st.tool) && a && sel().size) {
      const dx = p[0] - a[0], dy = p[1] - a[1];
      for (const e of ents()) if (sel().has(e.id)) out.push(...S.copyBy([], [], 0, 0), ...S.copyBy([e], [e.id], dx, dy).slice(1));
    }
    if (st.tool === 'rotate' && sel().size && st.pts.length >= 1) {
      const c = st.pts[0];
      let ang = 0;
      if (st.pts.length === 2) ang = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(st.pts[1][1] - c[1], st.pts[1][0] - c[0]);
      else out.push({ t: 'L', a: c, b: p });
      if (st.pts.length === 2) for (const e of ents()) if (sel().has(e.id)) out.push(...S.rotateCopy([e], [e.id], c, ang).slice(1));
    }
    if (CONSTRUCT[st.tool]) {
      const spec = CONSTRUCT[st.tool];
      if (st.picks.length === spec.steps.length - 1 && spec.steps[spec.steps.length - 1] === 'pt') {
        try { const r = spec.make(st.picks.concat([{ pt: p, at: p }]), state.opts); if (r.ents) out.push(...r.ents); } catch (err) { /* preview only */ }
      }
    }
    if (st.free && st.free.length > 1) for (let i = 1; i < st.free.length; i++) out.push({ t: 'L', a: st.free[i - 1], b: st.free[i] });
    if (st.tool === 'stretch' && st.pts.length === 1) out.push(...S.rectangle(st.pts[0], p));
    if (st.tool === 'stretch' && st.pts.length === 2) out.push(...S.rectangle(st.pts[0], st.pts[1]));
    if (st.tool === 'stretch' && st.pts.length === 3) out.push({ t: 'L', a: st.pts[2], b: p });
    if (st.tool === 'scale' && sel().size && st.pts.length >= 1) {
      out.push({ t: 'L', a: st.pts[0], b: p });
      if (st.pts.length === 2) {
        const k = S.dist(st.pts[0], p) / Math.max(1e-9, S.dist(st.pts[0], st.pts[1]));
        for (const e of ents()) if (sel().has(e.id)) out.push(...S.scaleEnts([e], [e.id], st.pts[0], k));
      }
    }
    if (st.tool === 'mirror' && sel().size && st.pts.length === 1) {
      out.push({ t: 'L', a: st.pts[0], b: p });
      for (const e of ents()) if (sel().has(e.id)) out.push(...S.mirror([e], [e.id], st.pts[0], p).slice(1));
    }
    return out;
  }

  // ----- rendering -----
  const gDyn = el('g', { class: 'dyn' }, null);
  let lastStatic = null; const verOf = new WeakMap(); let verN = 0;
  const ver = (o) => { if (!o) return 0; let n = verOf.get(o); if (!n) { n = ++verN; verOf.set(o, n); } return n; };
  // everything except the cursor, previews and hover highlight; rebuilt only when one of these changes
  function staticKey(w, h) {
    let selSig = sel().size; for (const id of sel()) selSig = (selSig * 31 + (typeof id === 'number' ? id : 7)) % 1000000007;
    const b = state.bg;
    return [w, h, v.cx, v.cy, v.s, ver(ents()), selSig, st.pickA, st.tool === 'select', state.snaps.showOpen, state.snaps.showDims, ver(state.report), ver(state.preview), state.measure ? state.measure.join() : '', state.startPt ? state.startPt.join() : '', b ? `${b.url && b.url.length}|${b.x}|${b.y}|${b.width}|${b.opacity}|${b.visible}` : '', gridLevel(), document.documentElement.dataset.theme, st.curveSel || '', (state.dims || []).length].join('~');
  }
  function render() {
    const { w, h } = size();
    curW = w; curH = h;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const skey = staticKey(w, h);
    const rebuild = st.drag || skey !== lastStatic;
    if (rebuild) {
    for (const c of [...svg.childNodes]) if (c !== gridG && c !== gDyn) svg.removeChild(c);
    // dots and axes are only repainted when the view, window size, grid level or theme changes
    const gkey = state.snaps.showGrid ? `${w}|${h}|${v.cx}|${v.cy}|${v.s}|${gridLevel()}|${document.documentElement.dataset.theme}|${state.bg && state.bg.visible !== false}` : 'off';
    if (gkey !== gridKey) { gridKey = gkey; while (gridG.firstChild) gridG.removeChild(gridG.firstChild); paintDots(w, h, gridLevel(), state.snaps.showGrid); if (state.snaps.showGrid) gridLines(gridG); }
    const gBg = el('g', {}, svg); svg.appendChild(gridG);
    const gEnt = el('g', { class: 'ents' }, svg), gTop = el('g', {}, svg);
    if (state.bg && state.bg.visible !== false) {
      const bg = state.bg, hgt = bg.width * (bg.h / bg.w);
      el('image', { href: bg.url, x: sx(bg.x).toFixed(2), y: sy(bg.y + hgt).toFixed(2), width: (bg.width * v.s).toFixed(2), height: (hgt * v.s).toFixed(2), opacity: bg.opacity, preserveAspectRatio: 'none' }, gBg);
    }
    let live = ents();
    if (st.drag && st.drag.kind === 'vertex') live = S.moveVertex(ents(), st.drag.from, st.drag.cur, st.drag.ids);
    else if (st.drag && st.drag.kind === 'move') { const d = st.drag; live = d.moved ? S.move(ents(), d.ids, d.cur[0] - d.from[0], d.cur[1] - d.from[1]) : live; }
    else if (st.drag && st.drag.kind === 'cp') { const d = st.drag; live = S.replaceCurve(ents(), d.info.sp, d.info.cp.map((q, i) => (i === d.idx ? d.cur : q)), d.info.closed); }
    const hot = st.pickA;
    let plain = '';
    for (const e of live) {
      const special = sel().has(e.id) || hot === e.id;
      if (special) continue;
      if (e.t === 'C') {
        const R = (e.r * v.s).toFixed(2), x0 = sx(e.c[0] - e.r).toFixed(2), x1 = sx(e.c[0] + e.r).toFixed(2), Y = sy(e.c[1]).toFixed(2);
        plain += `M${x0},${Y}A${R},${R} 0 1 0 ${x1},${Y}A${R},${R} 0 1 0 ${x0},${Y}`;
      } else plain += entPath(e);
    }
    if (plain) el('path', { d: plain, class: 'ent', fill: 'none' }, gEnt);
    for (const e of live) {
      if (!(sel().has(e.id) || hot === e.id)) continue;
      drawEnt(gEnt, e, 'ent' + (sel().has(e.id) ? ' sel' : '') + (hot === e.id ? ' hot' : ''));
    }
    if (state.snaps.showOpen && state.report) {
      for (const p of state.report.open) el('circle', { cx: sx(p[0]).toFixed(1), cy: sy(p[1]).toFixed(1), r: 5, class: 'openend' }, gTop);
    }
    const cinfo = st.tool === 'select' ? curveSelected() : null;
    if (cinfo) {
      const cps = st.drag && st.drag.kind === 'cp' ? cinfo.cp.map((q, i) => (i === st.drag.idx ? st.drag.cur : q)) : cinfo.cp;
      for (const q of cps) el('circle', { cx: sx(q[0]), cy: sy(q[1]), r: 5, class: 'cpgrip' }, gTop);
    } else if (st.tool === 'select') {
      for (const e of live) if (sel().has(e.id)) {
        const pts = e.t === 'C' ? [S.add(e.c, [e.r, 0])] : [e.a, e.b];
        for (const p of pts) el('rect', { x: sx(p[0]) - 4, y: sy(p[1]) - 4, width: 8, height: 8, class: 'grip' }, gTop);
      }
    }
    const label = (x, y, text, anchor = 'start') => { const t = el('text', { x, y, class: 'lbl', 'text-anchor': anchor }, gTop); t.textContent = text; };
    for (const d of state.dims || []) {
      const P = (q) => [sx(q[0]), sy(q[1])];
      if (d.k === 'd') {
        const [ax, ay] = P(d.a), [bx, by] = P(d.b); const L = Math.hypot(bx - ax, by - ay) || 1; const ux = (bx - ax) / L, uy = (by - ay) / L;
        const o = P(d.o); const off = (o[0] - ax) * -uy + (o[1] - ay) * ux; const nx = -uy * off, ny = ux * off;
        const A = [ax + nx, ay + ny], B = [bx + nx, by + ny];
        el('path', { d: `M${ax},${ay}L${A[0] + (nx ? Math.sign(nx) * 4 : 0)},${A[1] + (ny ? Math.sign(ny) * 4 : 0)}M${bx},${by}L${B[0] + (nx ? Math.sign(nx) * 4 : 0)},${B[1] + (ny ? Math.sign(ny) * 4 : 0)}M${A[0]},${A[1]}L${B[0]},${B[1]}M${A[0] - uy * 5 - ux * 5},${A[1] + ux * 5 - uy * 5}L${A[0] + uy * 5 + ux * 5},${A[1] - ux * 5 + uy * 5}M${B[0] - uy * 5 - ux * 5},${B[1] + ux * 5 - uy * 5}L${B[0] + uy * 5 + ux * 5},${B[1] - ux * 5 + uy * 5}`, class: 'dimline dimsolid' }, gTop);
        label((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - 6, fmtLen(S.dist(d.a, d.b), state.units), 'middle');
      } else if (d.k === 'a') {
        const a1 = Math.atan2(d.p1[1] - d.v[1], d.p1[0] - d.v[0]), a2 = Math.atan2(d.p2[1] - d.v[1], d.p2[0] - d.v[0]);
        let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        const [vx, vy] = P(d.v), R = 46, n = 24; let path = '';
        for (let i = 0; i <= n; i++) { const t = a1 + (da * i) / n; path += `${i ? 'L' : 'M'}${vx + R * Math.cos(t)},${vy - R * Math.sin(t)}`; }
        el('path', { d: path, class: 'dimline dimsolid' }, gTop);
        const am = a1 + da / 2; label(vx + (R + 8) * Math.cos(am), vy - (R + 8) * Math.sin(am), (Math.abs(da) * 180 / Math.PI).toFixed(2) + '\u00b0', 'middle');
      } else if (d.k === 'r') {
        const [cx, cy] = P(d.c), [ex, ey] = P(d.e);
        el('path', { d: `M${cx},${cy}L${ex},${ey}M${cx - 4},${cy}H${cx + 4}M${cx},${cy - 4}V${cy + 4}`, class: 'dimline dimsolid' }, gTop);
        label((cx + ex) / 2 + 6, (cy + ey) / 2 - 6, 'R ' + fmtLen(d.r, state.units));
      }
    }
    if (state.measure) {
      const [a, b] = state.measure;
      el('path', { d: `M${sx(a[0])},${sy(a[1])}L${sx(b[0])},${sy(b[1])}`, class: 'dimline' }, gTop);
      label((sx(a[0]) + sx(b[0])) / 2 + 8, (sy(a[1]) + sy(b[1])) / 2 - 8, fmtLen(S.dist(a, b), state.units));
    }
    if (state.snaps.showDims && ents().length) {
      const sub = ents().filter((e) => sel().has(e.id));
      const bb = S.bbox(sub.length ? sub : ents());
      if (bb && bb.w > 1e-9 && bb.h > 1e-9) {
        const off = 16, x0 = sx(bb.x0), x1 = sx(bb.x1), yb = sy(bb.y0) + off, y0 = sy(bb.y1), y1 = sy(bb.y0), xr = x1 + off;
        el('path', { d: `M${x0},${yb}H${x1}M${x0},${yb - 5}V${yb + 5}M${x1},${yb - 5}V${yb + 5}M${xr},${y0}V${y1}M${xr - 5},${y0}H${xr + 5}M${xr - 5},${y1}H${xr + 5}`, class: 'dimline' }, gTop);
        label((x0 + x1) / 2, yb + 15, fmtLen(bb.w, state.units), 'middle');
        label(xr + 8, (y0 + y1) / 2, fmtLen(bb.h, state.units), 'start');
      }
    }
    if (state.preview) {
      const pv = state.preview;
      if (pv.rect) { const [x0, y0, x1, y1] = pv.rect; el('rect', { x: sx(x0), y: sy(y1), width: (x1 - x0) * v.s, height: (y1 - y0) * v.s, class: 'pvblock' }, gBg); }
      let d = ''; for (const e of pv.ents) d += e.t === 'C' ? '' : entPath(e);
      el('path', { d, class: 'pvline', fill: 'none' }, gTop);
    }
    if (state.startPt) {
      const X = sx(state.startPt[0]), Y = sy(state.startPt[1]);
      el('path', { d: `M${X},${Y - 9}L${X + 9},${Y}L${X},${Y + 9}L${X - 9},${Y}Z`, class: 'startmk' }, gTop);
    }
    svg.appendChild(gDyn); lastStatic = st.drag ? null : skey;
    }
    while (gDyn.firstChild) gDyn.removeChild(gDyn.firstChild);
    for (const e of preview()) drawEnt(gDyn, e, 'ent tmp');
    if (st.hoverEnt != null && !sel().has(st.hoverEnt)) { const he = ents().find((x) => x.id === st.hoverEnt); if (he && !st.drag) drawEnt(gDyn, he, 'ent hover'); }
    if (st.box) {
      const b = st.box;
      el('rect', { x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), width: Math.abs(b.x1 - b.x0), height: Math.abs(b.y1 - b.y0), class: b.x1 < b.x0 ? 'box cross' : 'box' }, gDyn);
    }
    if (st.snap && st.hover) snapMarker(gDyn, st.hover, st.snap);
    if (st.lastMouse) {
      const [mx, my] = st.lastMouse;
      const arms = `M${mx - 14},${my}H${mx + 14}M${mx},${my - 14}V${my + 14}`;
      el('path', { d: arms, class: 'curHalo' }, gDyn);
      el('path', { d: arms, class: 'cur' }, gDyn);
      el('circle', { cx: mx, cy: my, r: 2.5, class: 'curDot' }, gDyn);
    }
    for (const p of st.pts) el('circle', { cx: sx(p[0]).toFixed(1), cy: sy(p[1]).toFixed(1), r: 3.5, class: 'pt' }, gDyn);
    // live length/angle label for the rubber band
    const a = anchorPt();
    if (a && st.hover && ['line', 'move', 'copy'].includes(st.tool)) {
      const d = S.dist(a, st.hover), ang = (Math.atan2(st.hover[1] - a[1], st.hover[0] - a[0]) * 180) / Math.PI;
      const t = el('text', { x: sx(st.hover[0]) + 12, y: sy(st.hover[1]) - 12, class: 'lbl' }, gDyn);
      t.textContent = `${trimNum(d, 4)} ${state.units} < ${trimNum(ang, 1)}°`;
    }
    if (els.coords) els.coords.textContent = st.hover ? `x ${trimNum(st.hover[0], 4)}   y ${trimNum(st.hover[1], 4)} ${state.units}   grid ${+gridLevel().toPrecision(6)}` : '';
  }

  // ----- reshapeable curve (control points) -----
  function curveSelected() {
    const sps = new Set();
    for (const e of ents()) if (sel().has(e.id)) { if (e.sp === undefined) return null; sps.add(e.sp); }
    if (sps.size !== 1) return null;
    const sp = [...sps][0];
    const info = S.curveInfo(ents(), sp);
    if (!info || !info.ids.every((id) => sel().has(id))) return null;
    return info;
  }
  function reselectCurve(sp) { sel().clear(); ents().filter((e) => e.sp === sp).forEach((e) => sel().add(e.id)); onChange(true); }

  // ----- document changes -----
  function commit(list) {
    doc.set(list);
    // keep selection only for ids that still exist
    const have = new Set(doc.ents.map((e) => e.id));
    for (const id of [...state.sel]) if (!have.has(id)) state.sel.delete(id);
    onChange();
  }
  const addEnts = (list) => { if (list.length) { doc.add(list); onChange(); } };

  function fitBgIfNeeded() { /* hook for callers */ }
  function finishCurve(closed) {
    const pts = st.pts.slice();
    st.pts = [];
    if (pts.length >= 2) addEnts(S.curveEnts(pts, closed && pts.length >= 3));
    render();
  }
  function finishLine() { st.pts = []; st.first = null; render(); }
  function resetTool() { st.pts = []; st.first = null; st.pickA = null; st.temp = null; st.picks = []; st.free = null; say(''); render(); }

  // ----- clicks -----
  function constructClick(p, raw) {
    const spec = CONSTRUCT[st.tool], k = st.picks.length, kind = spec.steps[k];
    let pick;
    if (kind === 'pt') pick = { pt: p, at: p };
    else {
      const hit = S.hitTest(ents(), raw, tolWorld(12));
      const good = hit && (kind === 'any' || (kind === 'line' && hit.t === 'L') || (kind === 'circ' && (hit.t === 'C' || hit.t === 'A')));
      if (!good) { say(kind === 'line' ? 'Click directly on a straight line.' : kind === 'circ' ? 'Click directly on a circle or arc.' : 'Click directly on an object.'); return; }
      pick = { ent: hit, at: raw, pt: raw };
    }
    st.picks.push(pick);
    st.pts = st.picks.filter((q) => q.ent === undefined).map((q) => q.pt).slice(-1);
    if (st.picks.length < spec.steps.length) { say(spec.hints[st.picks.length]); return; }
    const r = spec.make(st.picks, state.opts);
    st.picks = []; st.pts = [];
    if (r.error) { say(r.error); return; }
    const gone = r.remove || [];
    commit(ents().filter((x) => !gone.includes(x.id)).concat(r.ents));
    say('');
  }
  function click(p, e) {
    const tol = tolWorld(9);
    const raw = st.rawHover || p;
    if (CONSTRUCT[st.tool]) { constructClick(p, raw); render(); return; }
    switch (st.tool) {
      case 'line': {
        const a = anchorPt();
        if (!a) { st.pts = [p]; st.first = p; break; }
        if (S.dist(a, p) < 1e-9) break;
        addEnts([{ t: 'L', a, b: p }]);
        if (st.first && S.dist(p, st.first) < 1e-7 && doc.ents.length >= 3) { finishLine(); return; }
        st.pts = [p];
        break;
      }
      case 'curve': {
        const last = st.pts[st.pts.length - 1];
        if (last && S.dist(last, p) < 1e-9) break;
        if (st.pts.length >= 3 && S.dist(p, st.pts[0]) < tolWorld(10)) { finishCurve(true); return; }
        st.pts.push(p);
        break;
      }
      case 'calibAll': {
        if (!ents().length && !state.bg) { say('Nothing to scale yet. Draw something or load a picture first.'); break; }
        st.pts.push(p);
        if (st.pts.length === 2) {
          const d = S.dist(st.pts[0], st.pts[1]), o = st.pts[0]; st.pts = [];
          if (d < 1e-12) { say('Those two points are in the same spot.'); break; }
          ask(`Those points are ${fmtLen(d, state.units)} apart. What should that distance be, in ${state.units}? (like 3.5 or 3 1/2)`, '').then((ans) => {
            const real = parseLenInput(ans);
            if (!(real > 0)) return;
            const k = real / d;
            const target = sel().size ? [...sel()] : ents().map((e) => e.id);   // selected pieces only; with nothing selected, everything
            if (ents().length) commit(S.scaleEnts(ents(), target, o, k));
            if (state.bg && !sel().size) { const bg = state.bg; bg.x = o[0] + (bg.x - o[0]) * k; bg.y = o[1] + (bg.y - o[1]) * k; bg.width *= k; if (els.bgChanged) els.bgChanged(); }
            fit(); say(`Scaled ${sel().size ? 'the selected pieces' : 'everything'} by ${+k.toPrecision(6)} so that distance is now ${fmtLen(real, state.units)}.`);
          });
        }
        break;
      }
      case 'calib': {
        if (!state.bg) { say('Load a picture first (right panel, Picture to trace over).'); break; }
        st.pts.push(p);
        if (st.pts.length === 2) {
          const d = S.dist(st.pts[0], st.pts[1]), o = st.pts[0];
          ask(`Real distance between those two points, in ${state.units}:`, '').then((ans) => {
            const real = parseLenInput(ans);
            if (real > 0 && d > 1e-12 && state.bg) {
              const k = real / d, bg = state.bg;
              bg.x = o[0] + (bg.x - o[0]) * k; bg.y = o[1] + (bg.y - o[1]) * k; bg.width *= k;
              if (els.bgChanged) els.bgChanged();
              fitBgIfNeeded();
              render();
            }
          });
          st.pts = [];
        }
        break;
      }
      case 'bgmove': {
        if (!state.bg) { say('Load a picture first (right panel, Picture to trace over).'); break; }
        if (!st.pts.length) st.pts = [p];
        else { state.bg.x += p[0] - st.pts[0][0]; state.bg.y += p[1] - st.pts[0][1]; st.pts = []; if (els.bgChanged) els.bgChanged(); }
        break;
      }
      case 'offset': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        if (st.pickA === null) {
          if (!hit) { say('Click the line, arc or circle you want a parallel copy of.'); break; }
          st.pickA = hit.id; say('Now click the side where the copy should go.'); break;
        }
        const src = ents().find((x) => x.id === st.pickA);
        st.pickA = null;
        const o = src && S.offsetEnt(src, state.opts.offsetD, raw);
        if (!o) { say('That distance does not fit (a circle or arc cannot shrink past zero).'); break; }
        addEnts([o]); say('');
        break;
      }
      case 'dim': {
        if (st.pts.length >= 3) st.pts = [];
        st.pts.push(p);
        if (st.pts.length === 2) say('Now click where the dimension line should go.');
        if (st.pts.length === 3) { (state.dims = state.dims || []).push({ k: 'd', a: st.pts[0], b: st.pts[1], o: p }); st.pts = []; say(''); onChange(true); }
        break;
      }
      case 'dimAng': {
        st.pts.push(p);
        if (st.pts.length === 2) say('Now click a point on the other side.');
        if (st.pts.length === 3) { const [v0, p1, p2] = st.pts; (state.dims = state.dims || []).push({ k: 'a', v: v0, p1, p2 }); st.pts = []; say(''); onChange(true); }
        break;
      }
      case 'dimRad': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        let c = null, r = 0;
        if (hit && hit.t === 'C') { c = hit.c; r = hit.r; }
        else if (hit && hit.t === 'A') { const ap = S.arcParams(hit); c = ap.c || hit.c; r = ap.r; }
        if (!c || !(r > 0)) { say('Click directly on a circle or an arc.'); break; }
        const ang = Math.atan2(raw[1] - c[1], raw[0] - c[0]);
        (state.dims = state.dims || []).push({ k: 'r', c, r, e: [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)] }); say(''); onChange(true);
        break;
      }
      case 'measure': {
        if (st.pts.length >= 2) st.pts = [];
        st.pts.push(p);
        state.measure = st.pts.length === 2 ? [st.pts[0], st.pts[1]] : null;
        if (st.pts.length === 2) { const [a, b] = st.pts; say(`Distance ${fmtLen(S.dist(a, b), state.units)}   across ${fmtLen(b[0] - a[0], state.units)}   up ${fmtLen(b[1] - a[1], state.units)}   angle ${(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI).toFixed(2)}°`); }
        break;
      }
      case 'start': {
        const hit = S.hitTest(ents(), raw, tolWorld(20));
        if (!hit) { say('Click on the outline, close to the line.'); break; }
        const near = S.snapCandidates(ents(), raw, tolWorld(14), { end: true, mid: false, center: false, quad: false, inter: false });
        state.startPt = near.length ? near[0].pt : S.closestOn(hit, raw).pt;
        say('Cut start set (green marker). Open the Machine tab to see the G-code.');
        onChange();
        break;
      }
      case 'rect': {
        if (!st.pts.length) st.pts = [p];
        else { if (Math.abs(p[0] - st.pts[0][0]) > 1e-9 && Math.abs(p[1] - st.pts[0][1]) > 1e-9) addEnts(S.rectangle(st.pts[0], p)); st.pts = []; }
        break;
      }
      case 'circle': {
        if (!st.pts.length) st.pts = [p];
        else { const r = S.dist(st.pts[0], p); if (r > 1e-9) addEnts([{ t: 'C', c: st.pts[0], r }]); st.pts = []; }
        break;
      }
      case 'arc': {
        st.pts.push(p);
        if (st.pts.length === 3) {
          const arc = S.arcFrom3(st.pts[0], st.pts[1], st.pts[2]);
          if (arc) addEnts([arc]); else say('Those three points are in a straight line, so there is no arc.');
          st.pts = [];
        }
        break;
      }
      case 'trim': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        if (!hit) { say('Click directly on the line or arc to trim.'); break; }
        const r = S.trim(ents(), hit.id, raw);
        if (r.error) say(r.error); else { commit(r.ents); say(''); }
        break;
      }
      case 'fillet': case 'chamfer': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        if (!hit || hit.t !== 'L') { say('Click a straight line.'); break; }
        if (st.pickA === null) { st.pickA = hit.id; say('Now click the second line.'); break; }
        if (hit.id === st.pickA) break;
        const r = st.tool === 'fillet' ? S.fillet(ents(), st.pickA, hit.id, state.opts.filletR) : S.chamfer(ents(), st.pickA, hit.id, state.opts.chamferD);
        st.pickA = null;
        if (r.error) say(r.error); else { commit(r.ents); say(''); }
        break;
      }
      case 'move': case 'copy': {
        if (!sel().size) { say('Select the objects first (Select tool), then use ' + st.tool + '.'); break; }
        if (!st.pts.length) { st.pts = [p]; break; }
        const dx = p[0] - st.pts[0][0], dy = p[1] - st.pts[0][1];
        commit(st.tool === 'move' ? S.move(ents(), selIds(), dx, dy) : S.copyBy(ents(), selIds(), dx, dy));
        st.pts = [];
        break;
      }
      case 'rotate': {
        if (!sel().size) { say('Select the objects first (Select tool), then use rotate.'); break; }
        st.pts.push(p);
        if (st.pts.length === 3) {
          const c = st.pts[0];
          const ang = Math.atan2(st.pts[2][1] - c[1], st.pts[2][0] - c[0]) - Math.atan2(st.pts[1][1] - c[1], st.pts[1][0] - c[0]);
          commit(state.opts.copy ? S.rotateCopy(ents(), selIds(), c, ang) : S.rotate(ents(), selIds(), c, ang));
          st.pts = [];
        }
        break;
      }
      case 'delnode': {
        const r = deleteNode(ents(), raw, tolWorld(12));
        if (r.error) say(r.error); else { commit(r.ents); state.sel.clear(); onChange(true); say(''); }
        break;
      }
      case 'extend': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        if (!hit) { say('Click directly on a line, near the end you want to lengthen.'); break; }
        const r = S.extend(ents(), hit.id, raw);
        if (r.error) say(r.error); else { commit(r.ents); say(''); }
        break;
      }
      case 'break': {
        const hit = S.hitTest(ents(), raw, tolWorld(12));
        if (!hit) { say('Click directly on a line or arc.'); break; }
        const r = S.breakAt(ents(), hit.id, raw);
        if (r.error) say(r.error); else { commit(r.ents); state.sel.clear(); onChange(true); say('Cut in two.'); }
        break;
      }
      case 'scale': {
        if (!sel().size) { say('Select the objects first (Select tool), then use scale.'); break; }
        st.pts.push(p);
        if (st.pts.length === 1) say('Now type a factor (like 1.5) and press Enter, or click a reference point.');
        if (st.pts.length === 3) {
          const ref = S.dist(st.pts[0], st.pts[1]), now = S.dist(st.pts[0], st.pts[2]);
          if (ref < 1e-9 || now < 1e-9) { say('Those points are too close to the fixed point.'); st.pts = [st.pts[0]]; break; }
          commit(S.scaleEnts(ents(), selIds(), st.pts[0], now / ref)); st.pts = []; say('');
        }
        break;
      }
      case 'stretch': {
        st.pts.push(p);
        if (st.pts.length === 1) say('Click the opposite corner of the box.');
        else if (st.pts.length === 2) say('Now click a base point, then the target point. Or type dx,dy.');
        if (st.pts.length === 4) {
          const r = S.stretch(ents(), [st.pts[0], st.pts[1]], st.pts[3][0] - st.pts[2][0], st.pts[3][1] - st.pts[2][1]);
          st.pts = [];
          if (!r.changed) say('Nothing inside that box.'); else { commit(r.ents); say(r.skipped ? `Stretched. ${r.skipped} arc(s) crossing the box were left as they are.` : ''); }
        }
        break;
      }
      case 'mirror': {
        if (!sel().size) { say('Select the objects first (Select tool), then use mirror.'); break; }
        st.pts.push(p);
        if (st.pts.length === 2) {
          const [m1, m2] = st.pts, ids = selIds(); st.pts = [];
          askKeep('Mirror: what about the original?').then((a) => {
            if (a) {
              const before = new Set(ents().map((x) => x.id));
              commit(S.mirror(ents(), ids, m1, m2, a === 'keep'));
              if (a === 'keep') {   // select only the new mirrored copy and start Move, so it can be dragged off the original
                state.sel.clear(); ents().forEach((x) => { if (!before.has(x.id)) state.sel.add(x.id); });
                onChange(true); setTool('move');
                say('The mirrored copy is selected and ready to move. Click a start point (any spot), then click where it should go.');
              }
            }
            render();
          });
        }
        break;
      }
      default: break;
    }
    render();
  }

  // ----- pointer events -----
  function onDown(e) {
    svg.focus && svg.focus({ preventScroll: true });
    const [mx, my] = mouse(e);
    if (e.button === 1 || (e.button === 0 && (st.space || st.tool === 'hand'))) { st.panning = { mx, my, cx: v.cx, cy: v.cy }; e.preventDefault(); return; }
    if (e.button === 2) { e.preventDefault(); st.panning = { mx, my, cx: v.cx, cy: v.cy, right: true, moved: false }; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } return; }
    if (e.button !== 0) return;
    const raw = toWorld(mx, my);
    const { p, kind } = snapPoint(raw, anchorPt());
    st.rawHover = raw;
    if (st.tool === 'select') {
      const ci = curveSelected();
      if (ci) {
        const gi = ci.cp.findIndex((q) => S.dist(q, raw) <= tolWorld(9));
        if (gi >= 0) {
          if (e.altKey && ci.cp.length > 2) { commit(S.replaceCurve(ents(), ci.sp, ci.cp.filter((_, i) => i !== gi), ci.closed)); reselectCurve(ci.sp); render(); return; }
          st.drag = { kind: 'cp', info: ci, idx: gi, cur: ci.cp[gi], moved: false };
          try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
          return;
        }
        if ((e.ctrlKey || e.metaKey)) {
          const hitc = S.hitTest(ents(), raw, tolWorld(9));
          if (hitc && hitc.sp === ci.sp) {
            const n = ci.cp.length, segs = ci.closed ? n : n - 1;
            let bi = 0, bd = Infinity;
            for (let i = 0; i < segs; i++) { const a = ci.cp[i], b = ci.cp[(i + 1) % n]; const d = S.dist(S.closestOn({ t: 'L', a, b }, raw).pt, raw); if (d < bd) { bd = d; bi = i; } }
            const cp2 = ci.cp.slice(); cp2.splice(bi + 1, 0, raw);
            commit(S.replaceCurve(ents(), ci.sp, cp2, ci.closed)); reselectCurve(ci.sp); render(); return;
          }
        }
      }
      // grips first
      for (const ent of ents()) if (sel().has(ent.id) && ent.t !== 'C') for (const g of [ent.a, ent.b]) {
        if (S.dist(g, raw) <= tolWorld(8)) { st.drag = { kind: 'vertex', from: g, cur: g, moved: false, ids: e.ctrlKey || e.metaKey ? null : selIds() }; svg.setPointerCapture && e.pointerId !== undefined && svg.setPointerCapture(e.pointerId); return; }
      }
      const hit = S.hitTest(ents(), raw, tolWorld(9));
      if (hit) {
        const group = hit.sp === undefined ? [hit.id] : ents().filter((x) => x.sp === hit.sp).map((x) => x.id);
        st.selBefore = sel().has(hit.id);
        if (e.shiftKey) { const had = sel().has(hit.id); group.forEach((id) => (had ? sel().delete(id) : sel().add(id))); }
        else if (!sel().has(hit.id)) group.forEach((id) => sel().add(id));   // plain click adds to the selection; clicking a selected piece again (no drag) takes it out
                onChange(true);
        // press and drag the object itself: move just the selected object(s), nothing joined to them comes along
        const s0 = snapPoint(raw, null).p;
        st.drag = { kind: 'move', from: s0, cur: s0, moved: false, ids: selIds(), mx, my, toggleOff: !e.shiftKey && st.selBefore ? group : null };
        svg.setPointerCapture && e.pointerId !== undefined && svg.setPointerCapture(e.pointerId);
      } else {
        st.box = { x0: mx, y0: my, x1: mx, y1: my, add: e.shiftKey };
      }
      render();
      return;
    }
    if (st.tool === 'freehand') { st.free = [raw]; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } render(); return; }
    click(p, e);
    st.hover = p; st.snap = kind;
  }
  let rafId = 0;
  function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
  function onMove(e) {
    const [mx, my] = mouse(e);
    if (st.panning) {
      if (Math.hypot(mx - st.panning.mx, my - st.panning.my) > 4) st.panning.moved = true;
      v.cx = st.panning.cx - (mx - st.panning.mx) / v.s;
      v.cy = st.panning.cy + (my - st.panning.my) / v.s;
      scheduleRender();
      return;
    }
    const raw = toWorld(mx, my);
    st.rawHover = raw;
    const { p, kind } = snapPoint(raw, st.tool === 'select' ? null : anchorPt());
    st.hover = st.tool === 'select' ? raw : p;
    st.snap = st.tool === 'select' ? null : kind;
    st.lastMouse = [mx, my];
    if (st.free) { const last = st.free[st.free.length - 1]; if (S.dist(last, raw) * v.s > 3) st.free.push(raw); scheduleRender(); return; }
    if (st.box) { st.box.x1 = mx; st.box.y1 = my; }
    else if (st.drag) {
      if (st.drag.kind === 'move' && !st.drag.moved && Math.hypot(mx - st.drag.mx, my - st.drag.my) < 5) return;   // a click, not a drag
      const s2 = snapPoint(raw, null);
      st.drag.cur = s2.p; st.drag.moved = true; st.snap = s2.kind; st.hover = s2.p;
    } else {
      const hit = S.hitTest(ents(), raw, tolWorld(9));
      st.hoverEnt = hit ? hit.id : null;
    }
    scheduleRender();
  }
  function onUp(e) {
    if (st.free) {
      const pts = simplifyPath(st.free, 2.5 / v.s); st.free = null;
      if (pts.length >= 2) {
        const closed = pts.length >= 4 && S.dist(pts[0], pts[pts.length - 1]) < 8 / v.s;
        const use = closed ? pts.slice(0, -1) : pts;
        if (use.length >= 2) addEnts(S.curveEnts(use, closed && use.length >= 3));
      }
      render(); return;
    }
    if (st.panning) {
      const was = st.panning; st.panning = null;
      if (was.right && !was.moved) { if (st.tool === 'line') finishLine(); else if (st.tool === 'curve' && st.pts.length >= 2) finishCurve(false); else resetTool(); }
      return;
    }
    if (st.drag) {
      const d = st.drag; st.drag = null;
      if (d.kind === 'cp') {
        if (d.moved && S.dist(d.info.cp[d.idx], d.cur) > 1e-9) { commit(S.replaceCurve(ents(), d.info.sp, d.info.cp.map((q, i) => (i === d.idx ? d.cur : q)), d.info.closed)); reselectCurve(d.info.sp); }
        render(); return;
      }
      if (d.kind === 'move') { if (!d.moved && d.toggleOff) { d.toggleOff.forEach((id) => sel().delete(id)); onChange(true); } if (d.moved && S.dist(d.from, d.cur) > 1e-9) commit(S.move(ents(), d.ids, d.cur[0] - d.from[0], d.cur[1] - d.from[1])); render(); return; }
      if (d.moved && S.dist(d.from, d.cur) > 1e-9) commit(S.moveVertex(ents(), d.from, d.cur, d.ids));
      render();
      return;
    }
    if (st.box) {
      const b = st.box; st.box = null;
      const moved = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 4;
      if (!moved) { if (!b.add) sel().clear(); }
      else {
        const [wx0, wy0] = toWorld(b.x0, b.y0), [wx1, wy1] = toWorld(b.x1, b.y1);
        const ids = S.selectBox(ents(), wx0, wy0, wx1, wy1, b.x1 < b.x0);
        ids.forEach((id) => sel().add(id));
      }
      onChange(true);
      render();
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const [mx, my] = mouse(e);
    const before = toWorld(mx, my);
    v.s = Math.max(0.5, Math.min(20000, v.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    const after = toWorld(mx, my);
    v.cx += before[0] - after[0];
    v.cy += before[1] - after[1];
    render();
  }
  function selectChain(id) {
    const list = ents();
    const tol = 1e-6 + 1e-6 * Math.max(1, ...list.map((x) => Math.abs((x.a || x.c)[0])));
    const pts = (x) => (x.t === 'C' ? [] : [x.a, x.b]);
    const near = (p, q) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
    const seen = new Set([id]), queue = [id];
    while (queue.length) {
      const cur = list.find((x) => x.id === queue.pop());
      for (const o of list) {
        if (seen.has(o.id)) continue;
        if (pts(cur).some((p) => pts(o).some((q) => near(p, q)))) { seen.add(o.id); queue.push(o.id); }
      }
    }
    return [...seen];
  }
  function onDbl(e) {
    if (st.tool === 'select') {
      const [mx, my] = mouse(e);
      const hit = S.hitTest(ents(), toWorld(mx, my), tolWorld(9));
      if (hit) { selectChain(hit.id).forEach((id) => sel().add(id)); onChange(true); render(); }
      return;
    }
    if (st.tool === 'line') finishLine(); else if (st.tool === 'curve' && st.pts.length >= 2) finishCurve(false); }

  // ----- touch (phones and tablets): one finger works like the mouse, two fingers pinch-zoom and pan -----
  const touches = new Map(); let gest = null, tPlace = null;
  const PLACE_OFFSET = 56;   // while placing points the cross-hair sits this far above the finger so it stays visible
  const placing = () => !['select', 'hand', 'freehand'].includes(st.tool);
  const fake = (e, dy = 0) => ({ button: 0, pointerId: e.pointerId, pointerType: 'mouse', clientX: e.clientX, clientY: e.clientY + dy, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} });
  const mid = () => { const a = [...touches.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 }; };
  function startGesture() {
    st.drag = null; st.box = null; st.panning = null; st.free = null; tPlace = null;
    const m = mid(), r = svg.getBoundingClientRect(), [wx, wy] = toWorld(m.x - r.left, m.y - r.top);
    gest = { s0: v.s, d0: m.d, wx, wy };
  }
  function tDown(e) {
    if (e.pointerType !== 'touch') return onDown(e);
    e.preventDefault(); touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    if (touches.size >= 2) { startGesture(); return; }
    if (placing()) { tPlace = { id: e.pointerId, e, x: e.clientX, y: e.clientY, t: Date.now(), far: false }; onMove(fake(e, -PLACE_OFFSET)); return; }
    onDown(e);
  }
  function tMove(e) {
    if (e.pointerType !== 'touch') return onMove(e);
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gest && touches.size >= 2) {
      const m = mid(), r = svg.getBoundingClientRect(), { w, h } = size();
      v.s = Math.max(0.5, Math.min(20000, gest.s0 * (m.d / gest.d0)));
      v.cx = gest.wx - (m.x - r.left - w / 2) / v.s; v.cy = gest.wy + (m.y - r.top - h / 2) / v.s;
      scheduleRender(); return;
    }
    if (tPlace && tPlace.id === e.pointerId) { tPlace.e = e; if (Math.hypot(e.clientX - tPlace.x, e.clientY - tPlace.y) > 8) tPlace.far = true; onMove(fake(e, tPlace.far ? -PLACE_OFFSET : 0)); return; }
    onMove(e);
  }
  function tUp(e) {
    if (e.pointerType !== 'touch') return onUp(e);
    const had = touches.delete(e.pointerId);
    if (gest) { if (touches.size < 2) gest = null; return; }
    if (!had) return;
    if (tPlace && tPlace.id === e.pointerId) { const quick = !tPlace.far && Date.now() - tPlace.t < 400; const pe = fake(e, quick || !tPlace.far ? 0 : -PLACE_OFFSET); tPlace = null; onDown(pe); st.lastMouse = null; render(); return; }
    onUp(e);
  }
  function tCancel(e) { touches.delete(e.pointerId); tPlace = null; if (!touches.size) gest = null; st.drag = null; st.box = null; render(); }
  svg.addEventListener('pointerdown', tDown);
  svg.addEventListener('pointermove', tMove);
  svg.addEventListener('pointerup', tUp);
  svg.addEventListener('pointercancel', tCancel);
  svg.addEventListener('pointerleave', () => { st.lastMouse = null; st.hover = null; st.snap = null; st.hoverEnt = null; render(); });
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('dblclick', onDbl);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  // ----- keyboard and typed values -----
  function applyNumber(text) {
    const t = text.trim();
    if (!t) return;
    const a = anchorPt();
    const dirFromMouse = () => {
      const h = st.hover || [a[0] + 1, a[1]];
      return Math.atan2(h[1] - a[1], h[0] - a[0]);
    };
    const parts = t.split(/[,; ]+/).map(Number);
    if (st.tool === 'line' && a) {
      let b;
      if (/<|@/.test(t)) { const [L, ang] = t.split(/[<@]/).map(Number); const r = (ang * Math.PI) / 180; b = [a[0] + L * Math.cos(r), a[1] + L * Math.sin(r)]; }
      else if (parts.length === 2) b = [a[0] + parts[0], a[1] + parts[1]];
      else { const d = dirFromMouse(); const snapped = (st.ortho || state.snaps.ortho) ? Math.round(d / (Math.PI / 2)) * (Math.PI / 2) : d; b = [a[0] + parts[0] * Math.cos(snapped), a[1] + parts[0] * Math.sin(snapped)]; }
      if (b.every(Number.isFinite)) { addEnts([{ t: 'L', a, b }]); st.pts = [b]; }
    } else if (st.tool === 'rect' && a && parts.length === 2 && parts.every(Number.isFinite)) {
      addEnts(S.rectangle(a, [a[0] + parts[0], a[1] + parts[1]])); st.pts = [];
    } else if (st.tool === 'circle' && a && Number.isFinite(parts[0]) && parts[0] > 0) {
      addEnts([{ t: 'C', c: a, r: parts[0] }]); st.pts = [];
    } else if (['move', 'copy'].includes(st.tool) && sel().size && parts.length === 2 && parts.every(Number.isFinite)) {
      commit(st.tool === 'move' ? S.move(ents(), selIds(), parts[0], parts[1]) : S.copyBy(ents(), selIds(), parts[0], parts[1])); st.pts = [];
    } else if (st.tool === 'scale' && sel().size && st.pts.length >= 1 && Number.isFinite(parts[0]) && parts[0] > 0) {
      commit(S.scaleEnts(ents(), selIds(), st.pts[0], parts[0])); st.pts = []; say('');
    } else if (st.tool === 'stretch' && st.pts.length === 2 && parts.length === 2 && parts.every(Number.isFinite)) {
      const r = S.stretch(ents(), [st.pts[0], st.pts[1]], parts[0], parts[1]); st.pts = [];
      if (!r.changed) say('Nothing inside that box.'); else commit(r.ents);
    } else if (st.tool === 'rotate' && sel().size && Number.isFinite(parts[0])) {
      const c = st.pts[0] || selCenter();
      const ang = (parts[0] * Math.PI) / 180;
      commit(state.opts.copy ? S.rotateCopy(ents(), selIds(), c, ang) : S.rotate(ents(), selIds(), c, ang)); st.pts = [];
    } else say('Typed values do not apply to this tool right now.');
    render();
  }
  function selCenter() {
    const b = S.bbox(ents().filter((e) => sel().has(e.id)));
    return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [0, 0];
  }
  function setTool(t) {
    st.tool = t; st.pts = []; if (t !== 'measure') state.measure = null; st.first = null; st.pickA = null; st.box = null; st.drag = null; st.picks = []; st.free = null;
    say('');
    if (els.toolBtns) els.toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    if (els.toolOpts) els.toolOpts.forEach((o) => { o.hidden = !(o.dataset.for || '').split(' ').includes(t); });
    render();
  }
  function deleteSelected() { if (sel().size) { commit(S.remove(ents(), selIds())); state.sel.clear(); onChange(); render(); } }
  function onKey(e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target !== els.num) return;
    if (e.target === els.num) {
      if (e.key === 'Enter') { applyNumber(els.num.value); els.num.value = ''; svg.focus && svg.focus(); e.preventDefault(); }
      else if (e.key === 'Escape') { els.num.value = ''; svg.focus && svg.focus(); }
      return;
    }
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) { doc.redo(); } else { doc.undo(); } onChange(); render(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); doc.redo(); onChange(); render(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); ents().forEach((x) => sel().add(x.id)); onChange(true); render(); return; }
    if (k === ' ') { st.space = true; e.preventDefault(); return; }
    if (k === 'Escape') { state.measure = null; if (st.tool === 'line') finishLine(); else if (st.tool === 'curve' && st.pts.length >= 2) finishCurve(false); else { resetTool(); } sel().clear(); onChange(true); render(); return; }
    if (k === 'Enter' && st.tool === 'line') { finishLine(); return; }
    if (k === 'Enter' && st.tool === 'curve') { if (st.pts.length >= 2) finishCurve(false); return; }
    if (k === 'Backspace' && st.tool === 'curve' && st.pts.length) { st.pts.pop(); render(); return; }
    if (k === 'Delete' || k === 'Backspace' || (!ctrl && !e.altKey && (k === 'q' || k === 'Q'))) { deleteSelected(); return; }
    if (k === 'Shift') { st.ortho = true; return; }
    if (/^[0-9.\-<]$/.test(k) && els.num && !ctrl) { els.num.focus(); els.num.value = k; e.preventDefault(); return; }
    const map = { v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc', t: 'trim', f: 'fillet', h: 'chamfer', m: 'move', y: 'copy', o: 'rotate', i: 'mirror', k: 'scale', w: 'freehand', x: 'delnode', e: 'extend', b: 'break', g: 'stretch', u: 'curve', s: 'start', d: 'measure', p: 'offset' };
    if (!ctrl && map[k.toLowerCase()]) setTool(map[k.toLowerCase()]);
  }
  function onKeyUp(e) { if (e.key === ' ') st.space = false; if (e.key === 'Shift') st.ortho = false; }
  window.addEventListener('keydown', (e) => { if (state.tab === 'draw') onKey(e); });
  window.addEventListener('keyup', onKeyUp);
  if (els.num) els.num.addEventListener('keydown', (e) => { if (state.tab === 'draw') onKey(e); });

  // ----- view -----
  function fit() {
    const b = S.bbox(ents());
    const { w, h } = size();
    if (!b) { v.cx = 0; v.cy = 0; v.s = 40; render(); return; }
    v.cx = (b.x0 + b.x1) / 2; v.cy = (b.y0 + b.y1) / 2;
    const bw = Math.max(b.w, 1e-6), bh = Math.max(b.h, 1e-6);
    v.s = Math.min((w * 0.85) / bw, (h * 0.85) / bh);
    render();
  }
  window.addEventListener('resize', () => { if (state.tab === 'draw') render(); });

  function fitToBg() {
    const bg = state.bg;
    if (!bg) return;
    const { w, h } = size();
    const bw = bg.width, bh = bg.width * (bg.h / bg.w);
    v.cx = bg.x + bw / 2; v.cy = bg.y + bh / 2;
    v.s = Math.min((w * 0.85) / bw, (h * 0.85) / bh);
    render();
  }
  const setDoc = (d) => { doc = d; st.pts = []; render(); };
  return { setDoc, render, fit, fitToBg, setTool, applyNumber, deleteSelected, view: v, state: st, toWorld, click, size };
}
