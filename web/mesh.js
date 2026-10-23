// Cloud's CAD - 3D mesh tools. Positions are Float32Array triangles (x,y,z * 3 per triangle). License: GPL v3
import * as THREE from 'three';
import { chain, flatten } from './core.js';
import { toSegments } from './sketch.js';
import { rasterTriangles, traceContours, classifyLoops, simplifyLoop, smoothLoop, signedArea } from './trace.js';

// ---------- basics ----------
export function bboxOf(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = pos[i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
export function scalePositions(pos, k) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] * k;
  return out;
}
export function toOrigin(pos) {
  const { min } = bboxOf(pos);
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = pos[i + k] - min[k];
  return out;
}
// Many web/AI models are Y-up (glTF). Rotate so the chosen axis becomes Z (up) in a right-handed way.
export function upToZ(pos, up) {
  if (up === 'z') return pos;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (up === 'y') { out[i] = x; out[i + 1] = -z; out[i + 2] = y; }
    else { out[i] = y; out[i + 1] = z; out[i + 2] = x; } // x up
  }
  return out;
}
export function meshVolume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

// ---------- file formats ----------
export function parseSTL(buf) {
  const u8 = new Uint8Array(buf);
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(256, u8.length))).trimStart();
  const dv = new DataView(buf);
  const count = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  const looksBinary = u8.length === 84 + count * 50;
  if (!looksBinary && head.startsWith('solid') && /facet|vertex/.test(head + new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 2000))))) {
    const text = new TextDecoder().decode(u8);
    const nums = [];
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    let m;
    while ((m = re.exec(text))) nums.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    return new Float32Array(nums);
  }
  const out = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return out;
}
export function writeSTL(pos, name = "Cloud's CAD") {
  const n = pos.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const hdr = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf).set(hdr, 0);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const p = t * 9, o = 84 + t * 50;
    const ux = pos[p + 3] - pos[p], uy = pos[p + 4] - pos[p + 1], uz = pos[p + 5] - pos[p + 2];
    const vx = pos[p + 6] - pos[p], vy = pos[p + 7] - pos[p + 1], vz = pos[p + 8] - pos[p + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[p + k], true);
  }
  return buf;
}
export function parseOBJ(text) {
  const v = [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      v.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (line.startsWith('f ')) {
      const idx = line.split(/\s+/).slice(1).map((s) => {
        const i = parseInt(s.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      for (let k = 1; k + 1 < idx.length; k++) for (const j of [idx[0], idx[k], idx[k + 1]]) if (v[j]) out.push(...v[j]);
    }
  }
  return new Float32Array(out);
}

// ---------- silhouettes and sections ----------
const AXES = { front: [0, 2], side: [1, 2], top: [0, 1] }; // [horizontal axis, vertical axis]
export const VIEW_AXES = AXES;

export function silhouette(pos, view, targetPx = 1400) {
  const [ha, va] = AXES[view];
  const bb = bboxOf(pos);
  const rangeH = bb.size[ha], rangeV = bb.size[va];
  const px = Math.max(rangeH, rangeV) / targetPx || 1;
  const w = Math.max(1, Math.ceil(rangeH / px)), h = Math.max(1, Math.ceil(rangeV / px));
  const n = pos.length / 9;
  const tris = new Float32Array(n * 6);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    tris[t * 6 + k * 2] = pos[t * 9 + k * 3 + ha];
    tris[t * 6 + k * 2 + 1] = pos[t * 9 + k * 3 + va];
  }
  const mask = rasterTriangles(tris, bb.min[ha], bb.max[va], px, w, h);
  return { mask, w, h, px, rangeH, rangeV };
}

// loops in pixel space -> entities in world size, lower-left at 0,0, scaled so the extent is exact
export function pixelLoopsToWorld(loops, rangeH, rangeV) {
  const all = loops.flat();
  if (!all.length) return [];
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const sx = x1 > x0 ? rangeH / (x1 - x0) : 1, sy = y1 > y0 ? rangeV / (y1 - y0) : 1;
  return loops.map((l) => l.map((p) => [(p[0] - x0) * sx, (y1 - p[1]) * sy]));
}
export function loopsToLineEnts(loops) {
  const ents = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) ents.push({ t: 'L', a, b });
  }
  return ents;
}
export function silhouetteLoops(sil, { tolPx = 0.7, smooth = 1 } = {}) {
  const raw = traceContours(sil.mask, sil.w, sil.h);
  const loops = raw.map((l) => simplifyLoop(smoothLoop(l, smooth), tolPx)).filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 4);
  return pixelLoopsToWorld(loops, sil.rangeH, sil.rangeV);
}

export function sectionLoops(pos, axis, value) {
  const bb = bboxOf(pos);
  const [ha, va] = [0, 1, 2].filter((a) => a !== axis);
  const q = Math.max(bb.size[0], bb.size[1], bb.size[2]) * 1e-6 || 1e-9;
  const eps = q * 0.1;
  const segs = [];
  for (let i = 0; i < pos.length; i += 9) {
    const P = [[pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]];
    const d = P.map((p) => { const x = p[axis] - value; return Math.abs(x) < eps ? eps : x; });
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = e, b = (e + 1) % 3;
      if ((d[a] > 0) !== (d[b] > 0)) {
        const t = d[a] / (d[a] - d[b]);
        pts.push([P[a][ha] + (P[b][ha] - P[a][ha]) * t, P[a][va] + (P[b][va] - P[a][va]) * t]);
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  const key = (p) => `${Math.round(p[0] / q)},${Math.round(p[1] / q)}`;
  const adj = new Map();
  segs.forEach((s, i) => s.forEach((p) => { const k = key(p); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }));
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const loop = [segs[s0][0]];
    let cur = segs[s0][1];
    for (;;) {
      loop.push(cur);
      const nxt = (adj.get(key(cur)) || []).find((k) => !used[k]);
      if (nxt === undefined) break;
      used[nxt] = 1;
      cur = key(segs[nxt][0]) === key(cur) ? segs[nxt][1] : segs[nxt][0];
    }
    if (key(loop[0]) === key(loop[loop.length - 1])) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  // drop points that sit on a straight edge (the diagonal of a flat face crosses the plane mid-edge)
  return loops.map((l) => (l.length > 4 ? simplifyLoop(l, q * 5) : l));
}
export function toLowerLeft(loops) {
  const all = loops.flat();
  if (!all.length) return loops;
  const x0 = Math.min(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1]));
  return loops.map((l) => l.map((p) => [p[0] - x0, p[1] - y0]));
}

// ---------- carving a solid from silhouettes ----------
// views: {front?, side?, top?} each {mask, w, h} (1 = inside, tightly cropped). dims: size in X (width), Y (depth), Z (height).
export function carve(views, dims, N = 96) {
  const { W, D, H } = dims;
  const vs = Math.max(W, D, H) / N;
  const nx = Math.max(1, Math.round(W / vs)), ny = Math.max(1, Math.round(D / vs)), nz = Math.max(1, Math.round(H / vs));
  const vx = W / nx, vy = D / ny, vz = H / nz;
  const grid = new Uint8Array(nx * ny * nz);
  const smp = (v, u, w2) => { // u,w2 in 0..1, w2 measured from the TOP of the image
    const x = Math.min(v.w - 1, Math.max(0, Math.floor(u * v.w))), y = Math.min(v.h - 1, Math.max(0, Math.floor(w2 * v.h)));
    return v.mask[y * v.w + x] === 1;
  };
  const { front, side, top } = views;
  let filled = 0;
  for (let k = 0; k < nz; k++) {
    const fz = 1 - (k + 0.5) / nz;
    for (let j = 0; j < ny; j++) {
      const fy = (j + 0.5) / ny;
      for (let i = 0; i < nx; i++) {
        const fx = (i + 0.5) / nx;
        if (front && !smp(front, fx, fz)) continue;
        if (side && !smp(side, fy, fz)) continue;
        if (top && !smp(top, fx, 1 - fy)) continue;
        grid[(k * ny + j) * nx + i] = 1;
        filled++;
      }
    }
  }
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : grid[(k * ny + j) * nx + i]);
  const out = [];
  const size = [vx, vy, vz];
  const quad = (a, idx, s, i, j, k) => {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const base = [i, j, k];
    const c = (du, dv) => {
      const p = [0, 0, 0];
      p[a] = (base[a] + (s > 0 ? 1 : 0)) * size[a];
      p[u] = (base[u] + du) * size[u];
      p[v] = (base[v] + dv) * size[v];
      return p;
    };
    const p0 = c(0, 0), p1 = c(1, 0), p2 = c(1, 1), p3 = c(0, 1);
    if (s > 0) out.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    else out.push(...p0, ...p3, ...p2, ...p0, ...p2, ...p1);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!grid[(k * ny + j) * nx + i]) continue;
    if (!at(i + 1, j, k)) quad(0, 0, 1, i, j, k);
    if (!at(i - 1, j, k)) quad(0, 0, -1, i, j, k);
    if (!at(i, j + 1, k)) quad(1, 0, 1, i, j, k);
    if (!at(i, j - 1, k)) quad(1, 0, -1, i, j, k);
    if (!at(i, j, k + 1)) quad(2, 0, 1, i, j, k);
    if (!at(i, j, k - 1)) quad(2, 0, -1, i, j, k);
  }
  return { positions: new Float32Array(out), voxels: filled, grid: [nx, ny, nz] };
}

// ---------- extruding a drawing ----------
// Closed outlines from a sketch. Returns loops of [x,y] and how many open pieces were skipped.
export function loopsFromEnts(ents, tol = 1e-3, closeTol = tol * 5) {
  const chains = chain(toSegments(ents), tol);
  const loops = [];
  let open = 0;
  for (const c of chains) {
    const first = c[0].a, last = c[c.length - 1].b;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > closeTol * 1.0001 || c.length < 2) { open++; continue; }
    const pts = [];
    for (const s of c) pts.push(...flatten(s, 4).slice(0, -1));
    if (pts.length >= 3) loops.push(pts);
  }
  return { loops, open };
}

export function extrudeLoops(loops, depth) {
  if (!loops.length || !(depth > 0)) return new Float32Array(0);
  const info = classifyLoops(loops).map((c) => ({ ...c, pts: c.hole === (signedArea(c.loop) > 0) ? c.loop.slice().reverse() : c.loop }));
  // outer loops counter-clockwise, holes clockwise
  const outers = info.filter((c) => !c.hole);
  const holes = info.filter((c) => c.hole);
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  const contains = (poly, p) => classifyLoops([poly, [p, [p[0] + 1e-9, p[1]], [p[0], p[1] + 1e-9]]])[1].hole;
  for (const o of outers) {
    const myHoles = holes.filter((h) => contains(o.pts, h.pts[0]) && !outers.some((o2) => o2 !== o && o2.area < o.area && o2.area > h.area && contains(o2.pts, h.pts[0])));
    const contour = o.pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const holeV = myHoles.map((h) => h.pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const all = contour.concat(...holeV);
    const faces = THREE.ShapeUtils.triangulateShape(contour, holeV);
    for (const f of faces) {
      const [a, b, c] = f.map((i) => all[i]);
      const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const A = [a.x, a.y], B = cr > 0 ? [b.x, b.y] : [c.x, c.y], C = cr > 0 ? [c.x, c.y] : [b.x, b.y];
      tri([...A, depth], [...B, depth], [...C, depth]); // top, facing +Z
      tri([...A, 0], [...C, 0], [...B, 0]); // bottom, facing -Z
    }
    for (const ring of [o.pts, ...myHoles.map((h) => h.pts)]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-12) continue;
        tri([p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], depth]);
        tri([p[0], p[1], 0], [q[0], q[1], depth], [p[0], p[1], depth]);
      }
    }
  }
  return new Float32Array(out);
}
