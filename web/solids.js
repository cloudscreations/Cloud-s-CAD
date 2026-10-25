// Cloud's CAD - solid modelling: revolve, sweep, loft, round edges, hollow, clearance, holes. License: GPL v3
// Uses the manifold-3d kernel (Apache-2.0, WebAssembly, packed inside the page and unpacked only when first needed).
// Every function takes and returns flat triangle lists (Float32Array, 9 numbers per triangle), the same as state.model.
import ManifoldModule from 'manifold-3d';
import { planarRegions } from './mesh.js';

// ---------------------------------------------------------------- kernel
let kernelP = null;
export async function getWasmBytes() {
  const el = typeof document !== 'undefined' && document.getElementById('mfWasm');
  if (!el) throw new Error('The solid-modelling engine is not included in this copy of the app.');
  const bin = atob(el.textContent.trim());
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
let loader = async () => {
  const wasmBinary = await getWasmBytes();
  const w = await ManifoldModule({ wasmBinary });
  w.setup();
  return w;
};
export function setKernelLoader(fn) { loader = fn; kernelP = null; }
export function kernel() {
  if (!kernelP) { kernelP = loader().then((w) => (w.setup && w.setup.__done ? w : w)); kernelP.catch(() => { kernelP = null; }); }
  return kernelP;
}

// ---------------------------------------------------------------- converting
const okStatus = (s) => String(s && s.value !== undefined ? s.value : s) === 'NoError' || String(s) === 'NoError';

export function signedVolume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

// Triangle soup -> welded indexed mesh { verts: Float32Array, tris: Uint32Array }
export function weldSoup(pos, tol) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
  const q = tol || diag * 1e-6;
  const map = new Map(), verts = [], idx = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) {
    const key = Math.round(pos[i] / q) + ',' + Math.round(pos[i + 1] / q) + ',' + Math.round(pos[i + 2] / q);
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(pos[i], pos[i + 1], pos[i + 2]); }
    idx[i / 3] = k;
  }
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t + 1] && idx[t + 1] !== idx[t + 2] && idx[t] !== idx[t + 2]) tris.push(idx[t], idx[t + 1], idx[t + 2]);
  return { verts: Float32Array.from(verts), tris: Uint32Array.from(tris) };
}

export function toManifold(K, pos) {
  if (!pos || !pos.length) throw new Error('There is no model yet.');
  const w = weldSoup(pos);
  let tris = w.tris;
  if (signedVolume(pos) < 0) { tris = Uint32Array.from(tris); for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; } }
  let m;
  try {
    const mesh = new K.Mesh({ numProp: 3, vertProperties: w.verts, triVerts: tris });
    mesh.merge();
    m = new K.Manifold(mesh);
  } catch (e) {
    throw new Error('This model has holes or faces that do not join up, so it cannot be edited as a solid. Run the print check to see where.');
  }
  if (!okStatus(m.status())) throw new Error('This model has holes or faces that do not join up, so it cannot be edited as a solid. Run the print check to see where.');
  return m;
}

export function fromManifold(m) {
  const mesh = m.getMesh(), vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts;
  const out = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) { out[i * 3] = vp[tv[i] * np]; out[i * 3 + 1] = vp[tv[i] * np + 1]; out[i * 3 + 2] = vp[tv[i] * np + 2]; }
  return out;
}

function bboxOf(pos) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1], size: [x1 - x0, y1 - y0, z1 - z0] };
}

// Runs fn(K, manifold) and returns triangles; always cleans up.
async function withModel(pos, fn) {
  const K = await kernel();
  const m = toManifold(K, pos);
  const r = fn(K, m);
  const out = fromManifold(r);
  if (!out.length) throw new Error('That left nothing: the numbers are too large for this model.');
  return out;
}

// ---------------------------------------------------------------- solids from a drawing
export async function revolveLoops(loops, { degrees = 360, segments = 72, axisX = 0 } = {}) {
  if (!loops.length) throw new Error('There is no closed outline to revolve.');
  const K = await kernel();
  let minX = Infinity, maxX = -Infinity;
  for (const l of loops) for (const p of l) { minX = Math.min(minX, p[0] - axisX); maxX = Math.max(maxX, p[0] - axisX); }
  let flip = 1;
  if (minX < -1e-9 && maxX > 1e-9) throw new Error('The outline crosses the line it spins around. Move the outline to one side of the axis (the vertical line at the left of the drawing), or choose "spin around the left edge of the outline".');
  if (maxX <= 1e-9) flip = -1;
  const polys = loops.map((l) => l.map((p) => [(p[0] - axisX) * flip, p[1]]));
  const m = K.Manifold.revolve(polys, Math.max(8, Math.round(segments)), Math.max(1, Math.min(360, degrees)));
  const out = fromManifold(m);
  if (!out.length) throw new Error('That revolve made nothing. Check that the outline is closed and not touching the axis only at a point.');
  return out;
}

// Resample a ring to n points evenly spaced along its length
function resampleRing(ring, n) {
  const pts = ring.slice(); const L = [0];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = L[L.length - 1], out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / n;
    while (k < pts.length - 1 && L[k + 1] < d) k++;
    const a = pts[k], b = pts[(k + 1) % pts.length], seg = L[k + 1] - L[k] || 1, t = (d - L[k]) / seg;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const centroidOf = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };

function solidFromLayers(layers, capStart, capEnd) {
  // layers: array of stations, each a list of rings (3D points), rings[0] outer CCW as seen along +direction, same ring structure everywhere
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  const S = layers.length;
  for (let s = 0; s + 1 < S; s++) {
    for (let r = 0; r < layers[s].length; r++) {
      const A = layers[s][r], B = layers[s + 1][r];
      for (let i = 0; i < A.length; i++) {
        const j = (i + 1) % A.length;
        tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]);
      }
    }
  }
  return { out, tri };
}

// Sweeps closed outlines along a path in the drawing (flat on the floor, Z up). The outline's X becomes sideways, its Y becomes up.
export async function sweepLoops(loops, path, { anchor = 'center', closed = false } = {}) {
  if (!loops.length) throw new Error('There is no closed outline to sweep.');
  if (!path || path.length < 2) throw new Error('There is no open line or curve to sweep along. Draw the path as one connected line.');
  const regions = planarRegions(loops);
  if (!regions.length) throw new Error('The outline could not be read. Check that it is closed.');
  // where the outline sits on the path
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of loops) for (const p of l) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const ax = anchor === 'origin' ? 0 : (x0 + x1) / 2, ay = anchor === 'origin' ? 0 : anchor === 'bottom' ? y0 : (y0 + y1) / 2;
  // drop repeated points
  let P = [path[0]];
  for (let i = 1; i < path.length; i++) if (Math.hypot(path[i][0] - P[P.length - 1][0], path[i][1] - P[P.length - 1][1]) > 1e-9) P.push(path[i]);
  const isLoop = closed || (P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6);
  if (isLoop && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6) P = P.slice(0, -1);
  if (P.length < 2) throw new Error('The path is too short.');
  const n = P.length;
  // tangent at each station (mitred at corners)
  const dir = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const stations = [];
  for (let i = 0; i < n; i++) {
    let t, scale = 1;
    const prev = i > 0 ? dir(P[i - 1], P[i]) : (isLoop ? dir(P[n - 1], P[0]) : null);
    const next = i < n - 1 ? dir(P[i], P[i + 1]) : (isLoop ? dir(P[n - 1], P[0]) : null);
    if (prev && next) {
      const sx = prev[0] + next[0], sy = prev[1] + next[1], l = Math.hypot(sx, sy);
      if (l < 1e-9) throw new Error('The path doubles back on itself at a sharp point. Round that corner first.');
      t = [sx / l, sy / l];
      const c = t[0] * prev[0] + t[1] * prev[1];
      scale = Math.min(3, 1 / Math.max(c, 0.3));
    } else t = prev || next;
    stations.push({ p: P[i], t, scale });
  }
  const place = (st, x, y) => {
    const L = [-st.t[1], st.t[0]];
    const lx = (x - ax) * st.scale;
    return [st.p[0] + L[0] * lx, st.p[1] + L[1] * lx, y - ay];
  };
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  for (const reg of regions) {
    const layers = stations.map((st) => reg.rings.map((ring) => ring.map((q) => place(st, q[0], q[1]))));
    const S = layers.length;
    const lim = isLoop ? S : S - 1;
    for (let s = 0; s < lim; s++) {
      const s2 = (s + 1) % S;
      for (let r = 0; r < reg.rings.length; r++) {
        const A = layers[s][r], B = layers[s2][r];
        for (let i = 0; i < A.length; i++) {
          const j = (i + 1) % A.length;
          if (Math.hypot(A[i][0] - A[j][0], A[i][1] - A[j][1], A[i][2] - A[j][2]) < 1e-12) continue;
          tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]);
        }
      }
    }
    if (!isLoop) {
      for (const f of reg.faces) {
        tri(place(stations[0], ...f[0]), place(stations[0], ...f[2]), place(stations[0], ...f[1]));          // start cap faces backwards
        tri(place(stations[S - 1], ...f[0]), place(stations[S - 1], ...f[1]), place(stations[S - 1], ...f[2])); // end cap faces forwards
      }
    }
  }
  const pos = new Float32Array(out);
  const K = await kernel();
  const m = (() => { try { return toManifold(K, pos); } catch (e) { return null; } })();
  if (!m) throw new Error('The sweep folded over itself (the path turns too tightly for this outline). Use a gentler path, a smaller outline, or round the path corners.');
  return fromManifold(m);
}

// Joins two closed outlines (bottom and top) with a smooth ruled skin.
export async function loftLoops(bottom, top, { height = 2, align = true, steps = 96 } = {}) {
  if (!bottom || !top) throw new Error('A loft needs two closed outlines: the bottom one and the top one.');
  const prep = (ring) => { let r = resampleRing(ring, steps); if (ringArea(r) < 0) r = r.reverse(); return r; };
  let A = prep(bottom), B = prep(top);
  const ca = centroidOf(A), cb = centroidOf(B);
  const B0 = align ? B.map((p) => [p[0] - cb[0] + ca[0], p[1] - cb[1] + ca[1]]) : B;
  // rotate the top ring so its first point is the closest match to the bottom's first point
  let best = 0, bd = Infinity;
  const ang = (p, c) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const a0 = ang(A[0], ca);
  for (let k = 0; k < B0.length; k++) {
    let d = Math.abs(ang(B0[k], align ? ca : cb) - a0); d = Math.min(d, 2 * Math.PI - d);
    if (d < bd) { bd = d; best = k; }
  }
  B = B0.slice(best).concat(B0.slice(0, best));
  const regA = planarRegions([A])[0], regB = planarRegions([B])[0];
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  const n = A.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [...A[i], 0], b = [...A[j], 0], c = [...B[j], height], d = [...B[i], height];
    tri(a, b, c); tri(a, c, d);
  }
  for (const f of regA.faces) tri([...f[0], 0], [...f[2], 0], [...f[1], 0]);
  for (const f of regB.faces) tri([...f[0], height], [...f[1], height], [...f[2], height]);
  const K = await kernel();
  const pos = new Float32Array(out);
  let m;
  try { m = toManifold(K, pos); } catch (e) { throw new Error('The loft folded over itself. Make the two outlines more alike, or lower the height.'); }
  return fromManifold(m);
}

// ---------------------------------------------------------------- editing a solid
const sphereOf = (K, r) => K.Manifold.sphere(r, 20);
const octaOf = (K, d) => K.Manifold.hull([[d, 0, 0], [-d, 0, 0], [0, d, 0], [0, -d, 0], [0, 0, d], [0, 0, -d]]);
const TRI_LIMIT = 8000;
function limitCheck(m) { if (m.numTri() > TRI_LIMIT) throw new Error('This model is too detailed for that edit (' + m.numTri() + ' triangles; the limit is ' + TRI_LIMIT + '). Rounding and hollowing get very slow on curved models. Try it on a simpler version, or do this step before adding fine curves.'); }

// Rounds the outside edges ("outer") or the inside corners ("inner") with radius r
export function roundEdges(pos, r, kind = 'outer') {
  if (!(r > 0)) throw new Error('Type a radius bigger than 0.');
  return withModel(pos, (K, m) => {
    limitCheck(m);
    const s = sphereOf(K, r);
    return kind === 'inner' ? m.minkowskiSum(s).minkowskiDifference(s) : m.minkowskiDifference(s).minkowskiSum(s);
  });
}
// Cuts the outside edges ("outer") or fills the inside corners ("inner") at 45 degrees, d long
export function chamferEdges(pos, d, kind = 'outer') {
  if (!(d > 0)) throw new Error('Type a distance bigger than 0.');
  return withModel(pos, (K, m) => {
    limitCheck(m);
    const o = octaOf(K, d);
    return kind === 'inner' ? m.minkowskiSum(o).minkowskiDifference(o) : m.minkowskiDifference(o).minkowskiSum(o);
  });
}
// Hollows the part with walls t thick. openTop leaves the top open like a cup.
export function shellModel(pos, t, { openTop = false } = {}) {
  if (!(t > 0)) throw new Error('Type a wall thickness bigger than 0.');
  return withModel(pos, (K, m) => {
    limitCheck(m);
    const b = bboxOf(fromManifold(m));
    let inner = m.minkowskiDifference(sphereOf(K, t));
    if (inner.isEmpty()) throw new Error('The walls are thicker than the part. Use a smaller wall thickness.');
    if (openTop) {
      const ib = inner.boundingBox();
      const foot = inner.project();
      const chimney = foot.extrude(Math.max(b.max[2] - ib.min[2], 0) + t + 1).translate([0, 0, (ib.max[2] - 1e-6)]);
      inner = inner.add(chimney.translate([0, 0, 0]));
    }
    return m.subtract(inner);
  });
}
// Grows (d > 0) or shrinks (d < 0) the whole part by d on every face: clearance for parts that must fit together
export function offsetModel(pos, d) {
  if (!d) throw new Error('Type a distance (positive to grow, negative to shrink).');
  return withModel(pos, (K, m) => {
    limitCheck(m);
    const s = sphereOf(K, Math.abs(d));
    return d > 0 ? m.minkowskiSum(s) : m.minkowskiDifference(s);
  });
}
// Straight round hole down through Z. x,y measured from the model's left/front edge. depth 0 = all the way through.
export function addHole(pos, { x, y, dia, depth = 0, fromTop = true, countersinkDia = 0 }) {
  if (!(dia > 0)) throw new Error('Type a hole diameter bigger than 0.');
  return withModel(pos, (K, m) => {
    const b = bboxOf(fromManifold(m));
    const H = b.size[2], dep = depth > 0 ? Math.min(depth, H) : H + 2;
    const px = b.min[0] + x, py = b.min[1] + y;
    const z0 = fromTop ? b.max[2] - dep : b.min[2] - (depth > 0 ? 0 : 1);
    const len = depth > 0 ? dep : H + 2;
    let cut = K.Manifold.cylinder(len + (depth > 0 ? 0.0 : 0), dia / 2, dia / 2, 48).translate([px, py, depth > 0 ? z0 : b.min[2] - 1]);
    if (depth > 0 && fromTop) cut = K.Manifold.cylinder(dep + 1, dia / 2, dia / 2, 48).translate([px, py, b.max[2] - dep]);
    if (depth > 0 && !fromTop) cut = K.Manifold.cylinder(dep + 1, dia / 2, dia / 2, 48).translate([px, py, b.min[2] - 1]);
    if (countersinkDia > dia) {
      const h = (countersinkDia - dia) / 2;
      const cone = K.Manifold.cylinder(h, dia / 2, countersinkDia / 2, 48).translate([px, py, fromTop ? b.max[2] - h : b.min[2]]);
      cut = cut.add(cone);
    }
    return m.subtract(cut);
  });
}
// Combines two models. op: 'add' | 'subtract' | 'intersect'
export function combineModels(a, b, op = 'add') {
  return (async () => {
    const K = await kernel();
    const A = toManifold(K, a), B = toManifold(K, b);
    const r = op === 'subtract' ? A.subtract(B) : op === 'intersect' ? A.intersect(B) : A.add(B);
    const out = fromManifold(r);
    if (!out.length) throw new Error('That left nothing (the two shapes do not overlap).');
    return out;
  })();
}

// Standard screw sizes (mm): clearance hole and the hole to tap
export const SCREWS = { M2: { clear: 2.4, tap: 1.6 }, M2_5: { clear: 2.9, tap: 2.05 }, M3: { clear: 3.4, tap: 2.5 }, M4: { clear: 4.5, tap: 3.3 }, M5: { clear: 5.5, tap: 4.2 }, M6: { clear: 6.6, tap: 5.0 }, M8: { clear: 9.0, tap: 6.8 } };

// Repair: joins corners that should touch, turns inside-out faces around, drops zero-size triangles.
export async function repairModel(pos) {
  const K = await kernel();
  const w = weldSoup(pos, diagTol(pos));
  let tris = w.tris;
  if (signedVolume(pos) < 0) { tris = Uint32Array.from(tris); for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; } }
  try {
    const mesh = new K.Mesh({ numProp: 3, vertProperties: w.verts, triVerts: tris });
    mesh.merge();
    const m = new K.Manifold(mesh);
    if (!okStatus(m.status())) throw new Error('x');
    return fromManifold(m);
  } catch (e) {
    throw new Error('Could not seal it automatically: there are real gaps in the surface. Try a slightly larger "Grow" step, or fix it in a mesh program.');
  }
}
function diagTol(pos) { const b = bboxOf(pos); return Math.hypot(...b.size) * 1e-5; }
