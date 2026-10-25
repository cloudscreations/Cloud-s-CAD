// Cloud's CAD - sheet metal: a bent strip from an open line, with a flat pattern. License: GPL v3
// The line you draw is the MIDDLE of the metal. Each corner becomes a bend; the flat pattern uses the K-factor.
import { extrudeLoops } from './mesh.js';

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// opts: { T thickness, R inside bend radius, K k-factor, W width, seg arc steps }
export function planSheet(path, { T, R, K = 0.33 }) {
  const P = [path[0]];
  for (let i = 1; i < path.length; i++) if (dist(path[i], P[P.length - 1]) > 1e-9) P.push(path[i]);
  if (P.length < 2) throw new Error('Draw an open line with at least two points: the middle of the metal.');
  const Rc = R + T / 2, bends = [];
  const dir = (a, b) => { const l = dist(a, b); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const setback = new Array(P.length).fill(0);
  for (let i = 1; i < P.length - 1; i++) {
    const d0 = dir(P[i - 1], P[i]), d1 = dir(P[i], P[i + 1]);
    const cross = d0[0] * d1[1] - d0[1] * d1[0], dot = d0[0] * d1[0] + d0[1] * d1[1];
    const theta = Math.atan2(Math.abs(cross), dot);          // how far it turns, 0..PI
    if (theta < 1e-4) continue;
    if (theta > Math.PI - 0.05) throw new Error('A corner folds back flat on itself. Use a corner of less than about 170 degrees.');
    const sb = Rc * Math.tan(theta / 2);
    setback[i] = sb;
    bends.push({ i, theta, sign: Math.sign(cross), setback: sb, allowance: theta * (R + K * T), deg: (theta * 180) / Math.PI });
  }
  const segs = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const len = dist(P[i], P[i + 1]) - setback[i] - setback[i + 1];
    if (len < -1e-9) throw new Error('Side ' + (i + 1) + ' is too short for the bends at its ends. Make it longer than ' + (setback[i] + setback[i + 1]).toFixed(3) + ' or use a smaller bend radius.');
    segs.push({ len: Math.max(0, len) });
  }
  // flat layout: flange, bend, flange, ...
  let x = 0; const lines = [];
  segs.forEach((s, i) => {
    x += s.len;
    const b = bends.find((q) => q.i === i + 1);
    if (b) { lines.push({ x0: x, x1: x + b.allowance, mid: x + b.allowance / 2, deg: b.deg, dir: b.sign }); x += b.allowance; }
  });
  return { P, bends, segs, flatLength: x, lines, Rc };
}

// Folded solid: loops for the thick profile (2D) extruded by W
export function sheetProfile(path, { T, R, K = 0.33, seg = 10 }) {
  const plan = planSheet(path, { T, R, K }), { P, Rc } = plan;
  const pts = [];                         // centerline with arcs
  const dir = (a, b) => { const l = dist(a, b); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  pts.push(P[0]);
  for (let i = 1; i < P.length - 1; i++) {
    const b = plan.bends.find((q) => q.i === i);
    if (!b) { pts.push(P[i]); continue; }
    const d0 = dir(P[i - 1], P[i]), d1 = dir(P[i], P[i + 1]);
    const s = b.sign, A = [P[i][0] - d0[0] * b.setback, P[i][1] - d0[1] * b.setback];
    const n0 = [-d0[1] * s, d0[0] * s];                    // toward the arc centre
    const C = [A[0] + n0[0] * Rc, A[1] + n0[1] * Rc];
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
    const N = Math.max(3, Math.round((seg * b.theta) / (Math.PI / 2)));
    for (let k = 0; k <= N; k++) { const a = a0 + s * b.theta * (k / N); pts.push([C[0] + Rc * Math.cos(a), C[1] + Rc * Math.sin(a)]); }
  }
  pts.push(P[P.length - 1]);
  // offset both ways by T/2 using the local direction
  const left = [], right = [], h = T / 2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = dir(a, b), n = [-d[1], d[0]];
    left.push([pts[i][0] + n[0] * h, pts[i][1] + n[1] * h]); right.push([pts[i][0] - n[0] * h, pts[i][1] - n[1] * h]);
  }
  return { plan, loop: left.concat(right.reverse()) };
}
export function foldedSolid(path, o) {
  const { plan, loop } = sheetProfile(path, o);
  return { plan, pos: extrudeLoops([loop], o.W) };
}

// Flat pattern as drawing entities: outline plus a line down the middle of each bend
export function flatEnts(plan, W) {
  const L = plan.flatLength, e = [];
  const line = (a, b, extra = {}) => e.push({ t: 'L', a, b, ...extra });
  line([0, 0], [L, 0]); line([L, 0], [L, W]); line([L, W], [0, W]); line([0, W], [0, 0]);
  for (const b of plan.lines) line([b.mid, 0], [b.mid, W]);
  return e;
}
