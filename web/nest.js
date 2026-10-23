// Cloud's CAD - nest profiles in a foam block and tie them together with thin tethers (necks). License: GPL v3
// Pieces sit in a row. Between neighbours the outline is opened on each side at a set height and the two openings are joined by two thin
// parallel lines (the neck, "in and out"). Leads run from the first / last piece to the block edge. The result is one closed loop (no leads
// or one lead), or two open paths, top half and bottom half (leads at both ends), so the machine cuts the top, then the other half.
import * as S from './sketch.js';
import { chain } from './core.js';

const EPS = 1e-9;
const dist = S.dist;
const mod = (a, n) => ((a % n) + n) % n;
const TAU = Math.PI * 2;
const same = (p, q, t = 1e-7) => dist(p, q) <= t;

function sweepOf(s) { const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]); return { a0, sw: s.ccw ? mod(a1 - a0, TAU) : -mod(a0 - a1, TAU) }; }
function segLen(s) { if (s.t === 'L') return dist(s.a, s.b); const r = dist(s.a, s.c); return r * Math.abs(sweepOf(s).sw); }
function mapSeg(s, f) { return s.t === 'L' ? { t: 'L', a: f(s.a), b: f(s.b) } : { t: 'A', a: f(s.a), b: f(s.b), c: f(s.c), ccw: s.ccw }; }

// Where a horizontal line y = c crosses a segment. Returns [{pt}]
function hitsAt(s, c) {
  if (s.t === 'L') {
    const dy = s.b[1] - s.a[1]; if (Math.abs(dy) < EPS) return [];
    const u = (c - s.a[1]) / dy; if (u < -1e-9 || u > 1 + 1e-9) return [];
    return [{ pt: [s.a[0] + (s.b[0] - s.a[0]) * u, c] }];
  }
  const r = dist(s.a, s.c), dy = c - s.c[1]; if (Math.abs(dy) > r + 1e-9) return [];
  const dx = Math.sqrt(Math.max(0, r * r - dy * dy)), { a0, sw } = sweepOf(s), out = [];
  for (const x of dx < 1e-9 ? [s.c[0]] : [s.c[0] - dx, s.c[0] + dx]) {
    const ang = Math.atan2(c - s.c[1], x - s.c[0]), d = sw >= 0 ? mod(ang - a0, TAU) : -mod(a0 - ang, TAU);
    if (Math.abs(d) <= Math.abs(sw) + 1e-9) out.push({ pt: [x, c] });
  }
  return out;
}
function splitSeg(s, p) {
  if (same(p, s.a) || same(p, s.b)) return [s];
  if (s.t === 'L') return [{ t: 'L', a: s.a, b: p }, { t: 'L', a: p, b: s.b }];
  return [{ t: 'A', a: s.a, b: p, c: s.c, ccw: s.ccw }, { t: 'A', a: p, b: s.b, c: s.c, ccw: s.ccw }];
}

// Open a closed contour at gaps. gaps: [{top:[x,y], bot:[x,y]}]. The shorter way round between each pair is removed.
// Returns the remaining runs (arrays of segments).
function openContour(segs, gaps) {
  let list = segs.slice();
  const pts = gaps.flatMap((g) => [g.top, g.bot]);
  for (const p of pts) {   // split wherever a cut point lies inside a segment
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const onIt = s.t === 'L' ? S.closestOn({ t: 'L', a: s.a, b: s.b }, p) : S.closestOn({ t: 'A', a: s.a, b: s.b, c: s.c, ccw: s.ccw }, p);
      if (onIt && dist(onIt.pt, p) < 1e-6 && !same(p, s.a) && !same(p, s.b)) { list.splice(i, 1, ...splitSeg(s, p)); break; }
    }
  }
  list = list.filter((s) => segLen(s) > 1e-9);
  const n = list.length;
  const vertexAt = (p) => { let k = -1, bd = Infinity; for (let i = 0; i < n; i++) { const d = dist(list[i].a, p); if (d < bd) { bd = d; k = i; } } return bd < 1e-5 ? k : -1; };
  const removed = new Array(n).fill(false);
  for (const g of gaps) {
    const kT = vertexAt(g.top), kB = vertexAt(g.bot);
    if (kT < 0 || kB < 0) throw new Error('Could not open the outline at the tether height.');
    const run = (from, to) => { const r = []; for (let i = from; i !== to; i = (i + 1) % n) r.push(i); return r; };
    const A = run(kT, kB), B = run(kB, kT);
    const la = A.reduce((t, i) => t + segLen(list[i]), 0), lb = B.reduce((t, i) => t + segLen(list[i]), 0);
    for (const i of la <= lb ? A : B) removed[i] = true;
  }
  if (!removed.some(Boolean)) return [list];
  const runs = []; let start = removed.findIndex((r, i) => !r && removed[(i - 1 + n) % n]);
  if (start < 0) return [];
  let cur = [];
  for (let c = 0; c < n; c++) {
    const i = (start + c) % n;
    if (removed[i]) { if (cur.length) runs.push(cur); cur = []; } else cur.push(list[i]);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// Closed outlines in a set of entities, each as an ordered list of segments
export function outlinesOf(ents, tol = 0.003) {
  const chains = chain(S.toSegments(ents), tol);
  const out = [];
  for (const c of chains) if (c.length > 1 && dist(c[0].a, c[c.length - 1].b) <= tol * 1.5) out.push(c.map((s) => (s.t === 'L' ? { t: 'L', a: s.a, b: s.b } : { t: 'A', a: s.a, b: s.b, c: s.c, ccw: s.ccw })));
  return out;
}
const boxOf = (segs) => S.bbox(S.fromSegments(segs));

// opts: W, H (block), gap (between pieces), margin (left/right lead room), tetherW, tetherPct (height of the neck above the piece bottom, % of tallest),
//       count (0 = as many as fit), alternate (turn every other piece 180 deg), leads: 'both' | 'right' | 'left' | 'none'
export function nestRow(outlines, o) {
  const { W, H, gap = 0.5, margin = 0.5, tetherW = 0.06, tetherPct = 15, alternate = false, leads = 'both' } = o;
  if (!outlines.length) return { error: 'There is no closed outline to nest. Draw or select a closed profile first.' };
  const base = outlines.map((s) => ({ segs: s, box: boxOf(s) }));
  const hmax = Math.max(...base.map((b) => b.box.h));
  if (hmax > H + 1e-9) return { error: `The profile is ${hmax.toFixed(3)} tall but the block is only ${H} tall.` };
  // how many fit
  let n = o.count > 0 ? o.count : 0;
  const widthFor = (k) => { let w = 2 * margin + gap * (k - 1); for (let i = 0; i < k; i++) w += base[i % base.length].box.w; return w; };
  if (!n) { n = 1; while (widthFor(n + 1) <= W + 1e-9 && n < 200) n++; }
  if (widthFor(n) > W + 1e-9) return { error: `${n} piece${n === 1 ? '' : 's'} need ${widthFor(n).toFixed(2)} of width but the block is ${W} wide.` };
  if (n === 1 && leads === 'both') return { error: 'One piece alone has nothing to tether to. Use leads on one end, or add more pieces.' };

  const baseY = (H - hmax) / 2, yMid = baseY + (hmax * tetherPct) / 100, yT = yMid + tetherW / 2, yB = yMid - tetherW / 2;
  const placed = []; let x = margin;
  for (let i = 0; i < n; i++) {
    const b = base[i % base.length], turn = alternate && i % 2 === 1, cx = (b.box.x0 + b.box.x1) / 2, cy = (b.box.y0 + b.box.y1) / 2;
    const f = (p) => { let q = turn ? [2 * cx - p[0], 2 * cy - p[1]] : p; return [q[0] - b.box.x0 + x, q[1] - b.box.y0 + baseY]; };
    // after turning, the box origin is the same (centre-symmetric), so the same shift applies
    placed.push({ segs: b.segs.map((s) => mapSeg(s, f)), x0: x, x1: x + b.box.w });
    x += b.box.w + gap;
  }
  const rightMost = (segs, y) => { let best = null; for (const s of segs) for (const h of hitsAt(s, y)) if (!best || h.pt[0] > best[0]) best = h.pt; return best; };
  const leftMost = (segs, y) => { let best = null; for (const s of segs) for (const h of hitsAt(s, y)) if (!best || h.pt[0] < best[0]) best = h.pt; return best; };
  const out = []; const warnings = [];
  const leadL = leads === 'both' || leads === 'left', leadR = leads === 'both' || leads === 'right';
  for (let i = 0; i < n; i++) {
    const P = placed[i], gaps = [];
    const needLeft = i > 0 || leadL, needRight = i < n - 1 || leadR;
    P.cuts = {};
    if (needRight) { const t = rightMost(P.segs, yT), b = rightMost(P.segs, yB); if (!t || !b) return { error: `The tether height misses piece ${i + 1}. Change the tether height (%).` }; gaps.push({ top: t, bot: b }); P.cuts.right = { top: t, bot: b }; }
    if (needLeft) { const t = leftMost(P.segs, yT), b = leftMost(P.segs, yB); if (!t || !b) return { error: `The tether height misses piece ${i + 1}. Change the tether height (%).` }; gaps.push({ top: t, bot: b }); P.cuts.left = { top: t, bot: b }; }
    try { for (const run of openContour(P.segs, gaps)) out.push(...S.fromSegments(run)); } catch (e) { return { error: e.message + ` (piece ${i + 1})` }; }
  }
  const line = (a, b) => out.push({ t: 'L', a, b });
  for (let i = 0; i < n - 1; i++) { const a = placed[i].cuts.right, b = placed[i + 1].cuts.left; line(a.top, b.top); line(a.bot, b.bot); }
  if (leadL) { const c = placed[0].cuts.left; line(c.top, [0, c.top[1]]); line(c.bot, [0, c.bot[1]]); }
  if (leadR) { const c = placed[n - 1].cuts.right; line(c.top, [W, c.top[1]]); line(c.bot, [W, c.bot[1]]); }
  const used = placed.reduce((t, p) => t + (p.x1 - p.x0), 0);
  return { ents: out, count: n, usedWidth: widthFor(n), blockArea: W * H, partWidth: used, tetherAt: yMid, warnings };
}
