// Cloud's CAD - shape tools: file cleanup, mirror-and-join, smoothing, and profile matching. Pure geometry, no DOM. License: GPL v3
import * as S from './sketch.js';
import { chain, flatten } from './core.js';
import { simplifyPath } from './construct.js';

const dist = S.dist;

// ---------- cleanup ----------
// Remove zero-length and duplicate pieces, merge lines that overlap on the same line, delete tiny loose specks, close small gaps.
export function cleanupAll(ents, { tol = 0.002, speck = 0.02 } = {}) {
  const rep = { zero: 0, dup: 0, overlap: 0, specks: 0, gapsClosed: 0, merged: 0 };
  const n0 = ents.length;
  let r = S.cleanup(ents);
  let list = r.ents;
  { const z = list.filter((e) => (e.t === 'L' && dist(e.a, e.b) < tol * 0.01) || (e.t === 'C' && e.r < tol * 0.01)).length; rep.zero = z; if (z) list = list.filter((e) => !((e.t === 'L' && dist(e.a, e.b) < tol * 0.01) || (e.t === 'C' && e.r < tol * 0.01))); }
  rep.dup = n0 - list.length - rep.zero; if (rep.dup < 0) rep.dup = 0;

  // overlapping lines on the same infinite line
  const plain = [], rest = [];
  for (const e of list) (e.t === 'L' && e.sp === undefined ? plain : rest).push(e);
  const groups = [];   // {dx,dy,c,items:[{e,t0,t1}]}
  const angTol = 1e-5;
  for (const e of plain) {
    let dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1]; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
    if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0)) { dx = -dx; dy = -dy; }
    const c = -dy * e.a[0] + dx * e.a[1];
    let g = groups.find((q) => Math.abs(q.dx * dy - q.dy * dx) < angTol && Math.abs(c - q.c) < tol * 0.5 && q.dx * dx + q.dy * dy > 0);
    if (!g) { g = { dx, dy, c, items: [] }; groups.push(g); }
    const t0 = g.dx * e.a[0] + g.dy * e.a[1], t1 = g.dx * e.b[0] + g.dy * e.b[1];
    g.items.push({ e, lo: Math.min(t0, t1), hi: Math.max(t0, t1) });
  }
  const outLines = [];
  for (const g of groups) {
    if (g.items.length === 1) { outLines.push(g.items[0].e); continue; }
    g.items.sort((p, q) => p.lo - q.lo);
    let cur = { lo: g.items[0].lo, hi: g.items[0].hi, e: g.items[0].e, n: 1 };
    const flush = () => {
      if (cur.n === 1) outLines.push(cur.e);
      else { rep.overlap += cur.n - 1; outLines.push({ t: 'L', a: [g.dx * cur.lo - g.dy * g.c, g.dy * cur.lo + g.dx * g.c], b: [g.dx * cur.hi - g.dy * g.c, g.dy * cur.hi + g.dx * g.c] }); }
    };
    for (let i = 1; i < g.items.length; i++) {
      const it = g.items[i];
      if (it.lo < cur.hi - tol) { cur.hi = Math.max(cur.hi, it.hi); cur.n++; }   // real overlap (touching end to end is left alone so corners stay connected)
      else { flush(); cur = { lo: it.lo, hi: it.hi, e: it.e, n: 1 }; }
    }
    flush();
  }
  list = rest.concat(outLines);

  // near-duplicates: two lines whose ends are both within tolerance of each other (noisy double lines)
  {
    const cell = Math.max(tol * 4, 1e-9), buckets = new Map(), drop = new Set();
    const key = (x, y) => Math.round(x / cell) + ',' + Math.round(y / cell);
    list.forEach((e, i) => {
      if (e.t !== 'L' || e.sp !== undefined) return;
      const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2, cx = Math.round(mx / cell), cy = Math.round(my / cell);
      let dupOf = false;
      for (let ix = -1; ix <= 1 && !dupOf; ix++) for (let iy = -1; iy <= 1 && !dupOf; iy++) for (const j of buckets.get((cx + ix) + ',' + (cy + iy)) || []) {
        const o = list[j];
        if ((dist(e.a, o.a) <= tol * 1.5 && dist(e.b, o.b) <= tol * 1.5) || (dist(e.a, o.b) <= tol * 1.5 && dist(e.b, o.a) <= tol * 1.5)) { dupOf = true; break; }
      }
      if (dupOf) { drop.add(i); rep.dup++; } else { const k = key(mx, my); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
    });
    if (drop.size) list = list.filter((_, i) => !drop.has(i));
  }

  // tiny loose specks: small things that touch nothing else
  if (speck > 0) {
    const pts = [];
    list.forEach((e, i) => { if (e.t !== 'C') { pts.push([e.a, i], [e.b, i]); } });
    const touches = (e, i) => (e.t === 'C' ? false : [e.a, e.b].some((p) => pts.some(([q, j]) => j !== i && dist(p, q) <= tol * 1.5)));
    const keep = list.filter((e, i) => {
      const small = e.t === 'C' ? e.r * 2 < speck : S.entLength(e) < speck;
      if (small && !touches(e, i)) { rep.specks++; return false; }
      return true;
    });
    list = keep;
  }

  // close tiny gaps and merge straight runs
  const j = S.join(list, null, tol);
  rep.gapsClosed = j.moved; rep.merged = j.merged; list = j.ents;
  return { ents: list, report: rep, summary: describeCleanup(rep) };
}
export function describeCleanup(r) {
  const bits = [];
  if (r.zero) bits.push(`${r.zero} zero-length`);
  if (r.dup) bits.push(`${r.dup} duplicate`);
  if (r.overlap) bits.push(`${r.overlap} overlapping`);
  if (r.specks) bits.push(`${r.specks} tiny loose speck${r.specks === 1 ? '' : 's'}`);
  const done = bits.length ? `Removed ${bits.join(', ')}.` : 'No duplicates or specks found.';
  const more = [];
  if (r.gapsClosed) more.push(`closed ${r.gapsClosed} small gap end${r.gapsClosed === 1 ? '' : 's'}`);
  if (r.merged) more.push(`merged ${r.merged} straight piece${r.merged === 1 ? '' : 's'}`);
  return done + (more.length ? ' Also ' + more.join(' and ') + '.' : '');
}

// Guess the unit a file is really in from its size. Crown profiles are normally 1 to 12 inches across.
export function guessUnits(declared, w, h) {
  const m = Math.max(w, h);
  if (!(m > 0)) return null;
  if (declared === 'in' && m > 60) return { unit: 'mm', why: `${m.toFixed(1)} wide is a lot for inches` };
  if (declared === 'mm' && m < 8) return { unit: 'in', why: `${m.toFixed(2)} wide is tiny for millimeters` };
  return null;
}

// ---------- mirror and join ----------
export function mirrorJoin(ents, ids, p1, p2, tol = 0.002) {
  const use = ids && ids.length ? ids : ents.map((e) => e.id);
  const mirrored = S.mirror(ents, use, p1, p2, true).slice(ents.length);
  const d = S.unit(S.sub(p2, p1));
  const onAxis = (p) => Math.abs(S.cross(d, S.sub(p, p1))) <= tol;
  const isAxisPiece = (e) => (e.t === 'L' && onAxis(e.a) && onAxis(e.b)) || (e.t === 'C' && false);
  const keepOrig = ents.filter((e) => !(use.includes(e.id) && isAxisPiece(e)));
  const keepMir = mirrored.filter((e) => !isAxisPiece(e));
  const removed = ents.length - keepOrig.length + (mirrored.length - keepMir.length);
  const j = S.join(keepOrig.concat(keepMir), null, tol * 1.5);
  return { ents: j.ents, removedOnAxis: removed, joined: j.moved, merged: j.merged };
}
// Axis through an edge of the selection: 'right' 'left' 'top' 'bottom'
export function edgeAxis(ents, side) {
  const b = S.bbox(ents); if (!b) return null;
  return { right: [[b.x1, b.y0], [b.x1, b.y1]], left: [[b.x0, b.y0], [b.x0, b.y1]], top: [[b.x0, b.y1], [b.x1, b.y1]], bottom: [[b.x0, b.y0], [b.x1, b.y0]] }[side] || null;
}

// ---------- smoothing traced outlines ----------
export function smoothChains(ents, ids, { tol = 0.01, cornerDeg = 40, gap = 0.002 } = {}) {
  const use = new Set(ids && ids.length ? ids : ents.map((e) => e.id));
  const pick = ents.filter((e) => use.has(e.id) && e.t !== 'C' && e.sp === undefined);
  if (!pick.length) return { ents, n: 0 };
  const keep = ents.filter((e) => !pick.includes(e));
  const chains = chain(S.toSegments(pick), gap);
  const made = []; let n = 0;
  for (const c of chains) {
    const pts = [c[0].a];
    for (const s of c) { const f = flatten(s); for (let i = 1; i < f.length; i++) pts.push(f[i]); }
    if (pts.length < 4) { made.push(...S.fromSegments(c)); continue; }
    const closed = dist(pts[0], pts[pts.length - 1]) <= gap * 1.5;
    if (closed) pts.pop();
    const m = pts.length, corner = [];
    const ang = (i) => {
      const a = pts[(i - 1 + m) % m], b = pts[i], d = pts[(i + 1) % m];
      const u = S.unit(S.sub(b, a)), v = S.unit(S.sub(d, b));
      return (Math.acos(Math.max(-1, Math.min(1, S.dot(u, v)))) * 180) / Math.PI;
    };
    for (let i = 0; i < m; i++) { if (!closed && (i === 0 || i === m - 1)) continue; if (ang(i) > cornerDeg) corner.push(i); }
    // cut into runs between corners
    const runs = [];
    if (!corner.length) runs.push({ p: closed ? pts.concat([pts[0]]) : pts, closed });
    else {
      const idx = closed ? corner : [0, ...corner, m - 1];
      for (let k = 0; k < idx.length - (closed ? 0 : 1); k++) {
        const s = idx[k], e = idx[(k + 1) % idx.length], run = [pts[s]];
        for (let i = (s + 1) % m; ; i = (i + 1) % m) { run.push(pts[i]); if (i === e) break; if (run.length > m + 2) break; }
        runs.push({ p: run, closed: false });
      }
    }
    for (const r of runs) {
      const sp = simplifyPath(r.p, tol);
      if (sp.length <= 2) made.push({ t: 'L', a: sp[0], b: sp[sp.length - 1] });
      else if (r.closed && sp.length >= 3) { made.push(...S.curveEnts(sp.slice(0, -1), true)); }
      else made.push(...S.curveEnts(sp, false));
    }
    n++;
  }
  return { ents: keep.concat(made), n };
}

// ---------- matching ----------
// Points spread evenly along everything in the drawing, scaled so the longest side is 1 and centred on 0.
export function shapePoints(ents, count = 160) {
  const polys = S.toSegments(ents).map((s) => flatten(s, 4));
  let total = 0; const lens = polys.map((p) => { let l = 0; for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]); total += l; return l; });
  if (!(total > 0)) return null;
  const pts = [], step = total / count;
  let carry = step / 2;
  polys.forEach((p) => {
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], L = dist(a, b);
      let t = carry;
      while (t <= L) { pts.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; }
      carry = t - L;
    }
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const w = x1 - x0, h = y1 - y0, k = Math.max(w, h) || 1;
  return { pts: pts.map((q) => [(q[0] - (x0 + x1) / 2) / k, (q[1] - (y0 + y1) / 2) / k]), w, h };
}
function meanNN(A, B) {
  let s = 0;
  for (const a of A) { let m = Infinity; for (const b of B) { const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; if (d < m) m = d; } s += Math.sqrt(m); }
  return s / A.length;
}
const VARIANTS = [
  { name: 'same way round', f: (p) => p }, { name: 'turned 90°', f: (p) => [-p[1], p[0]] }, { name: 'turned 180°', f: (p) => [-p[0], -p[1]] }, { name: 'turned 270°', f: (p) => [p[1], -p[0]] },
  { name: 'flipped left-right', f: (p) => [-p[0], p[1]] }, { name: 'flipped up-down', f: (p) => [p[0], -p[1]] },
  { name: 'flipped and turned 90°', f: (p) => [p[1], p[0]] }, { name: 'flipped and turned 270°', f: (p) => [-p[1], -p[0]] },
];
// How alike two outlines are, ignoring size. Returns {pct, how, d}.
export function compareShapes(a, b) {
  if (!a || !b) return { pct: 0, how: '', d: 1 };
  let best = { d: Infinity, how: '' };
  for (const v of VARIANTS) {
    const B = b.pts.map(v.f);
    const d = (meanNN(a.pts, B) + meanNN(B, a.pts)) / 2;
    if (d < best.d) best = { d, how: v.name };
  }
  return { pct: Math.round(100 * Math.max(0, 1 - best.d / 0.05)), how: best.how, d: best.d };
}
// Rank library entries by how well they match `ents`. Entries need {id, ents}. Returns sorted [{id, pct, how}]
export function rankMatches(ents, library, count = 160) {
  const me = shapePoints(ents, count);
  if (!me) return [];
  return library.map((it) => {
    const sp = it.pts ? { pts: it.pts, w: it.w, h: it.h } : shapePoints(it.ents, count);
    const r = compareShapes(me, sp);
    return { id: it.id, pct: r.pct, how: r.how };
  }).sort((p, q) => q.pct - p.pct);
}
