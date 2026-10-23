// Cloud's CAD - 3D printing slicer. Turns a triangle mesh (millimetres) into printer G-code. License: GPL v3
// Basic but complete: walls, top/bottom skins, infill, supports, skirt/brim, retraction, temperatures, fan, time/filament estimate.
import CL from 'clipper-lib';

const SC = 1000;                                   // clipper works in integers: 1 unit = 1 micron
const PI = Math.PI;

export const DEFAULTS = {
  layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.45, walls: 2, topThickness: 0.8, bottomThickness: 0.6,
  infillDensity: 0.2, infillPattern: 'lines',
  speed: { firstLayer: 20, outerWall: 40, wall: 50, solid: 50, infill: 70, support: 60, travel: 150, zMove: 15 },
  retractDist: 1.0, retractSpeed: 35, minRetractTravel: 1.5, zHop: 0,
  filamentDia: 1.75, flow: 1.0, density: 1.24,
  nozzleTemp: 205, firstLayerNozzleTemp: 210, bedTemp: 60, fan: 100, fanStartLayer: 2,
  adhesion: 'skirt', brimWidth: 6, skirtLoops: 2, skirtDistance: 3,
  minLayerTime: 6,
  support: false, supportAngle: 50, supportDensity: 0.15, supportGap: 0.35,
  bed: { x: 220, y: 220, z: 250 }, originCenter: false, relativeE: false, primeLine: true,
  startGcode: '', endGcode: '',
};
export function mergeSettings(s = {}) {
  return { ...DEFAULTS, ...s, speed: { ...DEFAULTS.speed, ...(s.speed || {}) }, bed: { ...DEFAULTS.bed, ...(s.bed || {}) } };
}

// ---------- placing the model on the bed ----------
export function placeModel(pos, { scale = 1, rotX = 0, rotY = 0, rotZ = 0, bed = DEFAULTS.bed, originCenter = false, dx = 0, dy = 0 } = {}) {
  const out = new Float32Array(pos.length);
  const rad = (d) => (d * PI) / 180, cx = Math.cos(rad(rotX)), sx = Math.sin(rad(rotX)), cy = Math.cos(rad(rotY)), sy = Math.sin(rad(rotY)), cz = Math.cos(rad(rotZ)), sz = Math.sin(rad(rotZ));
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i] * scale, y = pos[i + 1] * scale, z = pos[i + 2] * scale, t;
    t = y * cx - z * sx; z = y * sx + z * cx; y = t;
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t;
    t = x * cz - y * sz; y = x * sz + y * cz; x = t;
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < out.length; i += 3) {
    if (out[i] < x0) x0 = out[i]; if (out[i] > x1) x1 = out[i];
    if (out[i + 1] < y0) y0 = out[i + 1]; if (out[i + 1] > y1) y1 = out[i + 1];
    if (out[i + 2] < z0) z0 = out[i + 2]; if (out[i + 2] > z1) z1 = out[i + 2];
  }
  const ox = (originCenter ? 0 : bed.x / 2) + dx - (x0 + x1) / 2, oy = (originCenter ? 0 : bed.y / 2) + dy - (y0 + y1) / 2;
  for (let i = 0; i < out.length; i += 3) { out[i] += ox; out[i + 1] += oy; out[i + 2] -= z0; }
  const size = [x1 - x0, y1 - y0, z1 - z0];
  const lim = originCenter ? [bed.x / 2, bed.y / 2] : null;
  const fits = size[0] <= bed.x + 1e-6 && size[1] <= bed.y + 1e-6 && size[2] <= bed.z + 1e-6 && Math.abs(dx) + size[0] / 2 <= bed.x / 2 + 1e-6 && Math.abs(dy) + size[1] / 2 <= bed.y / 2 + 1e-6;
  return { pos: out, size, fits, lim };
}

// ---------- slicing a mesh into outlines ----------
function sliceLoops(pos, zs) {
  const n = pos.length / 9, layerSegs = zs.map(() => []);
  const z0 = zs[0], dz = zs.length > 1 ? zs[1] - zs[0] : 1;       // layers after the first are evenly spaced
  const zOf = (i) => zs[i];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const za = pos[o + 2], zb = pos[o + 5], zc = pos[o + 8];
    const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc);
    if (hi - lo < 1e-9) continue;
    let i0 = Math.max(0, Math.floor((lo - z0) / dz) - 1), i1 = Math.min(zs.length - 1, Math.ceil((hi - z0) / dz) + 1);
    for (let i = i0; i <= i1; i++) {
      const z = zOf(i);
      if (z < lo || z > hi) continue;
      const eps = 1e-7;
      const d = [za - z, zb - z, zc - z].map((v) => (Math.abs(v) < eps ? eps : v));
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = e, b = (e + 1) % 3;
        if (d[a] > 0 !== d[b] > 0) {
          const k = d[a] / (d[a] - d[b]);
          pts.push([pos[o + a * 3] + (pos[o + b * 3] - pos[o + a * 3]) * k, pos[o + a * 3 + 1] + (pos[o + b * 3 + 1] - pos[o + a * 3 + 1]) * k]);
        }
      }
      if (pts.length === 2) layerSegs[i].push(pts);
    }
  }
  return layerSegs.map(joinSegments);
}
function joinSegments(segs) {
  const q = 1000;                                                  // 1 micron
  const key = (p) => Math.round(p[0] * q) + ',' + Math.round(p[1] * q);
  const adj = new Map();
  segs.forEach((s, i) => s.forEach((p) => { const k = key(p); let a = adj.get(k); if (!a) adj.set(k, (a = [])); a.push(i); }));
  const used = new Uint8Array(segs.length), loops = [];
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
    const closed = key(loop[0]) === key(loop[loop.length - 1]) || Math.hypot(loop[0][0] - cur[0], loop[0][1] - cur[1]) < 0.05;
    if (loop.length > 1 && key(loop[0]) === key(loop[loop.length - 1])) loop.pop();
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------- clipper helpers ----------
const toC = (loop) => loop.map((p) => ({ X: Math.round(p[0] * SC), Y: Math.round(p[1] * SC) }));
const fromC = (path) => path.map((p) => [p.X / SC, p.Y / SC]);
function even(paths) { return CL.Clipper.SimplifyPolygons(paths, CL.PolyFillType.pftEvenOdd); }
function offset(paths, mm, join = CL.JoinType.jtMiter) {
  if (!paths.length) return [];
  const co = new CL.ClipperOffset(2, 15);
  co.AddPaths(paths, join, CL.EndType.etClosedPolygon);
  const out = new CL.Paths();
  co.Execute(out, mm * SC);
  return out;
}
function boolean(type, subj, clip) {
  const c = new CL.Clipper();
  c.AddPaths(subj, CL.PolyType.ptSubject, true);
  c.AddPaths(clip, CL.PolyType.ptClip, true);
  const out = new CL.Paths();
  c.Execute(type, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return out;
}
const union = (a, b) => boolean(CL.ClipType.ctUnion, a, b);
const inter = (a, b) => (a.length && b.length ? boolean(CL.ClipType.ctIntersection, a, b) : []);
const diff = (a, b) => (a.length ? (b.length ? boolean(CL.ClipType.ctDifference, a, b) : a) : []);
const area = (paths) => paths.reduce((s, p) => s + CL.Clipper.Area(p), 0) / (SC * SC);
function dropSmall(paths, minMm2) { return paths.filter((p) => Math.abs(CL.Clipper.Area(p)) / (SC * SC) >= minMm2); }
function clipLines(lines, region) {
  if (!lines.length || !region.length) return [];
  const c = new CL.Clipper();
  c.AddPaths(lines, CL.PolyType.ptSubject, false);
  c.AddPaths(region, CL.PolyType.ptClip, true);
  const tree = new CL.PolyTree();
  c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return CL.Clipper.OpenPathsFromPolyTree(tree);
}
function boundsOf(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) { if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X; if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y; }
  return { x0, y0, x1, y1 };
}
// parallel lines at an angle covering the paths' bounding box; `phase` shifts them so layers do not repeat
function hatch(region, spacingMm, angleDeg, phase = 0) {
  const b = boundsOf(region), sp = Math.max(spacingMm * SC, 1);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + sp;
  const a = (angleDeg * PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const lines = [];
  const start = -Math.floor(R / sp) * sp + ((phase * sp) % sp);
  for (let d = start; d <= R; d += sp) {
    lines.push([{ X: Math.round(cx + nx * d - ux * R), Y: Math.round(cy + ny * d - uy * R) }, { X: Math.round(cx + nx * d + ux * R), Y: Math.round(cy + ny * d + uy * R) }]);
  }
  return clipLines(lines, region);
}

// ---------- the main entry ----------
// pos: Float32Array of triangles in mm, already placed on the bed (use placeModel). Returns { gcode, layers, stats, warnings }.
function* sliceGen(pos, opts = {}, onProgress = () => {}) {
  const s = mergeSettings(opts);
  const warnings = [];
  let zMax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] > zMax) zMax = pos[i];
  if (!(zMax > 0.05)) throw new Error('The model has no height.');
  const w = s.lineWidth, lh = s.layerHeight;
  const zs = [];
  zs.push(s.firstLayerHeight / 2);
  const tops = [s.firstLayerHeight];
  for (let t = s.firstLayerHeight + lh; t <= zMax + 1e-6 + lh * 0.5; t += lh) { tops.push(t); }
  // slice at the middle of each layer; the layer centres after the first are evenly spaced
  const centres = tops.map((t, i) => (i === 0 ? t / 2 : t - lh / 2));
  const nL = centres.length;
  const raw = sliceLoops(pos, centres);
  onProgress(0.15, 'Cut the model into layers');
  yield;
  const region = raw.map((loops) => dropSmall(even(loops.map(toC)), 0.02));
  const nWalls = Math.max(1, s.walls);
  const topN = Math.max(1, Math.ceil(s.topThickness / lh - 1e-6)), botN = Math.max(1, Math.ceil(s.bottomThickness / lh - 1e-6));
  const inner = region.map((r) => offset(r, -(nWalls * w - 0.1 * w)));
  onProgress(0.3, 'Planned walls');

  // supports, from the top layer down
  let support = new Array(nL).fill(null).map(() => []);
  if (s.support) {
    const reach = lh * Math.tan((s.supportAngle * PI) / 180);
    const over = new Array(nL).fill(null).map(() => []);
    for (let i = 1; i < nL; i++) over[i] = dropSmall(diff(region[i], offset(region[i - 1], reach)), 1.5);
    let cur = [];
    for (let i = nL - 2; i >= 0; i--) {
      const add = i + 2 < nL ? over[i + 2] : [];                // one empty layer under the overhang so it peels off
      cur = dropSmall(diff(union(cur, add), offset(region[i], s.supportGap)), 1.0);
      support[i] = cur;
    }
    if (support.every((x) => !x.length)) support = new Array(nL).fill(null).map(() => []);
  }

  const out = [];
  const g = new Writer(s);
  const layers = [];
  const bedLo = s.originCenter ? [-s.bed.x / 2, -s.bed.y / 2] : [0, 0];
  g.header();

  for (let i = 0; i < nL; i++) {
    const z = tops[i], h = i === 0 ? s.firstLayerHeight : lh;
    const L = { z, paths: [] };
    g.startLayer(i, z, h);
    const add = (type, pts) => { L.paths.push({ t: type, p: pts.flat() }); };
    const fs = i === 0 ? s.speed.firstLayer : null;
    // 1) work out everything this layer prints
    let rings = [];
    if (i === 0 && s.adhesion !== 'none' && region[0].length) {
      const outerOnly = region[0].filter((p) => CL.Clipper.Orientation(p));
      if (s.adhesion === 'brim') {
        const n = Math.max(1, Math.round(s.brimWidth / w));
        for (let k = n - 1; k >= 0; k--) rings.push(...offset(outerOnly, (k + 0.5) * w, CL.JoinType.jtRound));
      } else {
        for (let k = 0; k < s.skirtLoops; k++) rings.push(...offset(outerOnly, s.skirtDistance + (k + 0.5) * w, CL.JoinType.jtRound));
      }
    }
    let supLines = [];
    if (support[i].length) supLines = hatch(offset(support[i], -0.5 * w), (w * 1.0) / Math.max(0.05, s.supportDensity), i % 2 ? 45 : 135, 0);
    const wallSets = [];
    for (let k = 0; k < nWalls; k++) wallSets.push(offset(region[i], -(k + 0.5) * w));
    let solidLines = [], sparseLines = [];
    if (inner[i].length) {
      let sparse = inner[i];
      for (let j = 1; j <= topN && sparse.length; j++) sparse = i + j < nL ? inter(sparse, inner[i + j]) : [];
      for (let j = 1; j <= botN && sparse.length; j++) sparse = i - j >= 0 ? inter(sparse, inner[i - j]) : [];
      let solid = dropSmall(diff(inner[i], sparse), 0.3);
      sparse = dropSmall(diff(inner[i], solid), 0.6);
      if (s.infillDensity >= 0.99) { solid = inner[i]; sparse = []; }
      if (solid.length) solidLines = hatch(offset(solid, 0.05 * w), w * 0.98, i % 2 ? 45 : 135, 0);
      if (sparse.length && s.infillDensity > 0.01) {
        const sp = (w / s.infillDensity) * (s.infillPattern === 'grid' ? 2 : 1);
        sparseLines = hatch(sparse, sp, i % 2 ? 45 : 135, 0);
        if (s.infillPattern === 'grid') sparseLines = sparseLines.concat(hatch(sparse, sp, i % 2 ? 135 : 45, 0));
      }
    }
    // 2) small layers print slower so the plastic can cool (minimum layer time)
    const plen = (paths, closed) => paths.reduce((t, p) => { let d = 0; for (let q = 1; q < p.length; q++) d += Math.hypot(p[q].X - p[q - 1].X, p[q].Y - p[q - 1].Y); if (closed && p.length > 1) d += Math.hypot(p[0].X - p[p.length - 1].X, p[0].Y - p[p.length - 1].Y); return t + d / SC; }, 0);
    let est = plen(rings, true) / s.speed.wall + plen(supLines, false) / s.speed.support + plen(solidLines, false) / s.speed.solid + plen(sparseLines, false) / s.speed.infill;
    wallSets.forEach((ws, k) => { est += plen(ws, true) / (k === 0 ? s.speed.outerWall : s.speed.wall); });
    const slow = fs ? 1 : Math.max(0.35, Math.min(1, est / (s.minLayerTime || 6)));
    const spd = (v) => (fs || v * slow);
    if (slow < 0.999) g.put(`; slowed to ${Math.round(slow * 100)}% for cooling`);
    // 3) print it: skirt/brim, support, walls (inner first, outer last), solid skin, infill
    for (const r of g.orderLoops(rings.map(fromC))) { g.loop(r, spd(s.speed.wall), w, h, 'skirt'); add('skirt', r.concat([r[0]])); }
    for (const ln of g.orderLines(supLines.map(fromC))) { g.line(ln, spd(s.speed.support), w, h, 'support'); add('support', ln); }
    for (let k = nWalls - 1; k >= 0; k--) {
      for (const lp of g.orderLoops(wallSets[k].map(fromC))) {
        g.loop(lp, spd(k === 0 ? s.speed.outerWall : s.speed.wall), w, h, k === 0 ? 'outer' : 'wall');
        add(k === 0 ? 'outer' : 'wall', lp.concat([lp[0]]));
      }
    }
    for (const ln of g.orderLines(solidLines.map(fromC))) { g.line(ln, spd(s.speed.solid), w, h, 'solid'); add('solid', ln); }
    for (const ln of g.orderLines(sparseLines.map(fromC))) { g.line(ln, spd(s.speed.infill), w, h, 'infill'); add('infill', ln); }
    layers.push(L);
    if (i % 4 === 0) { onProgress(0.3 + (0.65 * i) / nL, `Layer ${i + 1} of ${nL}`); yield; }
  }
  g.footer(tops[nL - 1]);
  const st = g.stats();
  const gcode = g.text();
  if (st.extruded < 1) warnings.push('Nothing was printed. The model may be too thin, or not closed (watertight).');
  return { gcode, layers, stats: { layers: nL, height: tops[nL - 1], ...st }, warnings };
}

export function slice(pos, opts = {}, onProgress = () => {}) {
  const g = sliceGen(pos, opts, onProgress);
  let r;
  while (!(r = g.next()).done);
  return r.value;
}
// same thing, but gives the screen a moment every few layers so the page stays alive
export async function sliceAsync(pos, opts = {}, onProgress = () => {}, shouldCancel = () => false) {
  const g = sliceGen(pos, opts, onProgress);
  let r;
  for (;;) {
    r = g.next();
    if (r.done) return r.value;
    if (shouldCancel()) throw new Error('Slicing cancelled.');
    await new Promise((res) => setTimeout(res, 0));
  }
}

// ---------- G-code writer ----------
class Writer {
  constructor(s) {
    this.s = s; this.o = []; this.x = 0; this.y = 0; this.z = 0; this.e = 0; this.f = -1; this.retracted = false;
    this.time = 0; this.extruded = 0; this.travel = 0; this.hasPos = false; this.layerZ = 0;
    this.area = Math.PI * (s.filamentDia / 2) ** 2;
  }
  put(l) { this.o.push(l); }
  text() { return this.o.join('\n') + '\n'; }
  fill(tpl) {
    const s = this.s;
    return tpl.replace(/\{(\w+)\}/g, (m, k) => ({ nozzle: s.nozzleTemp, firstNozzle: s.firstLayerNozzleTemp, bed: s.bedTemp, bedX: s.bed.x, bedY: s.bed.y, bedZ: s.bed.z, lh: s.firstLayerHeight, filament: s.filamentDia }[k] ?? m));
  }
  header() {
    const s = this.s;
    this.put('; Generated by Cloud\'s CAD (free and open source, GPL v3)');
    this.put(`; layer height ${s.layerHeight}, walls ${s.walls}, infill ${Math.round(s.infillDensity * 100)}%, nozzle ${s.nozzleTemp} C, bed ${s.bedTemp} C`);
    if (s.startGcode.trim()) { this.put(this.fill(s.startGcode)); }
    else {
      this.put('M140 S' + s.bedTemp); this.put('M104 S' + s.firstLayerNozzleTemp);
      this.put('G28 ; home all axes');
      this.put('M190 S' + s.bedTemp); this.put('M109 S' + s.firstLayerNozzleTemp);
    }
    this.put('G90'); this.put(s.relativeE ? 'M83' : 'M82'); this.put('G92 E0');
    if (s.primeLine && !s.startGcode.trim()) {
      const x = s.originCenter ? -s.bed.x / 2 + 3 : 3, y0 = s.originCenter ? -s.bed.y / 2 + 10 : 10, len = Math.min(150, s.bed.y - 20);
      const h = s.firstLayerHeight, ew = s.lineWidth * 1.2;
      this.put('; prime line'); this.put(`G1 Z${Math.max(2, h * 3)} F3000`); this.put(`G1 X${x} Y${y0} F5000`); this.put(`G1 Z${h} F600`);
      const e1 = (len * ew * h * s.flow) / this.area;
      this.put(`G1 X${x} Y${y0 + len} E${(s.relativeE ? e1 : e1).toFixed(4)} F1200`);
      this.put(`G1 X${x + 0.4} Y${y0 + len} F1200`);
      const e2 = (len * ew * h * s.flow) / this.area;
      this.put(`G1 X${x + 0.4} Y${y0} E${(s.relativeE ? e2 : e1 + e2).toFixed(4)} F1200`);
      this.e = s.relativeE ? 0 : e1 + e2; this.extruded += e1 + e2;
      this.put(s.relativeE ? 'G92 E0' : 'G92 E0'); this.e = 0;
      this.put(`G1 Z2 F3000`); this.put(`G1 E${(-s.retractDist).toFixed(3)} F${s.retractSpeed * 60}`); this.retracted = true;
      if (!s.relativeE) { this.put('G92 E0'); this.e = 0; }
      this.x = x + 0.4; this.y = y0; this.z = 2; this.hasPos = true;
    }
  }
  startLayer(i, z, h) {
    const s = this.s;
    this.put(`; LAYER ${i} z=${z.toFixed(3)}`);
    this.h = h;
    if (i === 1) { this.put('M104 S' + s.nozzleTemp); }
    if (i === s.fanStartLayer) this.put(s.fan > 0 ? `M106 S${Math.round((s.fan / 100) * 255)}` : 'M107');
    if (!s.relativeE) { this.put('G92 E0'); this.e = 0; }
    this.retract();
    const lift = s.zHop > 0 ? 0 : 0;
    this.zMove(z + lift);
    this.pendingLayer = true;
  }
  zMove(z) {
    const sp = this.s.speed.zMove;
    this.put(`G1 Z${z.toFixed(3)} F${Math.round(sp * 60)}`);
    this.time += Math.abs(z - this.z) / sp; this.z = z; this.f = sp * 60;
  }
  retract() {
    if (this.retracted || this.s.retractDist <= 0) return;
    const s = this.s;
    this.put(`G1 E${(this.s.relativeE ? -s.retractDist : this.e - s.retractDist).toFixed(4)} F${Math.round(s.retractSpeed * 60)}`);
    if (!s.relativeE) this.e -= s.retractDist;
    this.time += s.retractDist / s.retractSpeed;
    this.retracted = true;
    if (s.zHop > 0) { this.zMove(this.z + s.zHop); this.hopped = true; }
  }
  unretract() {
    if (!this.retracted) return;
    const s = this.s;
    if (this.hopped) { this.zMove(this.layerZ || this.z - s.zHop); this.hopped = false; }
    if (s.retractDist > 0) { this.put(`G1 E${(s.relativeE ? s.retractDist : this.e + s.retractDist).toFixed(4)} F${Math.round(s.retractSpeed * 60)}`); if (!s.relativeE) this.e += s.retractDist; this.time += s.retractDist / s.retractSpeed; }
    this.retracted = false;
  }
  travelTo(p) {
    const s = this.s, d = this.hasPos ? Math.hypot(p[0] - this.x, p[1] - this.y) : 0;
    if (d > s.minRetractTravel) this.retract();
    if (d > 1e-6 || !this.hasPos) {
      this.put(`G0 X${p[0].toFixed(3)} Y${p[1].toFixed(3)}${this.f === s.speed.travel * 60 ? '' : ' F' + Math.round(s.speed.travel * 60)}`);
      this.f = s.speed.travel * 60; this.time += d / s.speed.travel; this.travel += d;
    }
    this.x = p[0]; this.y = p[1]; this.hasPos = true;
    if (this.pendingLayer) { this.layerZ = this.z; this.pendingLayer = false; }
  }
  cutTo(p, speed, width, h) {
    const s = this.s, d = Math.hypot(p[0] - this.x, p[1] - this.y);
    if (d < 1e-6) return;
    this.unretract();
    const e = (d * width * h * s.flow) / this.area;
    this.e += s.relativeE ? 0 : e; this.extruded += e;
    const F = Math.round(speed * 60);
    this.put(`G1 X${p[0].toFixed(3)} Y${p[1].toFixed(3)} E${(s.relativeE ? e : this.e).toFixed(5)}${this.f === F ? '' : ' F' + F}`);
    this.f = F; this.time += (d / speed) * 1.12; this.x = p[0]; this.y = p[1];
  }
  loop(pts, speed, width, h, type) {
    // start at the point nearest the nozzle so the seam sits near where we are
    let k = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - this.x, p[1] - this.y); if (d < bd) { bd = d; k = i; } });
    const r = pts.slice(k).concat(pts.slice(0, k));
    this.put(`;TYPE:${type}`);
    this.travelTo(r[0]);
    for (let i = 1; i < r.length; i++) this.cutTo(r[i], speed, width, h);
    this.cutTo(r[0], speed, width, h);
  }
  line(pts, speed, width, h, type) {
    this.put(`;TYPE:${type}`);
    this.travelTo(pts[0]);
    for (let i = 1; i < pts.length; i++) this.cutTo(pts[i], speed, width, h);
  }
  orderLoops(loops) {                                 // nearest first
    const rest = loops.slice(), out = [];
    let c = [this.x, this.y];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((l, i) => { for (const p of l) { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; bi = i; } } });
      const l = rest.splice(bi, 1)[0]; out.push(l); c = l[0];
    }
    return out;
  }
  orderLines(lines) {                                 // nearest end first, flipping so we enter from the near end
    const rest = lines.map((l) => (l.length > 1 ? l : null)).filter(Boolean), out = [];
    let c = [this.x, this.y];
    while (rest.length) {
      let bi = 0, bd = Infinity, flip = false;
      rest.forEach((l, i) => {
        const d0 = Math.hypot(l[0][0] - c[0], l[0][1] - c[1]), d1 = Math.hypot(l[l.length - 1][0] - c[0], l[l.length - 1][1] - c[1]);
        if (d0 < bd) { bd = d0; bi = i; flip = false; }
        if (d1 < bd) { bd = d1; bi = i; flip = true; }
      });
      let l = rest.splice(bi, 1)[0];
      if (flip) l = l.slice().reverse();
      out.push(l); c = l[l.length - 1];
    }
    return out;
  }
  footer(zTop) {
    const s = this.s;
    this.retract();
    this.put('; end of print');
    if (s.endGcode.trim()) { this.put(this.fill(s.endGcode)); return; }
    this.put('M104 S0'); this.put('M140 S0'); this.put('M107');
    const lift = Math.min(10, Math.max(0, s.bed.z - zTop));
    this.put('G91'); this.put(`G1 Z${lift.toFixed(1)} F600`); this.put('G90');
    this.put(`G1 X${s.originCenter ? 0 : 0} Y${s.originCenter ? s.bed.y / 2 : s.bed.y} F3000 ; present the part`);
    this.put('M84 ; motors off');
  }
  stats() {
    const s = this.s, volume = this.extruded * this.area / 1000;               // cm3
    return { extruded: this.extruded, filamentMeters: this.extruded / 1000, grams: volume * s.density, seconds: Math.round(this.time), travelMm: this.travel };
  }
}
export { Writer as _Writer };
