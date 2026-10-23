// Cloud's CAD - raster tools: contours from images/silhouettes. Pure JS, no DOM. License: GPL v3
import { curveEnts } from './sketch.js';

// ---------- masks ----------
// RGBA pixels -> 1 where the object is. Dark-on-light by default; alpha < 128 counts as background.
export function maskFromRGBA(data, w, h, { threshold = 128, invert = false } = {}) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let inside = a >= 128 && lum < threshold;
    if (invert) inside = a >= 128 ? !inside : false;
    m[i] = inside ? 1 : 0;
  }
  return m;
}

export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function cropMask(mask, w, h) {
  const b = maskBounds(mask, w, h);
  if (!b) return null;
  const cw = b.x1 - b.x0 + 1, ch = b.y1 - b.y0 + 1;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = mask[(y + b.y0) * w + x + b.x0];
  return { mask: out, w: cw, h: ch };
}

// ---------- marching squares ----------
// Returns closed loops of [x,y] in pixel coordinates (pixel centres at integers, y down).
export function traceContours(mask, w, h) {
  const W = w + 2, H = h + 2; // pad with empty border so every shape closes
  const at = (x, y) => (x >= 1 && y >= 1 && x <= w && y <= h ? mask[(y - 1) * w + (x - 1)] : 0);
  const segs = [];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const code = a * 8 + b * 4 + c * 2 + d;
      if (code === 0 || code === 15) continue;
      // edge midpoints in doubled coordinates
      const T = [2 * i + 1, 2 * j], R = [2 * i + 2, 2 * j + 1], B = [2 * i + 1, 2 * j + 2], L = [2 * i, 2 * j + 1];
      switch (code) {
        case 8: case 7: segs.push([L, T]); break;
        case 4: case 11: segs.push([T, R]); break;
        case 2: case 13: segs.push([R, B]); break;
        case 1: case 14: segs.push([B, L]); break;
        case 12: case 3: segs.push([L, R]); break;
        case 6: case 9: segs.push([T, B]); break;
        case 10: segs.push([L, T], [R, B]); break;
        case 5: segs.push([T, R], [B, L]); break;
        default: break;
      }
    }
  }
  const key = (p) => p[0] * 100003 + p[1];
  const adj = new Map();
  segs.forEach((s, idx) => {
    for (const p of s) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(idx);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const loop = [segs[s0][0], segs[s0][1]];
    let cur = segs[s0][1];
    for (;;) {
      const cand = (adj.get(key(cur)) || []).find((k) => !used[k]);
      if (cand === undefined) break;
      used[cand] = 1;
      const s = segs[cand];
      cur = key(s[0]) === key(cur) ? s[1] : s[0];
      loop.push(cur);
    }
    if (loop.length >= 4) loops.push(loop.slice(0, -1).map((p) => [(p[0] - 2) / 2, (p[1] - 2) / 2])); // remove padding offset, drop repeated start
  }
  return loops;
}

export function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
// Which loops are outer shapes and which are holes (nesting depth even/odd)
export function classifyLoops(loops) {
  return loops.map((l, i) => {
    let depth = 0;
    for (let j = 0; j < loops.length; j++) if (j !== i && pointInLoop(l[0], loops[j])) depth++;
    return { loop: l, hole: depth % 2 === 1, area: Math.abs(signedArea(l)) };
  });
}

// ---------- simplification ----------
function rdpOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    let worst = -1, wi = -1;
    for (let m = i + 1; m < j; m++) {
      const p = pts[m];
      const d = l < 1e-12 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / l;
      if (d > worst) { worst = d; wi = m; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([i, wi], [wi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export function simplifyLoop(loop, tol) {
  if (loop.length < 4) return loop;
  let far = 1, fd = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const first = rdpOpen(loop.slice(0, far + 1), tol);
  const second = rdpOpen(loop.slice(far).concat([loop[0]]), tol);
  return first.concat(second.slice(1, -1));
}
// light smoothing to remove staircase noise (corner rounding is under one pixel per pass)
export function smoothLoop(loop, passes = 1) {
  let p = loop;
  for (let k = 0; k < passes; k++) {
    p = p.map((q, i) => {
      const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length];
      return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4];
    });
  }
  return p;
}

// pixel loops -> line entities (y flipped to y-up, scaled, origin at the lower-left of the bounding box)
export function loopsToEnts(loops, scale, { originX = 0, originY = 0, minX = null, maxY = null } = {}) {
  const all = loops.flat();
  if (!all.length) return [];
  const x0 = minX === null ? Math.min(...all.map((p) => p[0])) : minX;
  const y1 = maxY === null ? Math.max(...all.map((p) => p[1])) : maxY;
  const ents = [];
  for (const l of loops) {
    const pts = l.map((p) => [originX + (p[0] - x0) * scale, originY + (y1 - p[1]) * scale]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) ents.push({ t: 'L', a, b });
    }
  }
  return ents;
}

// Like loopsToEnts, but smooth stretches become editable curves and only real corners stay sharp.
export function loopsToSmoothEnts(loops, scale, { cornerDeg = 38, originX = 0, originY = 0 } = {}) {
  const all = loops.flat();
  if (!all.length) return [];
  const x0 = Math.min(...all.map((p) => p[0])), y1 = Math.max(...all.map((p) => p[1]));
  const out = [];
  for (const l of loops) {
    let pts = l.map((p) => [originX + (p[0] - x0) * scale, originY + (y1 - p[1]) * scale]);
    // drop repeated points
    pts = pts.filter((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]) > 1e-9);
    const n = pts.length;
    if (n < 3) continue;
    const turn = pts.map((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [b[0] - p[0], b[1] - p[1]];
      const ang = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
      return Math.abs(ang) * 180 / Math.PI;
    });
    const corners = [];
    turn.forEach((a, i) => { if (a > cornerDeg) corners.push(i); });
    if (!corners.length) { out.push(...curveEnts(pts, true, undefined, 6)); continue; }
    for (let c = 0; c < corners.length; c++) {
      const i0 = corners[c], i1 = corners[(c + 1) % corners.length];
      const run = [];
      for (let k = i0; ; k = (k + 1) % n) { run.push(pts[k]); if (k === i1 && run.length > 1) break; if (run.length > n + 1) break; }
      if (run.length === 2) out.push({ t: 'L', a: run[0], b: run[1] });
      else out.push(...curveEnts(run, false, undefined, run.length > 12 ? 4 : 8));
    }
  }
  return out;
}

// ---------- rasterising ----------
// tris: Float32Array of x0,y0,x1,y1,x2,y2 per triangle (world units). Output mask with y down.
export function rasterTriangles(tris, minX, maxY, pxSize, w, h) {
  const m = new Uint8Array(w * h);
  const n = tris.length / 6;
  for (let t = 0; t < n; t++) {
    const o = t * 6;
    const x0 = (tris[o] - minX) / pxSize, y0 = (maxY - tris[o + 1]) / pxSize;
    const x1 = (tris[o + 2] - minX) / pxSize, y1 = (maxY - tris[o + 3]) / pxSize;
    const x2 = (tris[o + 4] - minX) / pxSize, y2 = (maxY - tris[o + 5]) / pxSize;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5)), bx1 = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2) + 0.5));
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5)), by1 = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2) + 0.5));
    const eps = -1e-6;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
        const l2 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 >= eps && l2 >= eps && l3 >= eps) m[y * w + x] = 1;
      }
    }
  }
  return m;
}

// Fill closed polygons (even-odd) given in world units, y up. Returns mask with y down.
export function rasterLoops(loops, minX, maxY, pxSize, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const wy = maxY - (y + 0.5) * pxSize;
    const xs = [];
    for (const l of loops) {
      for (let i = 0; i < l.length; i++) {
        const a = l[i], b = l[(i + 1) % l.length];
        if ((a[1] > wy) !== (b[1] > wy)) xs.push(a[0] + ((wy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil((xs[k] - minX) / pxSize - 0.5)), xb = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / pxSize - 0.5));
      for (let x = xa; x <= xb; x++) m[y * w + x] = 1;
    }
  }
  return m;
}

// ---------- colour-based masks (for coloured profiles with text / dimension lines in other colours) ----------
// Most common "ink" colour: ignores near-white background and transparent pixels. Returns [r,g,b] or null.
export function dominantColor(data, w, h) {
  const buckets = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 128 || (r > 225 && g > 225 && b > 225)) continue;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(k);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; } else buckets.set(k, { n: 1, r, g, b });
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null;
}
export function maskFromColor(data, w, h, rgb, tol = 70) {
  const m = new Uint8Array(w * h), t2 = tol * tol;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const dr = data[i * 4] - rgb[0], dg = data[i * 4 + 1] - rgb[1], db = data[i * 4 + 2] - rgb[2];
    if (dr * dr + dg * dg + db * db <= t2) m[i] = 1;
  }
  return m;
}
