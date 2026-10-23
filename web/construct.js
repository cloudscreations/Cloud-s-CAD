// Cloud's CAD - construction tools (pure geometry, no screen code). License: GPL v3
// Each tool lists the things to pick (steps) and a make() that turns the picks into drawing objects.
// Pick kinds: 'pt' a point, 'line' a straight line, 'circ' a circle or arc, 'any' any object.
// make(picks, opts) -> { ents, remove? } or { error }.  A pick is { pt, at, ent }.
import * as S from './sketch.js';

const { dist, sub, add, mul, unit, dot, cross, len, TAU } = S;
const perpL = (u) => [-u[1], u[0]];            // turn left
const bad = (m) => ({ error: m });

function infX(A, B) {                              // where two straight lines meet if both are extended forever
  const r = sub(A.b, A.a), s = sub(B.b, B.a), den = cross(r, s);
  if (Math.abs(den) < 1e-12 * Math.max(1, len(r) * len(s))) return null;
  const t = cross(sub(B.a, A.a), s) / den;
  return [A.a[0] + r[0] * t, A.a[1] + r[1] * t];
}
const circOf = (e) => ({ c: e.c, r: e.t === 'C' ? e.r : dist(e.a, e.c) });
function polyLines(pts) { return pts.map((p, i) => ({ t: 'L', a: p, b: pts[(i + 1) % pts.length] })); }
function ringPts(c, R, n, a0) { return Array.from({ length: n }, (_, i) => [c[0] + R * Math.cos(a0 + (TAU * i) / n), c[1] + R * Math.sin(a0 + (TAU * i) / n)]); }
const closedCurve = (pts) => S.curveEnts(pts, true, S.newCurveId());
function ellipseEnts(c, ux, a, b) {                // ux = unit vector along the long axis
  const uy = perpL(ux), n = 24, pts = [];
  for (let i = 0; i < n; i++) { const t = (TAU * i) / n; pts.push([c[0] + ux[0] * a * Math.cos(t) + uy[0] * b * Math.sin(t), c[1] + ux[1] * a * Math.cos(t) + uy[1] * b * Math.sin(t)]); }
  return closedCurve(pts);
}
const foot = (L, p) => { const d = unit(sub(L.b, L.a)); return add(L.a, mul(d, dot(sub(p, L.a), d))); };

// points where lines through P touch circle (C,R)
function tangentPts(P, C, R) {
  const d = dist(P, C);
  if (d <= R + 1e-12) return null;
  const base = Math.atan2(P[1] - C[1], P[0] - C[0]), al = Math.acos(R / d);
  return [base + al, base - al].map((a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]);
}

export const CONSTRUCT = {
  hline: { steps: ['pt', 'pt'], hints: ['Click the start of the level line.', 'Click the end. The line stays horizontal.'],
    make: ([a, b]) => (Math.abs(b.pt[0] - a.pt[0]) < 1e-9 ? bad('Pick a point to the left or right.') : { ents: [{ t: 'L', a: a.pt, b: [b.pt[0], a.pt[1]] }] }) },
  vline: { steps: ['pt', 'pt'], hints: ['Click the start of the upright line.', 'Click the end. The line stays vertical.'],
    make: ([a, b]) => (Math.abs(b.pt[1] - a.pt[1]) < 1e-9 ? bad('Pick a point above or below.') : { ents: [{ t: 'L', a: a.pt, b: [a.pt[0], b.pt[1]] }] }) },
  perp: { steps: ['pt', 'any'], hints: ['Click the point the line should start from.', 'Click the line (or circle) it should meet at a right angle.'],
    make: ([p, o]) => {
      const e = o.ent;
      const f = e.t === 'L' ? foot(e, p.pt) : (() => { const { c, r } = circOf(e); const u = unit(sub(p.pt, c)); return len(u) < 1e-12 ? null : add(c, mul(u, r)); })();
      return !f || dist(f, p.pt) < 1e-9 ? bad('The point is already on it.') : { ents: [{ t: 'L', a: p.pt, b: f }] };
    } },
  pthru: { steps: ['any', 'pt'], hints: ['Click the line (or circle) to copy.', 'Click the point the copy should pass through.'],
    make: ([o, p]) => {
      const e = o.ent;
      if (e.t === 'L') { const off = sub(p.pt, foot(e, p.pt)); return len(off) < 1e-9 ? bad('That point is already on the line.') : { ents: [{ t: 'L', a: add(e.a, off), b: add(e.b, off) }] }; }
      if (e.t === 'C') { const r = dist(e.c, p.pt); return r < 1e-9 ? bad('Pick a point away from the center.') : { ents: [{ t: 'C', c: e.c, r }] }; }
      return bad('Click a straight line or a full circle.');
    } },
  bisector: { steps: ['line', 'line'], hints: ['Click the first line.', 'Click the second line. A line is drawn halfway between them (length is set in Tool options).'],
    make: ([A, B], o) => {
      const P = infX(A.ent, B.ent);
      if (!P) return bad('Those lines are parallel.');
      const u1 = unit(sub(A.at, P)), u2 = unit(sub(B.at, P));
      if (len(u1) < 1e-9 || len(u2) < 1e-9) return bad('Click away from where the lines cross.');
      let b = unit(add(u1, u2));
      if (len(b) < 1e-9) b = perpL(u1);
      return { ents: [{ t: 'L', a: P, b: add(P, mul(b, o.bisLen || 1)) }] };
    } },
  tanpc: { steps: ['pt', 'circ'], hints: ['Click the point the line starts from.', 'Click the circle or arc (near the side to touch).'],
    make: ([p, c], o) => {
      const { c: C, r } = circOf(c.ent), T = tangentPts(p.pt, C, r);
      if (!T) return bad('The point is inside the circle: no line can touch it from there.');
      return { ents: [{ t: 'L', a: p.pt, b: dist(T[0], c.at) <= dist(T[1], c.at) ? T[0] : T[1] }] };
    } },
  tancc: { steps: ['circ', 'circ'], hints: ['Click the first circle.', 'Click the second circle, near the side the line should run.'],
    make: ([A, B]) => {
      const a = circOf(A.ent), b = circOf(B.ent), d = sub(b.c, a.c), D = len(d), phi = Math.atan2(d[1], d[0]);
      if (D < 1e-9) return bad('The circles share a center.');
      const cands = [];
      for (const sp of [1, -1]) {                         // 1: same side (outer line), -1: crossing line
        const delta = sp * b.r - a.r;
        if (Math.abs(delta) > D) continue;
        for (const sg of [1, -1]) {
          const th = phi + sg * Math.acos(delta / D), n = [Math.cos(th), Math.sin(th)];
          cands.push({ a: sub(a.c, mul(n, a.r)), b: sub(b.c, mul(n, sp * b.r)) });
        }
      }
      if (!cands.length) return bad('These circles have no line touching both (one is inside the other).');
      cands.sort((x, y) => dist([(x.a[0] + x.b[0]) / 2, (x.a[1] + x.b[1]) / 2], B.at) - dist([(y.a[0] + y.b[0]) / 2, (y.a[1] + y.b[1]) / 2], B.at));
      return { ents: [{ t: 'L', a: cands[0].a, b: cands[0].b }] };
    } },
  rect3: { steps: ['pt', 'pt', 'pt'], hints: ['Click one corner.', 'Click the next corner (this sets the tilt).', 'Click anywhere on the side where the rectangle should go.'],
    make: ([a, b, c]) => {
      const d = sub(b.pt, a.pt);
      if (len(d) < 1e-9) return bad('The first two corners are the same point.');
      const n = perpL(unit(d)), w = dot(sub(c.pt, a.pt), n);
      if (Math.abs(w) < 1e-9) return bad('Click away from the first side.');
      return { ents: polyLines([a.pt, b.pt, add(b.pt, mul(n, w)), add(a.pt, mul(n, w))]) };
    } },
  polyCC: { steps: ['pt', 'pt'], hints: ['Click the center.', 'Click one corner. The number of sides is in Tool options.'],
    make: ([c, k], o) => { const R = dist(c.pt, k.pt); return R < 1e-9 ? bad('Pick a point away from the center.') : { ents: polyLines(ringPts(c.pt, R, o.sides || 6, Math.atan2(k.pt[1] - c.pt[1], k.pt[0] - c.pt[0]))) }; } },
  polyCT: { steps: ['pt', 'pt'], hints: ['Click the center.', 'Click the middle of one side. The number of sides is in Tool options.'],
    make: ([c, m], o) => {
      const n = o.sides || 6, ap = dist(c.pt, m.pt);
      if (ap < 1e-9) return bad('Pick a point away from the center.');
      const ang = Math.atan2(m.pt[1] - c.pt[1], m.pt[0] - c.pt[0]);
      return { ents: polyLines(ringPts(c.pt, ap / Math.cos(Math.PI / n), n, ang + Math.PI / n)) };
    } },
  polyKK: { steps: ['pt', 'pt'], hints: ['Click one corner.', 'Click the next corner. The polygon is built on the left of that side.'],
    make: ([a, b], o) => {
      const n = o.sides || 6, s = dist(a.pt, b.pt);
      if (s < 1e-9) return bad('Those corners are the same point.');
      const u = unit(sub(b.pt, a.pt)), mid = mul(add(a.pt, b.pt), 0.5);
      const C = add(mid, mul(perpL(u), s / (2 * Math.tan(Math.PI / n)))), R = s / (2 * Math.sin(Math.PI / n));
      return { ents: polyLines(ringPts(C, R, n, Math.atan2(a.pt[1] - C[1], a.pt[0] - C[0]))) };
    } },
  star: { steps: ['pt', 'pt'], hints: ['Click the center.', 'Click one tip. Points and depth are in Tool options.'],
    make: ([c, k], o) => {
      const n = o.points || 5, R = dist(c.pt, k.pt), r = R * (o.ratio || 0.4);
      if (R < 1e-9) return bad('Pick a point away from the center.');
      const a0 = Math.atan2(k.pt[1] - c.pt[1], k.pt[0] - c.pt[0]), pts = [];
      for (let i = 0; i < 2 * n; i++) { const rr = i % 2 ? r : R, a = a0 + (Math.PI * i) / n; pts.push([c.pt[0] + rr * Math.cos(a), c.pt[1] + rr * Math.sin(a)]); }
      return { ents: polyLines(pts) };
    } },
  divide: { steps: ['any'], hints: ['Click the line, arc or circle to cut into equal parts (how many: Tool options).'],
    make: ([o], opt) => {
      const n = Math.max(2, Math.round(opt.divN || 2)), e = o.ent, out = [];
      if (e.t === 'L') { for (let i = 0; i < n; i++) out.push({ t: 'L', a: add(e.a, mul(sub(e.b, e.a), i / n)), b: add(e.a, mul(sub(e.b, e.a), (i + 1) / n)) }); out[0].a = e.a; out[n - 1].b = e.b; return { ents: out, remove: [e.id] }; }
      const { c, r } = circOf(e);
      const a0 = e.t === 'C' ? 0 : Math.atan2(e.a[1] - c[1], e.a[0] - c[0]);
      const sw = e.t === 'C' ? TAU : S.arcParams(e).sweep, dir = e.t === 'A' && !e.ccw ? -1 : 1, tot = Math.abs(sw);
      const at = (i) => { const a = a0 + dir * (tot * i) / n; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; };
      for (let i = 0; i < n; i++) out.push({ t: 'A', a: i === 0 && e.t === 'A' ? e.a : at(i), b: i === n - 1 && e.t === 'A' ? e.b : at(i + 1), c, ccw: dir > 0 });
      return { ents: out, remove: [e.id] };
    } },
  circR: { steps: ['pt'], hints: ['Click the center. The radius is in Tool options.'],
    make: ([c], o) => ((o.circR || 0) > 0 ? { ents: [{ t: 'C', c: c.pt, r: o.circR }] } : bad('Type a radius in Tool options.')) },
  circ2p: { steps: ['pt', 'pt'], hints: ['Click one end of the diameter.', 'Click the other end.'],
    make: ([a, b]) => { const r = dist(a.pt, b.pt) / 2; return r < 1e-9 ? bad('Those points are the same.') : { ents: [{ t: 'C', c: mul(add(a.pt, b.pt), 0.5), r }] }; } },
  circ3p: { steps: ['pt', 'pt', 'pt'], hints: ['Click a point on the circle.', 'Click a second point on it.', 'Click a third point on it.'],
    make: ([a, b, c]) => { const arc = S.arcFrom3(a.pt, b.pt, c.pt); return arc ? { ents: [{ t: 'C', c: arc.c, r: dist(arc.c, a.pt) }] } : bad('Those three points are in a straight line.'); } },
  circ2pr: { steps: ['pt', 'pt', 'pt'], hints: ['Click a point on the circle.', 'Click a second point on it. The radius is in Tool options.', 'Click on the side where the center should be.'],
    make: ([a, b, s], o) => {
      const R = o.circR || 0, D = dist(a.pt, b.pt);
      if (!(R > 0)) return bad('Type a radius in Tool options.');
      if (D > 2 * R + 1e-9) return bad('The radius is too small to reach both points.');
      const m = mul(add(a.pt, b.pt), 0.5), n = perpL(unit(sub(b.pt, a.pt))), h = Math.sqrt(Math.max(0, R * R - (D / 2) * (D / 2)));
      const c1 = add(m, mul(n, h)), c2 = sub(m, mul(n, h));
      return { ents: [{ t: 'C', c: dist(c1, s.pt) <= dist(c2, s.pt) ? c1 : c2, r: R }] };
    } },
  circIn: { steps: ['line', 'line', 'line'], hints: ['Click the first of three lines.', 'Click the second line.', 'Click the third line. A circle is fitted inside the triangle they make.'],
    make: ([A, B, C]) => {
      const X = infX(A.ent, B.ent), Y = infX(B.ent, C.ent), Z = infX(C.ent, A.ent);
      if (!X || !Y || !Z) return bad('Two of those lines are parallel.');
      const x = dist(Y, Z), y = dist(Z, X), z = dist(X, Y), per = x + y + z, area = Math.abs(cross(sub(Y, X), sub(Z, X))) / 2;
      if (area < 1e-12) return bad('Those lines meet in one point.');
      return { ents: [{ t: 'C', c: [(x * X[0] + y * Y[0] + z * Z[0]) / per, (x * X[1] + y * Y[1] + z * Z[1]) / per], r: (2 * area) / per }] };
    } },
  circArc: { steps: ['circ'], hints: ['Click an arc to complete it into a full circle.'],
    make: ([o]) => (o.ent.t === 'A' ? { ents: [{ t: 'C', c: o.ent.c, r: dist(o.ent.a, o.ent.c) }] } : bad('Click an arc.')) },
  arcCPA: { steps: ['pt', 'pt', 'pt'], hints: ['Click the center.', 'Click where the arc starts.', 'Click toward where it ends. The arc runs counter-clockwise.'],
    make: ([c, s, e]) => {
      const r = dist(c.pt, s.pt);
      if (r < 1e-9 || dist(c.pt, e.pt) < 1e-9) return bad('Pick points away from the center.');
      const end = add(c.pt, mul(unit(sub(e.pt, c.pt)), r));
      return dist(end, s.pt) < 1e-9 ? bad('The end is in the same direction as the start.') : { ents: [{ t: 'A', a: s.pt, b: end, c: c.pt, ccw: true }] };
    } },
  arcTan: { steps: ['line', 'pt'], hints: ['Click near the END of a line the arc should continue from.', 'Click where the arc should end.'],
    make: ([L, E]) => {
      const e = L.ent, atA = dist(L.at, e.a) < dist(L.at, e.b), S0 = atA ? e.a : e.b, d = unit(sub(S0, atA ? e.b : e.a));
      const n = perpL(d), v = sub(E.pt, S0), dn = dot(n, v);
      if (Math.abs(dn) < 1e-9) return bad('That end point is straight ahead of the line: use a line instead.');
      const t = dot(v, v) / (2 * dn);
      return { ents: [{ t: 'A', a: S0, b: E.pt, c: add(S0, mul(n, t)), ccw: t > 0 }] };
    } },
  ellipse: { steps: ['pt', 'pt', 'pt'], hints: ['Click the center.', 'Click the end of the long axis.', 'Click a point showing the short half-width.'],
    make: ([c, m, p]) => {
      const ax = sub(m.pt, c.pt), a = len(ax);
      if (a < 1e-9) return bad('Pick a point away from the center.');
      const ux = unit(ax), b = Math.abs(dot(sub(p.pt, c.pt), perpL(ux)));
      return b < 1e-9 ? bad('Click a point off to the side of the long axis.') : { ents: ellipseEnts(c.pt, ux, a, b) };
    } },
  ellipseF: { steps: ['pt', 'pt', 'pt'], hints: ['Click the first focus.', 'Click the second focus.', 'Click a point on the ellipse.'],
    make: ([f1, f2, p]) => {
      const a = (dist(p.pt, f1.pt) + dist(p.pt, f2.pt)) / 2, c = dist(f1.pt, f2.pt) / 2;
      if (a <= c + 1e-9) return bad('That point is too close to the line between the foci.');
      const ux = c < 1e-9 ? [1, 0] : unit(sub(f2.pt, f1.pt));
      return { ents: ellipseEnts(mul(add(f1.pt, f2.pt), 0.5), ux, a, Math.sqrt(a * a - c * c)) };
    } },
};

// ----- non-click helpers -----
export function simplifyPath(pts, tol) {          // Ramer-Douglas-Peucker
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let md = 0, mi = -1;
    for (let k = i + 1; k < j; k++) { const d = S.closestOn({ t: 'L', a: pts[i], b: pts[j] }, pts[k]).d; if (d > md) { md = d; mi = k; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Remove the corner point nearest the click when exactly two plain lines meet there; they become one line.
export function deleteNode(ents, click, tol) {
  let best = null, bd = tol;
  for (const e of ents) if (e.t !== 'C') for (const p of [e.a, e.b]) { const d = dist(p, click); if (d <= bd) { bd = d; best = p; } }
  if (!best) return bad('Click on a corner point where two lines meet.');
  const at = ents.filter((e) => e.t !== 'C' && (dist(e.a, best) < 1e-7 || dist(e.b, best) < 1e-7));
  if (at.length !== 2) return bad(at.length < 2 ? 'Only one piece ends there. Use Delete to remove it.' : 'More than two pieces meet there.');
  if (at.some((e) => e.t !== 'L')) return bad('Delete point works between two straight lines.');
  const far = (e) => (dist(e.a, best) < 1e-7 ? e.b : e.a);
  const a = far(at[0]), b = far(at[1]);
  if (dist(a, b) < 1e-9) return bad('Those two lines come back to the same point.');
  return { ents: ents.filter((e) => !at.includes(e)).concat([{ t: 'L', a, b }]) };
}
