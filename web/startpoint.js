// Cloud's CAD - choose where the cut starts. License: GPL v3
import { chain, rev } from './core.js';
import * as S from './sketch.js';

function splitSeg(sg, q) {
  const mk = (a, b) => (sg.t === 'L' ? (sg.sp === undefined ? { t: 'L', a, b } : { t: 'L', a, b, sp: sg.sp }) : { t: 'A', a, b, c: sg.c, ccw: sg.ccw });
  return [mk(sg.a, q), mk(q, sg.b)];
}
// Reorder the drawing so the cut starts at point p (closed shape: rotate; open path: start from the nearer end)
export function applyStart(segs, p, tol) {
  const chains = chain(segs, tol);
  let bi = -1, bd = Infinity;
  chains.forEach((c, i) => c.forEach((sg) => { const d = S.dist(S.closestOn(sg, p).pt, p); if (d < bd) { bd = d; bi = i; } }));
  if (bi < 0) return segs;
  const c = chains[bi];
  const closed = c.length > 1 && S.dist(c[0].a, c[c.length - 1].b) <= tol * 1.5;
  let out;
  if (closed) {
    let k = 0, kd = Infinity;
    c.forEach((sg, i) => { const d = S.dist(S.closestOn(sg, p).pt, p); if (d < kd) { kd = d; k = i; } });
    const q = S.closestOn(c[k], p).pt;
    const nearA = S.dist(q, c[k].a) <= tol, nearB = S.dist(q, c[k].b) <= tol;
    if (nearA) out = c.slice(k).concat(c.slice(0, k));
    else if (nearB) out = c.slice(k + 1).concat(c.slice(0, k + 1));
    else { const [s1, s2] = splitSeg(c[k], q); out = [s2, ...c.slice(k + 1), ...c.slice(0, k), s1]; }
  } else {
    out = S.dist(p, c[0].a) <= S.dist(p, c[c.length - 1].b) ? c : c.slice().reverse().map(rev);
  }
  return chains.flatMap((ch, i) => (i === bi ? out : ch));
}
