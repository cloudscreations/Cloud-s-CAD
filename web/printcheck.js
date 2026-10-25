// Cloud's CAD - print checks, best-orientation search, bed arrangement. License: GPL v3
import { kernel, toManifold, fromManifold, weldSoup, signedVolume } from './solids.js';

const nrm = (p, i) => {
  const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l, l / 2];
};

// Edges used once (open) or more than twice (non-manifold); bodies; volume
export function topology(pos) {
  const w = weldSoup(pos, 1e-9), t = w.tris, cnt = new Map();
  const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  const dirCount = new Map();
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = t[i + k], b = t[i + (k + 1) % 3], kk = key(a, b);
    cnt.set(kk, (cnt.get(kk) || 0) + 1);
    const dk = a + '>' + b; dirCount.set(dk, (dirCount.get(dk) || 0) + 1);
  }
  let open = 0, nonMan = 0, flipped = 0;
  for (const [k, c] of cnt) { if (c === 1) open++; else if (c > 2) nonMan++; }
  for (const [d, c] of dirCount) if (c > 1) flipped++;
  // bodies by union-find on vertices
  const par = new Int32Array(w.verts.length / 3).map((_, i) => i);
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < t.length; i += 3) { par[f(t[i])] = f(t[i + 1]); par[f(t[i + 1])] = f(t[i + 2]); }
  const vol = new Map();
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3, v = w.verts; const r = f(t[i]);
    vol.set(r, (vol.get(r) || 0) + (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6); }
  let bodies = 0; for (const x of vol.values()) if (x > 0) bodies++;
  return { open, nonMan, flipped, bodies: bodies || vol.size, volume: signedVolume(pos), watertight: open === 0 && nonMan === 0 && flipped === 0 };
}

// Overhang area for a given "up" axis index/sign. Returns area (mm2) needing support and the list of triangle indexes.
export function overhang(pos, angle = 45, up = [0, 0, 1]) {
  const lim = -Math.sin((angle * Math.PI) / 180), tris = [];
  let zmin = Infinity;
  for (let i = 0; i < pos.length; i += 3) zmin = Math.min(zmin, pos[i] * up[0] + pos[i + 1] * up[1] + pos[i + 2] * up[2]);
  let area = 0, total = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const n = nrm(pos, i); total += n[3];
    const d = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
    if (d >= lim) continue;
    const h = (pos[i] + pos[i + 3] + pos[i + 6]) / 3 * up[0] + (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3 * up[1] + (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3 * up[2];
    if (h - zmin < 0.05 && d < -0.99) continue; // flat on the bed
    area += n[3]; tris.push(i / 9);
  }
  return { area, total, tris };
}

const AXES = [['as it is', [0, 0, 1]], ['upside down', [0, 0, -1]], ['on its front', [0, 1, 0]], ['on its back', [0, -1, 0]], ['on its right side', [1, 0, 0]], ['on its left side', [-1, 0, 0]]];
// Scores six ways to lay the part down. Lower overhang is better, a bigger flat base is better, shorter is better.
export function orientations(pos, angle = 45) {
  const out = [];
  for (const [name, up] of AXES) {
    const o = overhang(pos, angle, up);
    let zmin = Infinity, zmax = -Infinity, base = 0;
    for (let i = 0; i < pos.length; i += 3) { const z = pos[i] * up[0] + pos[i + 1] * up[1] + pos[i + 2] * up[2]; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    for (let i = 0; i < pos.length; i += 9) {
      const n = nrm(pos, i), d = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
      if (d < -0.99) { const z = (pos[i] * up[0] + pos[i + 1] * up[1] + pos[i + 2] * up[2]); if (z - zmin < 0.05) base += n[3]; }
    }
    out.push({ name, up, overhang: o.area, base, height: zmax - zmin, score: o.area * 1 - base * 0.5 + (zmax - zmin) * 2 });
  }
  return out.sort((a, b) => a.score - b.score);
}
// Rotates so `up` points to +Z, then sits on the bed
export function reorient(pos, up) {
  const [ux, uy, uz] = up, out = new Float32Array(pos.length);
  let R;
  if (uz === 1) R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  else if (uz === -1) R = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  else if (uy !== 0) { const s = uy; R = [1, 0, 0, 0, 0, -s, 0, s, 0]; } // rotate about X
  else { const s = ux; R = [0, 0, -s, 0, 1, 0, s, 0, 0]; }                // rotate about Y
  let zmin = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z; out[i + 1] = R[3] * x + R[4] * y + R[5] * z; out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
    zmin = Math.min(zmin, out[i + 2]);
  }
  for (let i = 2; i < out.length; i += 3) out[i] -= zmin;
  return out;
}
// Thin walls: anything that disappears when the part is opened with a ball of radius minWall/2.
export async function thinWalls(pos, minWall = 1.2) {
  const K = await kernel(), m = toManifold(K, pos), r = minWall / 2;
  if (m.numTri() > 20000) return { pos: new Float32Array(0), volume: 0, skipped: true };
  const s = K.Manifold.cube([minWall, minWall, minWall], true);
  const opened = m.minkowskiDifference(s).minkowskiSum(s);
  const thin = m.subtract(opened);
  const keep = [];
  for (const piece of thin.decompose()) if (piece.volume() > 0.15 * minWall * minWall * minWall) keep.push(piece);
  if (!keep.length) return { pos: new Float32Array(0), volume: 0 };
  const all = keep.length === 1 ? keep[0] : K.Manifold.compose(keep);
  return { pos: fromManifold(all), volume: all.volume() };
}
export async function runChecks(pos, { angle = 45, minWall = 1.2, bed = null } = {}) {
  const t = topology(pos), notes = [];
  if (!t.watertight) { try { toManifold(await kernel(), pos); t.watertight = true; t.open = t.nonMan = t.flipped = 0; } catch (e) { /* really not sealed */ } }
  const ok = (msg) => notes.push({ kind: 'ok', msg }), warn = (msg) => notes.push({ kind: 'warn', msg }), bad = (msg) => notes.push({ kind: 'bad', msg });
  if (t.watertight) ok('Solid and sealed: it will slice cleanly.');
  else bad('Not sealed: ' + t.open + ' open edge' + (t.open === 1 ? '' : 's') + (t.nonMan ? ', ' + t.nonMan + ' shared edges' : '') + (t.flipped ? ', ' + t.flipped + ' faces pointing the wrong way' : '') + '. Slicers may print holes or fail.');
  if (t.bodies > 1) warn(t.bodies + ' separate pieces in this model.'); 
  const o = overhang(pos, angle), orients = orientations(pos, angle), best = orients[0];
  const cur = orients.find((x) => x.name === 'as it is');
  if (o.area < 1) ok('No overhangs steeper than ' + angle + '°: no supports needed.');
  else warn('About ' + o.area.toFixed(0) + ' mm² overhangs steeper than ' + angle + '° and needs supports.');
  if (best.name !== 'as it is' && cur && best.overhang < cur.overhang * 0.7) warn('Printing it ' + best.name + ' cuts overhang from ' + cur.overhang.toFixed(0) + ' to ' + best.overhang.toFixed(0) + ' mm².');
  let thin = { pos: new Float32Array(0) };
  if (t.watertight) { try { thin = await thinWalls(pos, minWall); } catch (e) {} }
  if (thin.pos.length) warn('Parts thinner than ' + minWall + ' mm found (shown in red).'); else if (t.watertight) ok('No walls thinner than ' + minWall + ' mm.');
  if (bed) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
    if (x1 - x0 > bed.x || y1 - y0 > bed.y || z1 - z0 > bed.z) warn('Bigger than your print bed (' + bed.x + '×' + bed.y + '×' + bed.z + ' mm).'); else ok('Fits your print bed.');
  }
  // overlay: overhang triangles
  const op = new Float32Array(o.tris.length * 9);
  o.tris.forEach((ti, k) => op.set(pos.subarray(ti * 9, ti * 9 + 9), k * 9));
  return { topo: t, notes, overhangPos: op, thinPos: thin.pos, orients, best };
}

// ---- arrange: split the model into separate bodies (or copies) and lay them out on the bed
export function splitBodies(pos) {
  const w = weldSoup(pos, 1e-9), t = w.tris, par = new Int32Array(w.verts.length / 3).map((_, i) => i);
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < t.length; i += 3) { par[f(t[i])] = f(t[i + 1]); par[f(t[i + 1])] = f(t[i + 2]); }
  const groups = new Map();
  for (let i = 0; i < t.length; i += 3) { const r = f(t[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i / 3); }
  const mk = (list) => { const a = new Float32Array(list.length * 9); list.forEach((ti, k) => { for (let c = 0; c < 3; c++) { const v = t[ti * 3 + c] * 3; a[k * 9 + c * 3] = w.verts[v]; a[k * 9 + c * 3 + 1] = w.verts[v + 1]; a[k * 9 + c * 3 + 2] = w.verts[v + 2]; } }); return a; };
  let parts = [...groups.values()].map((l) => { const a = mk(l); return { a, v: signedVolume(a), b: boxOf(a) }; });
  // an inside hollow (negative volume) belongs to the smallest solid piece that surrounds it
  const solids = parts.filter((p) => p.v >= 0), cav = parts.filter((p) => p.v < 0);
  for (const c of cav) {
    const host = solids.filter((s) => s.b.x0 <= c.b.x0 + 1e-6 && s.b.y0 <= c.b.y0 + 1e-6 && s.b.z0 <= c.b.z0 + 1e-6 && s.b.x1 >= c.b.x1 - 1e-6 && s.b.y1 >= c.b.y1 - 1e-6 && s.b.z1 >= c.b.z1 - 1e-6).sort((p, q) => p.v - q.v)[0];
    if (host) { const m = new Float32Array(host.a.length + c.a.length); m.set(host.a); m.set(c.a, host.a.length); host.a = m; } else solids.push(c);
  }
  return solids.map((s) => s.a);
}
function boxOf(p) { let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); } return { x0, y0, z0, x1, y1, z1, w: x1 - x0, d: y1 - y0, h: z1 - z0 }; }
// pieces: array of triangle lists. Returns { pos, placed, left } with every piece moved onto the bed, on the floor.
export function arrangePieces(pieces, bedX, bedY, gap = 5, rotate = true) {
  const items = pieces.map((p, i) => ({ i, p, b: boxOf(p) })).sort((a, b) => Math.max(b.b.w, b.b.d) - Math.max(a.b.w, a.b.d));
  const shelves = []; const place = [];
  let left = 0;
  for (const it of items) {
    let w = it.b.w, d = it.b.d, rot = false;
    if (rotate && d > w && d <= bedX && w <= bedY) { [w, d] = [d, w]; rot = true; }   // keep long side along X
    let done = false;
    for (const s of shelves) if (s.x + w <= bedX && d <= s.d + 1e-9) { place.push({ it, x: s.x, y: s.y, rot }); s.x += w + gap; done = true; break; }
    if (!done) {
      const y = shelves.length ? shelves[shelves.length - 1].y + shelves[shelves.length - 1].d + gap : 0;
      if (y + d <= bedY && w <= bedX) { shelves.push({ x: w + gap, y, d }); place.push({ it, x: 0, y, rot }); done = true; }
    }
    if (!done) { left++; place.push({ it, x: null, rot }); }
  }
  // pieces that do not fit go beyond the bed edge in a row so nothing overlaps
  let ox = bedX + 20;
  const out = [];
  for (const pl of place) {
    const b = pl.it.b, src = pl.it.p, a = new Float32Array(src.length);
    let tx, ty;
    if (pl.x === null) { tx = ox; ty = 0; ox += b.w + gap; } else { tx = pl.x; ty = pl.y; }
    for (let i = 0; i < src.length; i += 3) {
      let x = src[i] - b.x0, y = src[i + 1] - b.y0;
      if (pl.rot) { const nx = y, ny = b.w - x; x = nx; y = ny; }
      a[i] = x + tx; a[i + 1] = y + ty; a[i + 2] = src[i + 2] - b.z0;
    }
    out.push(a);
  }
  let n = 0; out.forEach((a) => (n += a.length));
  const pos = new Float32Array(n); let o = 0; out.forEach((a) => { pos.set(a, o); o += a.length; });
  return { pos, left, count: pieces.length };
}
