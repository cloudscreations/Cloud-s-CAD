// Cloud's CAD - sketch engine. Pure geometry, no DOM. License: GPL v3
// Entities (immutable by convention):
//   {t:'L', a:[x,y], b:[x,y]}                    line
//   {t:'A', a, b, c, ccw}                        arc from a to b around c (ccw true = counter-clockwise)
//   {t:'C', c:[x,y], r}                          full circle
import { chain, bounds, flatten } from './core.js';

export const TAU = Math.PI * 2;
const EPS = 1e-9;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit = (a) => { const l = len(a); return l < EPS ? [0, 0] : [a[0] / l, a[1] / l]; };
const mod = (x, m) => ((x % m) + m) % m;
const same = (p, q, e = 1e-7) => Math.abs(p[0] - q[0]) <= e && Math.abs(p[1] - q[1]) <= e;

// ---------- arcs ----------
export function arcParams(s) {
  const r = dist(s.a, s.c);
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
  const a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
  let sweep = s.ccw ? mod(a1 - a0, TAU) : -mod(a0 - a1, TAU);
  if (Math.abs(sweep) < 1e-12) sweep = s.ccw ? TAU : -TAU;
  return { r, a0, a1, sweep };
}
export function arcMid(s) {
  const { r, a0, sweep } = arcParams(s);
  return [s.c[0] + r * Math.cos(a0 + sweep / 2), s.c[1] + r * Math.sin(a0 + sweep / 2)];
}
function arcPos(s, p) { // distance travelled along the arc (radians) to the direction of p, from a
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
  const ap = Math.atan2(p[1] - s.c[1], p[0] - s.c[0]);
  return s.ccw ? mod(ap - a0, TAU) : mod(a0 - ap, TAU);
}
function onArc(s, p) {
  const { sweep } = arcParams(s);
  return arcPos(s, p) <= Math.abs(sweep) + 1e-7;
}
// circle through three points -> arc a..b passing through m
export function arcFrom3(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = dot(a, a), m2 = dot(m, m), b2 = dot(b, b);
  const c = [
    (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d,
    (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d,
  ];
  const ccw = cross(sub(m, a), sub(b, m)) > 0;
  return { t: 'A', a, b, c, ccw };
}
// arc around a known centre from a start point to the direction of `toward`
export function arcFromCenter(c, start, toward, ccw = true) {
  const r = dist(c, start);
  const u = unit(sub(toward, c));
  if (r < EPS || len(u) < EPS) return null;
  return { t: 'A', a: start, b: [c[0] + u[0] * r, c[1] + u[1] * r], c, ccw };
}

// ---------- basic queries ----------
export function ends(e) {
  return e.t === 'C' ? [] : [e.a, e.b];
}
export function entLength(e) {
  if (e.t === 'L') return dist(e.a, e.b);
  if (e.t === 'C') return TAU * e.r;
  const { r, sweep } = arcParams(e);
  return r * Math.abs(sweep);
}
export function closestOn(e, p) {
  if (e.t === 'L') {
    const d = sub(e.b, e.a);
    const l2 = dot(d, d);
    const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, e.a), d) / l2));
    const q = [e.a[0] + d[0] * t, e.a[1] + d[1] * t];
    return { pt: q, d: dist(p, q) };
  }
  const r = e.t === 'C' ? e.r : dist(e.a, e.c);
  const u = unit(sub(p, e.c));
  if (len(u) < EPS) return { pt: e.a || add(e.c, [r, 0]), d: r };
  const q = [e.c[0] + u[0] * r, e.c[1] + u[1] * r];
  if (e.t === 'C' || onArc(e, q)) return { pt: q, d: Math.abs(dist(p, e.c) - r) };
  const da = dist(p, e.a), db = dist(p, e.b);
  return da < db ? { pt: e.a, d: da } : { pt: e.b, d: db };
}
export function hitTest(ents, p, tol) {
  let best = null, bd = tol;
  for (const e of ents) {
    const { d } = closestOn(e, p);
    if (d <= bd) { bd = d; best = e; }
  }
  return best;
}

// ---------- intersections ----------
function lineLine(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return [];
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return [];
  return [[a[0] + t * r[0], a[1] + t * r[1]]];
}
function lineCircle(a, b, c, r) {
  const d = sub(b, a), f = sub(a, c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (A < EPS || disc < -1e-12) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const out = [];
  for (const t of disc < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push([a[0] + d[0] * t, a[1] + d[1] * t]);
  }
  return out;
}
function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = unit(sub(c2, c1));
  const p = [c1[0] + u[0] * a, c1[1] + u[1] * a];
  if (h < 1e-9) return [p];
  return [[p[0] - u[1] * h, p[1] + u[0] * h], [p[0] + u[1] * h, p[1] - u[0] * h]];
}
export function intersect(e1, e2) {
  let pts = [];
  if (e1.t === 'L' && e2.t === 'L') pts = lineLine(e1.a, e1.b, e2.a, e2.b);
  else if (e1.t === 'L') pts = lineCircle(e1.a, e1.b, e2.c, e2.t === 'C' ? e2.r : dist(e2.a, e2.c)).filter((p) => e2.t === 'C' || onArc(e2, p));
  else if (e2.t === 'L') pts = lineCircle(e2.a, e2.b, e1.c, e1.t === 'C' ? e1.r : dist(e1.a, e1.c)).filter((p) => e1.t === 'C' || onArc(e1, p));
  else {
    const r1 = e1.t === 'C' ? e1.r : dist(e1.a, e1.c), r2 = e2.t === 'C' ? e2.r : dist(e2.a, e2.c);
    pts = circleCircle(e1.c, r1, e2.c, r2).filter((p) => (e1.t === 'C' || onArc(e1, p)) && (e2.t === 'C' || onArc(e2, p)));
  }
  return pts;
}

// ---------- splitting and trimming ----------
function splitAt(e, pts) {
  if (e.t === 'L') {
    const d = sub(e.b, e.a), l2 = dot(d, d);
    const ts = pts.map((p) => dot(sub(p, e.a), d) / l2).filter((t) => t > 1e-7 && t < 1 - 1e-7).sort((x, y) => x - y);
    const cuts = [0, ...ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-7), 1];
    const out = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const p = [e.a[0] + d[0] * cuts[i], e.a[1] + d[1] * cuts[i]], q = [e.a[0] + d[0] * cuts[i + 1], e.a[1] + d[1] * cuts[i + 1]];
      out.push({ t: 'L', a: i === 0 ? e.a : p, b: i + 2 === cuts.length ? e.b : q });
    }
    return out;
  }
  if (e.t === 'A') {
    const { sweep } = arcParams(e);
    const ds = pts.map((p) => arcPos(e, p)).filter((d) => d > 1e-7 && d < Math.abs(sweep) - 1e-7).sort((x, y) => x - y);
    const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]);
    const r = dist(e.a, e.c);
    const at = (d) => { const ang = a0 + (e.ccw ? d : -d); return [e.c[0] + r * Math.cos(ang), e.c[1] + r * Math.sin(ang)]; };
    const cuts = [0, ...ds.filter((d, i) => i === 0 || d - ds[i - 1] > 1e-7), Math.abs(sweep)];
    const out = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      out.push({ t: 'A', a: i === 0 ? e.a : at(cuts[i]), b: i + 2 === cuts.length ? e.b : at(cuts[i + 1]), c: e.c, ccw: e.ccw });
    }
    return out;
  }
  // circle: needs at least two cut points
  const angs = pts.map((p) => mod(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]), TAU)).sort((x, y) => x - y);
  const u = angs.filter((a, i) => i === 0 || a - angs[i - 1] > 1e-7);
  if (u.length < 2) return null;
  const at = (a) => [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];
  return u.map((a, i) => ({ t: 'A', a: at(a), b: at(u[(i + 1) % u.length]), c: e.c, ccw: true }));
}

// Remove the part of entity `id` nearest to `click` that lies between its crossings with other entities
export function trim(ents, id, click) {
  const target = ents.find((e) => e.id === id);
  if (!target) return { error: 'Nothing to trim there.' };
  const cuts = [];
  for (const o of ents) if (o.id !== id) cuts.push(...intersect(target, o));
  if (!cuts.length) return { error: 'This line has nothing crossing it to trim against.' };
  const pieces = splitAt(target, cuts);
  if (!pieces || pieces.length < 2) return { error: 'Nothing to trim: the crossing is at an end point.' };
  let k = 0, bd = Infinity;
  pieces.forEach((p, i) => { const d = closestOn(p, click).d; if (d < bd) { bd = d; k = i; } });
  return { ents: ents.filter((e) => e.id !== id).concat(pieces.filter((_, i) => i !== k)) };
}

// ---------- transforms ----------
function mapEnt(e, f, flip = false, k = 1) {
  if (e.t === 'L') {
    if (e.sp === undefined) return { t: 'L', a: f(e.a), b: f(e.b) };
    const o = { t: 'L', a: f(e.a), b: f(e.b), sp: e.sp };
    if (e.cp) { o.cp = e.cp.map(f); o.cl = e.cl; }
    return o;
  }
  if (e.t === 'C') return { t: 'C', c: f(e.c), r: e.r * k };
  return { t: 'A', a: f(e.a), b: f(e.b), c: f(e.c), ccw: flip ? !e.ccw : e.ccw };
}
const pick = (ents, ids) => ents.filter((e) => ids.includes(e.id));
export const move = (ents, ids, dx, dy) => ents.map((e) => (ids.includes(e.id) ? { ...mapEnt(e, (p) => [p[0] + dx, p[1] + dy]), id: e.id } : e));
export const copyBy = (ents, ids, dx, dy) => ents.concat(pick(ents, ids).map((e) => mapEnt(e, (p) => [p[0] + dx, p[1] + dy])));
function rotPt(p, about, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - about[0], y = p[1] - about[1];
  return [about[0] + x * c - y * s, about[1] + x * s + y * c];
}
export const rotate = (ents, ids, about, ang) => ents.map((e) => (ids.includes(e.id) ? { ...mapEnt(e, (p) => rotPt(p, about, ang)), id: e.id } : e));
export const rotateCopy = (ents, ids, about, ang) => ents.concat(pick(ents, ids).map((e) => mapEnt(e, (p) => rotPt(p, about, ang))));
export function scaleEnts(ents, ids, about, k) {
  const f = (p) => [about[0] + (p[0] - about[0]) * k, about[1] + (p[1] - about[1]) * k];
  return ents.map((e) => (ids.includes(e.id) ? { ...mapEnt(e, f, false, k), id: e.id } : e));
}

// Stretch the chosen objects by different amounts across and up. Lines stay lines; arcs and circles can't stay round when
// stretched unevenly, so they become many short straight pieces.
export function scaleXY(ents, ids, about, kx, ky) {
  if (Math.abs(kx - ky) < 1e-9) return scaleEnts(ents, ids, about, kx);
  const f = (p) => [about[0] + (p[0] - about[0]) * kx, about[1] + (p[1] - about[1]) * ky];
  const out = []; let converted = 0;
  for (const e of ents) {
    if (!ids.includes(e.id)) { out.push(e); continue; }
    if (e.t === 'L') { out.push({ ...mapEnt(e, f), id: e.id }); continue; }
    converted++;
    const c = e.t === 'C' ? e.c : e.c, r = e.t === 'C' ? e.r : dist(e.a, e.c);
    let a0, sweep;
    if (e.t === 'C') { a0 = 0; sweep = TAU; } else { const q = arcParams(e); a0 = q.a0; sweep = q.sweep; }
    const n = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 90)));
    const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    if (e.t === 'A') { pts[0] = e.a; pts[n] = e.b; } else pts[n] = pts[0];
    for (let i = 0; i < n; i++) out.push({ t: 'L', a: f(pts[i]), b: f(pts[i + 1]) });
  }
  out.converted = converted; return out;
}
function reflect(p, p1, p2) {
  const d = unit(sub(p2, p1));
  const v = sub(p, p1);
  const proj = dot(v, d);
  const foot = [p1[0] + d[0] * proj, p1[1] + d[1] * proj];
  return [2 * foot[0] - p[0], 2 * foot[1] - p[1]];
}
export function mirror(ents, ids, p1, p2, keep = true) {
  if (dist(p1, p2) < EPS) return ents;
  const m = pick(ents, ids).map((e) => mapEnt(e, (p) => reflect(p, p1, p2), true));
  return keep ? ents.concat(m) : ents.filter((e) => !ids.includes(e.id)).concat(m);
}
export function linearArray(ents, ids, count, dx, dy) {
  let out = ents;
  const src = pick(ents, ids);
  for (let i = 1; i < count; i++) out = out.concat(src.map((e) => mapEnt(e, (p) => [p[0] + dx * i, p[1] + dy * i])));
  return out;
}
export function polarArray(ents, ids, about, count, totalAngle) {
  let out = ents;
  const src = pick(ents, ids);
  const step = Math.abs(totalAngle - TAU) < 1e-9 ? totalAngle / count : totalAngle / Math.max(1, count - 1);
  for (let i = 1; i < count; i++) out = out.concat(src.map((e) => mapEnt(e, (p) => rotPt(p, about, step * i))));
  return out;
}
export const remove = (ents, ids) => ents.filter((e) => !ids.includes(e.id));

// ---------- extend, break, explode, join, stretch ----------
const stripCurve = (e) => (e.t === 'L' && e.sp !== undefined ? { t: 'L', a: e.a, b: e.b, id: e.id } : e);

// Lengthen the end of a line (the one nearest the click) until it meets the next object in its path.
export function extend(ents, id, click) {
  const L = ents.find((e) => e.id === id);
  if (!L || L.t !== 'L') return { error: 'Extend works on straight lines. Click near the end you want to lengthen.' };
  const key = dist(click, L.a) < dist(click, L.b) ? 'a' : 'b';
  const from = L[key], other = L[key === 'a' ? 'b' : 'a'];
  const d = unit(sub(from, other));
  if (len(d) < EPS) return { error: 'That line has no length.' };
  const ray = { t: 'L', a: from, b: add(from, mul(d, 1e6)) };
  let best = null;
  for (const o of ents) {
    if (o.id === id) continue;
    for (const p of intersect(ray, o)) {
      const t = dot(sub(p, from), d);
      if (t > 1e-7 && (best === null || t < best.t)) best = { t, p };
    }
  }
  if (!best) return { error: 'Nothing in that direction to extend to.' };
  const nl = key === 'a' ? { t: 'L', a: best.p, b: L.b, id: L.id } : { t: 'L', a: L.a, b: best.p, id: L.id };
  return { ents: ents.map((e) => (e.id === id ? nl : e)), by: best.t };
}

// Cut one line or arc in two at the point nearest the click.
export function breakAt(ents, id, click) {
  const e = ents.find((x) => x.id === id);
  if (!e) return { error: 'Click a line or arc.' };
  if (e.t === 'C') return { error: 'A full circle cannot be broken at one point. Use Explode to turn it into two arcs first.' };
  const q = closestOn(e, click).pt;
  const pieces = splitAt(e.t === 'L' ? stripCurve(e) : e, [q]);
  if (!pieces || pieces.length < 2) return { error: 'That is already an end point. Click somewhere along the line.' };
  return { ents: ents.filter((x) => x.id !== id).concat(pieces) };
}

// Circle -> two arcs. Smooth curve -> plain separate lines. (Lines, arcs: nothing to explode.)
export function explode(ents, ids) {
  const out = [];
  let n = 0;
  for (const e of ents) {
    if (!ids.includes(e.id)) { out.push(e); continue; }
    if (e.t === 'C') {
      const a = [e.c[0] + e.r, e.c[1]], b = [e.c[0] - e.r, e.c[1]];
      out.push({ t: 'A', a, b, c: e.c, ccw: true }, { t: 'A', a: b, b: a, c: e.c, ccw: true });
      n++;
    } else if (e.t === 'L' && e.sp !== undefined) { out.push(stripCurve(e)); n++; }
    else out.push(e);
  }
  return { ents: out, n };
}

// Close small gaps (end points within tol are pulled together) and merge straight lines that continue each other.
export function join(ents, ids, tol) {
  const use = ids && ids.length ? new Set(ids) : null;
  const inSet = (e) => !use || use.has(e.id);
  const centers = [];
  const snap = (p) => {
    for (const c of centers) if (dist(c, p) <= tol) return c;
    centers.push(p);
    return p;
  };
  let moved = 0;
  let list = ents.map((e) => {
    if (e.t === 'C' || !inSet(e)) return e;
    const a = snap(e.a), b = snap(e.b);
    if (a !== e.a && dist(a, e.a) > 1e-12) moved++;
    if (b !== e.b && dist(b, e.b) > 1e-12) moved++;
    return a === e.a && b === e.b ? e : { ...e, a, b };
  });
  list = list.filter((e) => e.t === 'C' || dist(e.a, e.b) > 1e-9 || e.t === 'A');
  let merged = 0;
  const same = (p, q) => dist(p, q) < 1e-9;
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < list.length && !again; i++) {
      const A = list[i];
      if (A.t !== 'L' || A.sp !== undefined || !inSet(A)) continue;
      for (const ka of ['a', 'b']) {
        const P = A[ka];
        const touching = list.filter((e) => e !== A && e.t !== 'C' && (same(e.a, P) || same(e.b, P)));
        if (touching.length !== 1) continue;
        const B = touching[0];
        if (B.t !== 'L' || B.sp !== undefined || !inSet(B)) continue;
        const A2 = A[ka === 'a' ? 'b' : 'a'], B2 = same(B.a, P) ? B.b : B.a;
        const u = unit(sub(P, A2)), w = unit(sub(B2, P));
        if (Math.abs(cross(u, w)) > 1e-6 || dot(u, w) < 0) continue;
        list = list.filter((e) => e !== A && e !== B).concat([{ t: 'L', a: A2, b: B2 }]);
        merged++; again = true; break;
      }
    }
  }
  return { ents: list, moved, merged };
}

// Move the end points that lie inside the box by (dx,dy); whole objects fully inside move as they are.
export function stretch(ents, box, dx, dy) {
  const x0 = Math.min(box[0][0], box[1][0]), x1 = Math.max(box[0][0], box[1][0]);
  const y0 = Math.min(box[0][1], box[1][1]), y1 = Math.max(box[0][1], box[1][1]);
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const mv = (p) => [p[0] + dx, p[1] + dy];
  let changed = 0, skipped = 0;
  const curvesTouched = new Set();
  const out = ents.map((e) => {
    if (e.t === 'C') { if (inside(e.c)) { changed++; return { ...e, c: mv(e.c) }; } return e; }
    const ia = inside(e.a), ib = inside(e.b);
    if (!ia && !ib) return e;
    if (e.t === 'A') {
      if (ia && ib && inside(e.c)) { changed++; return { ...e, a: mv(e.a), b: mv(e.b), c: mv(e.c) }; }
      if (ia && ib) { changed++; return { ...e, a: mv(e.a), b: mv(e.b), c: mv(e.c) }; }
      skipped++; return e;                 // an arc cut by the box edge would change shape: leave it
    }
    changed++;
    const keepCurve = ia && ib && e.sp !== undefined;
    if (e.sp !== undefined && !keepCurve) curvesTouched.add(e.sp);
    const base = keepCurve ? e : stripCurve(e);
    const n = { ...base, a: ia ? mv(e.a) : e.a, b: ib ? mv(e.b) : e.b };
    if (keepCurve && e.cp) n.cp = e.cp.map(mv);
    return n;
  });
  // a stretched curve stops being a smooth curve: turn its remaining pieces into plain lines too
  const final = curvesTouched.size ? out.map((e) => (e.t === 'L' && e.sp !== undefined && curvesTouched.has(e.sp) ? stripCurve(e) : e)) : out;
  return { ents: final, changed, skipped };
}

// ---------- corners ----------
function cornerData(A, B) {
  const P = lineLine(...extendLine(A), ...extendLine(B))[0];
  if (!P) return null;
  const KA = dist(A.a, P) >= dist(A.b, P) ? 'a' : 'b';
  const KB = dist(B.a, P) >= dist(B.b, P) ? 'a' : 'b';
  const uA = unit(sub(A[KA], P)), uB = unit(sub(B[KB], P));
  const cosT = Math.max(-1, Math.min(1, dot(uA, uB)));
  const theta = Math.acos(cosT);
  if (theta < 1e-6 || theta > Math.PI - 1e-6) return null;
  return { P, KA, KB, uA, uB, theta };
}
function extendLine(L) { // very long copy so the infinite intersection can be found with the segment routine
  const d = unit(sub(L.b, L.a));
  return [add(L.a, mul(d, -1e6)), add(L.b, mul(d, 1e6))];
}
function rebuildLine(L, K, T) { return K === 'a' ? { t: 'L', a: L.a, b: T } : { t: 'L', a: T, b: L.b }; }

export function fillet(ents, idA, idB, r) {
  const A = ents.find((e) => e.id === idA), B = ents.find((e) => e.id === idB);
  if (!A || !B || A.t !== 'L' || B.t !== 'L') return { error: 'Fillet works between two straight lines.' };
  const cd = cornerData(A, B);
  if (!cd) return { error: 'These lines are parallel, so they have no corner.' };
  const d = r / Math.tan(cd.theta / 2);
  const lA = dist(A[cd.KA], cd.P), lB = dist(B[cd.KB], cd.P);
  if (d > lA - 1e-9 || d > lB - 1e-9) return { error: `Radius too large for these lines (max about ${(Math.min(lA, lB) * Math.tan(cd.theta / 2)).toFixed(4)}).` };
  const TA = add(cd.P, mul(cd.uA, d)), TB = add(cd.P, mul(cd.uB, d));
  const C = add(cd.P, mul(unit(add(cd.uA, cd.uB)), r / Math.sin(cd.theta / 2)));
  const arc = { t: 'A', a: TA, b: TB, c: C, ccw: cross(sub(TA, C), sub(TB, C)) > 0 };
  return { ents: ents.filter((e) => e.id !== idA && e.id !== idB).concat([rebuildLine(A, cd.KA, TA), rebuildLine(B, cd.KB, TB), arc]) };
}
export function chamfer(ents, idA, idB, dist1) {
  const A = ents.find((e) => e.id === idA), B = ents.find((e) => e.id === idB);
  if (!A || !B || A.t !== 'L' || B.t !== 'L') return { error: 'Chamfer works between two straight lines.' };
  const cd = cornerData(A, B);
  if (!cd) return { error: 'These lines are parallel, so they have no corner.' };
  const lA = dist(A[cd.KA], cd.P), lB = dist(B[cd.KB], cd.P);
  if (dist1 > lA - 1e-9 || dist1 > lB - 1e-9) return { error: 'Chamfer distance is longer than the lines.' };
  const TA = add(cd.P, mul(cd.uA, dist1)), TB = add(cd.P, mul(cd.uB, dist1));
  return { ents: ents.filter((e) => e.id !== idA && e.id !== idB).concat([rebuildLine(A, cd.KA, TA), rebuildLine(B, cd.KB, TB), { t: 'L', a: TA, b: TB }]) };
}

// ---------- dimension edits ----------
export function setLineLength(e, L) {
  const u = unit(sub(e.b, e.a));
  return { ...e, b: add(e.a, mul(u, L)) };
}
export function setLineAngle(e, deg) {
  const L = dist(e.a, e.b), a = (deg * Math.PI) / 180;
  return { ...e, b: [e.a[0] + L * Math.cos(a), e.a[1] + L * Math.sin(a)] };
}
export function lineAngleDeg(e) { return (Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180) / Math.PI; }
export function setRadius(e, r) {
  if (e.t === 'C') return { ...e, r };
  if (e.t !== 'A') return e;
  // keep the end points, change the radius (keep the same short/long side)
  const chord = dist(e.a, e.b);
  if (r < chord / 2 - 1e-9) return null;
  const { sweep } = arcParams(e);
  const big = Math.abs(sweep) > Math.PI;
  const mid = mul(add(e.a, e.b), 0.5);
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const n = unit([-(e.b[1] - e.a[1]), e.b[0] - e.a[0]]); // left normal
  // centre is on the left of a->b for a short ccw arc, right for a short cw arc; long arcs flip
  const side = (e.ccw ? 1 : -1) * (big ? -1 : 1);
  return { ...e, c: add(mid, mul(n, h * side)) };
}

// Move a vertex shared by several entities; arcs keep passing through their old mid point
// Move the end point at `from` to `to`. With `ids`, only those objects move their end (the rest stay put, so a broken line comes apart).
export function moveVertex(ents, from, to, ids) {
  const only = ids && ids.length ? new Set(ids) : null;
  return ents.map((e) => {
    if (e.t === 'C' || (only && !only.has(e.id))) return e;
    const hitA = same(e.a, from), hitB = same(e.b, from);
    if (!hitA && !hitB) return e;
    if (e.t === 'L') return { ...e, a: hitA ? to : e.a, b: hitB ? to : e.b };
    const m = arcMid(e);
    const a = hitA ? to : e.a, b = hitB ? to : e.b;
    const arc = arcFrom3(a, m, b);
    return arc ? { ...arc, id: e.id } : { ...e, a, b };
  });
}

// ---------- shapes ----------
export function rectangle(p, q) {
  const a = [p[0], p[1]], b = [q[0], p[1]], c = [q[0], q[1]], d = [p[0], q[1]];
  return [{ t: 'L', a, b }, { t: 'L', a: b, b: c }, { t: 'L', a: c, b: d }, { t: 'L', a: d, b: a }];
}

// ---------- conversion with the machine pipeline ----------
export function toSegments(ents) {
  const out = [];
  for (const e of ents) {
    if (e.t === 'L') out.push(e.sp === undefined ? { t: 'L', a: e.a, b: e.b } : { t: 'L', a: e.a, b: e.b, sp: e.sp });
    else if (e.t === 'A') out.push({ t: 'A', a: e.a, b: e.b, c: e.c, ccw: e.ccw });
    else {
      const a = [e.c[0] + e.r, e.c[1]], b = [e.c[0] - e.r, e.c[1]];
      out.push({ t: 'A', a, b, c: e.c, ccw: true }, { t: 'A', a: b, b: a, c: e.c, ccw: true });
    }
  }
  return out;
}
export function fromSegments(segs) {
  return segs.map((s) => (s.t === 'L' ? (s.sp === undefined ? { t: 'L', a: s.a, b: s.b } : { t: 'L', a: s.a, b: s.b, sp: s.sp }) : { t: 'A', a: s.a, b: s.b, c: s.c, ccw: s.ccw })).filter((e) => e.t !== 'L' || dist(e.a, e.b) > 1e-9);
}
export function bbox(ents) {
  if (!ents.length) return null;
  return bounds([toSegments(ents)]);
}
export function cleanup(ents) {
  const out = [];
  const key = (e) => (e.t === 'L' ? [e.a, e.b].sort((p, q) => p[0] - q[0] || p[1] - q[1]).map((p) => p.map((v) => v.toFixed(6)).join(',')).join('|') : e.t === 'C' ? `C${e.c[0].toFixed(6)},${e.c[1].toFixed(6)},${e.r.toFixed(6)}` : [e.a, e.b].map((p) => p.map((v) => v.toFixed(6)).join(',')).join('>') + e.c.map((v) => v.toFixed(5)).join(',') + e.ccw);
  const seen = new Set();
  let removed = 0;
  for (const e of ents) {
    if ((e.t === 'L' && dist(e.a, e.b) < 1e-7) || (e.t === 'C' && e.r < 1e-7)) { removed++; continue; }
    const k = key(e);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k);
    out.push(e);
  }
  return { ents: out, removed };
}
// Describe the drawing: closed loops, open ends, so the user sees problems before cutting
export function profileReport(ents, tol) {
  const segs = toSegments(ents);
  if (!segs.length) return { paths: 0, closed: 0, open: [] };
  const chains = chain(segs, tol);
  const open = [];
  let closed = 0;
  for (const c of chains) {
    const first = c[0].a, last = c[c.length - 1].b;
    if (dist(first, last) <= tol * 1.0001 && c.length > 1) closed++;
    else open.push(first, last);
  }
  return { paths: chains.length, closed, open };
}

// ---------- snapping and selection ----------
export function snapCandidates(ents, p, tol, opts = {}) {
  const out = [];
  const near = (q, kind) => { const d = dist(p, q); if (d <= tol) out.push({ pt: q, d, kind }); };
  const near2 = [];
  for (const e of ents) {
    if (e.t === 'L') {
      if (opts.end !== false) { near(e.a, 'end'); near(e.b, 'end'); }
      if (opts.mid !== false) near(mul(add(e.a, e.b), 0.5), 'mid');
    } else if (e.t === 'A') {
      if (opts.end !== false) { near(e.a, 'end'); near(e.b, 'end'); }
      if (opts.center !== false) near(e.c, 'center');
      if (opts.mid !== false) near(arcMid(e), 'mid');
    } else {
      if (opts.center !== false) near(e.c, 'center');
      if (opts.quad !== false) for (const q of [[e.r, 0], [0, e.r], [-e.r, 0], [0, -e.r]]) near(add(e.c, q), 'quad');
    }
    if (dist(closestOn(e, p).pt, p) <= tol * 2) near2.push(e);
  }
  if (opts.inter !== false) {
    for (let i = 0; i < near2.length; i++) for (let j = i + 1; j < near2.length; j++) for (const q of intersect(near2[i], near2[j])) near(q, 'cross');
  }
  const rank = { end: 0, cross: 1, mid: 2, center: 2, quad: 3 };
  out.sort((x, y) => (rank[x.kind] - rank[y.kind]) || x.d - y.d);
  return out;
}
export function selectBox(ents, x0, y0, x1, y1, crossing) {
  const lo = [Math.min(x0, x1), Math.min(y0, y1)], hi = [Math.max(x0, x1), Math.max(y0, y1)];
  const inside = (p) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
  return ents.filter((e) => {
    const pts = e.t === 'C' ? flatten({ t: 'A', a: [e.c[0] + e.r, e.c[1]], b: [e.c[0] + e.r, e.c[1]], c: e.c, ccw: true }, 6) : flatten(e, 6);
    return crossing ? pts.some(inside) || segsCross(pts, lo, hi) : pts.every(inside);
  }).map((e) => e.id);
}
function segsCross(pts, lo, hi) {
  const edges = [[[lo[0], lo[1]], [hi[0], lo[1]]], [[hi[0], lo[1]], [hi[0], hi[1]]], [[hi[0], hi[1]], [lo[0], hi[1]]], [[lo[0], hi[1]], [lo[0], lo[1]]]];
  for (let i = 0; i + 1 < pts.length; i++) for (const e of edges) if (lineLine(pts[i], pts[i + 1], e[0], e[1]).length) return true;
  return false;
}

// ---------- document with undo/redo ----------
export class Sketch {
  constructor() { this.ents = []; this.nextId = 1; this.past = []; this.future = []; }
  _assign(list) { return list.map((e) => (e.id ? e : { ...e, id: this.nextId++ })); }
  set(list) {
    this.past.push(this.ents);
    if (this.past.length > 5000) this.past.shift();
    this.future = [];
    this.ents = this._assign(list);
    return this.ents;
  }
  add(list) { return this.set(this.ents.concat(list)); }
  undo() { if (!this.past.length) return false; this.future.push(this.ents); this.ents = this.past.pop(); return true; }
  redo() { if (!this.future.length) return false; this.past.push(this.ents); this.ents = this.future.pop(); return true; }
  clear() { this.set([]); }
}


// ---------- smooth curve through points (centripetal Catmull-Rom, drawn as many short lines tagged as one curve) ----------
let spCounter = 1;
export const newCurveId = () => 'c' + Date.now().toString(36) + (spCounter++);
export function curvePoints(pts, closed = false, per = 24) {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const P = (i) => (closed ? pts[((i % n) + n) % n] : i < 0 ? sub(mul(pts[0], 2), pts[1]) : i >= n ? sub(mul(pts[n - 1], 2), pts[n - 2]) : pts[i]);
  const segs = closed ? n : n - 1;
  const out = [pts[0]];
  const td = (a, b) => Math.sqrt(Math.max(dist(a, b), 1e-12));
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t0 = 0, t1 = t0 + td(p0, p1), t2 = t1 + td(p1, p2), t3 = t2 + td(p2, p3);
    for (let k = 1; k <= per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const lerp = (a, b, ta, tb) => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  if (closed) out[out.length - 1] = pts[0];
  return out;
}
export function curveEnts(pts, closed = false, id = newCurveId(), per = 24) {
  const q = curvePoints(pts, closed, per);
  const ents = [];
  for (let i = 0; i + 1 < q.length; i++) if (dist(q[i], q[i + 1]) > 1e-9) ents.push({ t: 'L', a: q[i], b: q[i + 1], sp: id });
  if (ents.length) { ents[0].cp = pts.map((p) => [p[0], p[1]]); ents[0].cl = !!closed; }
  return ents;
}

// ---------- parallel copy (offset) of one line, arc or circle ----------
// `side` is any point on the side where the copy should go. Returns the new entity or null.
export function offsetEnt(e, d, side) {
  if (!(d > 0)) return null;
  if (e.t === 'L') {
    const u = unit(sub(e.b, e.a));
    if (len(u) < 0.5) return null;
    const n = [-u[1], u[0]];
    const s = dot(sub(side, e.a), n) >= 0 ? 1 : -1;
    const o = mul(n, s * d);
    return { t: 'L', a: add(e.a, o), b: add(e.b, o) };
  }
  const c = e.c, r = e.t === 'C' ? e.r : arcParams(e).r;
  const out = dist(side, c) >= r;
  const r2 = out ? r + d : r - d;
  if (r2 <= 1e-9) return null;
  if (e.t === 'C') return { t: 'C', c, r: r2 };
  const k = r2 / r;
  return { t: 'A', a: add(c, mul(sub(e.a, c), k)), b: add(c, mul(sub(e.b, c), k)), c, ccw: e.ccw };
}

// Control points of a curve that is still whole and unchanged (so it can be reshaped). Returns {sp, cp, closed, ids} or null.
export function curveInfo(ents, sp) {
  const group = ents.filter((e) => e.sp === sp);
  const lead = group.find((e) => e.cp);
  if (!lead || group.length < 1) return null;
  const cp = lead.cp, closed = !!lead.cl;
  const first = group[0], last = group[group.length - 1];
  const tol = 1e-6 * (1 + Math.abs(cp[0][0]) + Math.abs(cp[0][1]));
  if (!first.cp || dist(first.a, cp[0]) > tol) return null;
  const end = closed ? cp[0] : cp[cp.length - 1];
  if (dist(last.b, end) > tol) return null;
  return { sp, cp, closed, ids: group.map((e) => e.id) };
}
export function replaceCurve(ents, sp, cp, closed) {
  const rest = ents.filter((e) => e.sp !== sp);
  return rest.concat(curveEnts(cp, closed, sp));
}

// Flip the direction of the chosen pieces: each line/arc runs the other way and their order is reversed
export function reverseEnts(ents, ids) {
  const idx = ents.map((e, i) => (ids.includes(e.id) && (e.t === 'L' || e.t === 'A') ? i : -1)).filter((i) => i >= 0);
  const flipped = idx.map((i) => { const e = ents[i]; return e.t === 'L' ? { ...e, a: e.b, b: e.a } : { ...e, a: e.b, b: e.a, ccw: !e.ccw }; }).reverse();
  const out = ents.slice();
  idx.forEach((i, k) => { out[i] = { ...flipped[k], id: ents[i].id }; });
  return out;
}
// Total length and the area inside closed outlines (holes are not subtracted)
export function sizeInfo(ents, tol) {
  let length = 0;
  for (const e of ents) length += entLength(e);
  let area = 0, closed = 0;
  for (const c of chain(toSegments(ents), tol)) {
    if (c.length < 2 && c[0].t === 'L') continue;
    if (dist(c[0].a, c[c.length - 1].b) > tol * 1.0001) continue;
    const pts = [];
    for (const sg of c) {
      pts.push(sg.a);
      if (sg.t === 'A') { const ap = arcParams(sg); for (let i = 1; i < 24; i++) { const t = ap.a0 + (ap.sweep * i) / 24; pts.push([sg.c[0] + ap.r * Math.cos(t), sg.c[1] + ap.r * Math.sin(t)]); } }
    }
    let a2 = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
    area += Math.abs(a2) / 2; closed++;
  }
  return { length, area, closed };
}
