// Cloud's CAD core - pure functions, no DOM. License: GPL v3
// DXF profile -> hotwire .tap (BobCAD-style dialect: relative moves, real arcs, no feed codes)
import DxfParser from 'dxf-parser';

export const TO_IN = { in: 1, ft: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 };
const INSUNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const TAU = Math.PI * 2;

// Copied from a real BobCAD file for the shop's machine. Meaning of M90/G74/M11/M21 is not
// documented by us; they are kept exactly as BobCAD writes them.
export const DEFAULT_POST = {
  header: ['M90', 'G74', 'G91', 'M11', ''],
  footer: ['M21', 'M02'],
  decimals: 4,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mod = (x, m) => ((x % m) + m) % m;

// Segment: {t:'L', a, b} or {t:'A', a, b, c, ccw}
export const rev = (s) => (s.t === 'L' ? { t: 'L', a: s.b, b: s.a, sp: s.sp } : { t: 'A', a: s.b, b: s.a, c: s.c, ccw: !s.ccw });

// ---------- DXF reading ----------

function bulgeSeg(p0, p1, bulge) {
  if (!bulge || Math.abs(bulge) < 1e-12) return { t: 'L', a: p0, b: p1 };
  const theta = 4 * Math.atan(bulge);
  const chord = dist(p0, p1);
  if (chord < 1e-12) return null;
  const d = chord / 2 / Math.tan(theta / 2);
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const nx = -(p1[1] - p0[1]) / chord, ny = (p1[0] - p0[0]) / chord; // left normal
  return { t: 'A', a: p0, b: p1, c: [mx + nx * d, my + ny * d], ccw: bulge > 0 };
}

function deBoor(k, x, t, c, p) {
  const d = [];
  for (let j = 0; j <= p; j++) d[j] = [c[j + k - p][0], c[j + k - p][1]];
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const den = t[j + 1 + k - r] - t[j + k - p];
      const al = den === 0 ? 0 : (x - t[j + k - p]) / den;
      d[j] = [(1 - al) * d[j - 1][0] + al * d[j][0], (1 - al) * d[j - 1][1] + al * d[j][1]];
    }
  }
  return d[p];
}

function splinePoints(e) {
  const cps = (e.controlPoints || []).map((p) => [p.x, p.y]);
  const p = e.degreeOfSplineCurve;
  const t = e.knotValues;
  if (cps.length > p && t && t.length === cps.length + p + 1) {
    const n = cps.length - 1;
    const lo = t[p], hi = t[n + 1];
    const pts = [];
    const N = Math.max(60, cps.length * 20);
    for (let i = 0; i <= N; i++) {
      const x = i === N ? hi : lo + ((hi - lo) * i) / N;
      let k = p;
      while (k < n && x >= t[k + 1]) k++;
      pts.push(deBoor(k, x, t, cps, p));
    }
    return pts;
  }
  const fit = (e.fitPoints || []).map((q) => [q.x, q.y]);
  return fit.length > 1 ? fit : cps;
}

const QUIET = new Set(['TEXT', 'MTEXT', 'DIMENSION', 'POINT', 'LEADER', 'ATTDEF', 'ATTRIB']);

export function readDxf(text) {
  const dxf = new DxfParser().parseSync(text);
  const segs = [];
  const warnings = [];
  const ignored = {};
  let splines = 0;
  const add = (s) => s && segs.push(s);

  for (const e of dxf.entities || []) {
    switch (e.type) {
      case 'LINE':
        add({ t: 'L', a: [e.vertices[0].x, e.vertices[0].y], b: [e.vertices[1].x, e.vertices[1].y] });
        break;
      case 'ARC': {
        const c = [e.center.x, e.center.y], r = e.radius;
        add({
          t: 'A',
          a: [c[0] + r * Math.cos(e.startAngle), c[1] + r * Math.sin(e.startAngle)],
          b: [c[0] + r * Math.cos(e.endAngle), c[1] + r * Math.sin(e.endAngle)],
          c,
          ccw: true,
        });
        break;
      }
      case 'CIRCLE': {
        const c = [e.center.x, e.center.y], r = e.radius;
        const a = [c[0] + r, c[1]], b = [c[0] - r, c[1]];
        add({ t: 'A', a, b, c, ccw: true });
        add({ t: 'A', a: b, b: a, c, ccw: true });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const v = (e.vertices || []).map((q) => ({ p: [q.x, q.y], bulge: q.bulge || 0 }));
        const n = v.length;
        for (let i = 0; i + 1 < n; i++) add(bulgeSeg(v[i].p, v[i + 1].p, v[i].bulge));
        if (e.shape && n > 2) add(bulgeSeg(v[n - 1].p, v[0].p, v[n - 1].bulge));
        break;
      }
      case 'SPLINE': {
        const pts = splinePoints(e);
        splines++;
        for (let i = 0; i + 1 < pts.length; i++) add({ t: 'L', a: pts[i], b: pts[i + 1], sp: splines });
        break;
      }
      default:
        ignored[e.type] = (ignored[e.type] || 0) + 1;
    }
  }
  for (const [type, n] of Object.entries(ignored)) {
    if (!QUIET.has(type)) {
      warnings.push(`Skipped ${n} ${type} item(s). Geometry of this kind is NOT in the output. Explode or redraw it as lines/arcs.`);
    }
  }
  const units = INSUNITS[dxf.header && dxf.header['$INSUNITS']] || null;
  return { segs, warnings, units, splines };
}

// ---------- geometry helpers ----------

export function chain(segs, tol) {
  const pool = segs.slice();
  const chains = [];
  chains.maxJoin = 0; // largest gap that was closed up
  while (pool.length) {
    const cur = [pool.shift()];
    for (const forward of [true, false]) {
      for (;;) {
        const anchor = forward ? cur[cur.length - 1].b : cur[0].a;
        // pick the CLOSEST matching end (not just the first within tolerance), so tiny
        // segments such as spline pieces are never skipped over
        let found = null, bd = Infinity;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          const d1 = dist(forward ? s.a : s.b, anchor);
          const d2 = dist(forward ? s.b : s.a, anchor);
          if (d1 <= tol && d1 < bd) { bd = d1; found = [i, s]; }
          if (d2 <= tol && d2 < bd) { bd = d2; found = [i, rev(s)]; }
          if (bd === 0) break;
        }
        if (!found) break;
        chains.maxJoin = Math.max(chains.maxJoin, bd);
        pool.splice(found[0], 1);
        if (forward) cur.push(found[1]);
        else cur.unshift(found[1]);
      }
    }
    chains.push(cur);
  }
  return chains;
}

export function bounds(chains) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p) => {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  };
  for (const c of chains) {
    for (const s of c) {
      take(s.a); take(s.b);
      if (s.t === 'A') {
        const r = dist(s.a, s.c);
        const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
        const a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
        const sweep = s.ccw ? mod(a1 - a0, TAU) : mod(a0 - a1, TAU);
        for (let q = 0; q < 4; q++) {
          const ang = (q * Math.PI) / 2;
          const d = s.ccw ? mod(ang - a0, TAU) : mod(a0 - ang, TAU);
          if (d <= sweep) take([s.c[0] + r * Math.cos(ang), s.c[1] + r * Math.sin(ang)]);
        }
      }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function xform(chains, k, mirrorX, mirrorY, rot = 0) {
  const pt = (p) => {
    let x = p[0] * k, y = p[1] * k;
    // rotate counter-clockwise by 0/90/180/270 degrees, then mirror
    if (rot === 90) [x, y] = [-y, x];
    else if (rot === 180) [x, y] = [-x, -y];
    else if (rot === 270) [x, y] = [y, -x];
    if (mirrorX) x = -x;
    if (mirrorY) y = -y;
    return [x, y];
  };
  const flip = mirrorX !== mirrorY;
  return chains.map((c) =>
    c.map((s) =>
      s.t === 'L'
        ? { t: 'L', a: pt(s.a), b: pt(s.b), sp: s.sp }
        : { t: 'A', a: pt(s.a), b: pt(s.b), c: pt(s.c), ccw: flip ? !s.ccw : s.ccw }
    )
  );
}

// Douglas-Peucker on a list of points
function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    let worst = -1, wi = -1;
    for (let m = i + 1; m < j; m++) {
      const p = pts[m];
      const d = len < 1e-12 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
      if (d > worst) { worst = d; wi = m; }
    }
    if (worst > tol) {
      keep[wi] = 1;
      stack.push([i, wi], [wi, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Replace the many tiny lines that stand in for a spline by fewer lines that stay within `tol` of it
export function simplifySplines(chains, tol) {
  return chains.map((c) => {
    const out = [];
    let i = 0;
    while (i < c.length) {
      const s = c[i];
      if (s.t === 'L' && s.sp !== undefined) {
        let j = i;
        while (j + 1 < c.length && c[j + 1].t === 'L' && c[j + 1].sp === s.sp) j++;
        const pts = [c[i].a];
        for (let m = i; m <= j; m++) pts.push(c[m].b);
        const kept = rdp(pts, tol);
        for (let m = 0; m + 1 < kept.length; m++) out.push({ t: 'L', a: kept[m], b: kept[m + 1], sp: s.sp });
        i = j + 1;
      } else {
        out.push(s);
        i++;
      }
    }
    return out;
  });
}

export function flatten(s, stepDeg = 3) {
  if (s.t === 'L') return [s.a, s.b];
  const r = dist(s.a, s.c);
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
  const a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
  const sweep = s.ccw ? mod(a1 - a0, TAU) : -mod(a0 - a1, TAU);
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / ((stepDeg * Math.PI) / 180)));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([s.c[0] + r * Math.cos(a0 + (sweep * i) / n), s.c[1] + r * Math.sin(a0 + (sweep * i) / n)]);
  pts[n] = s.b;
  return pts;
}

// ---------- G-code writing ----------

function num(v, d) {
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '');
  if (parseFloat(s) === 0) return '0.';
  return s.includes('.') ? s : s + '.';
}

export function emit(chains, post, leadIn, leadOut) {
  const d = post.decimals;
  const r = (v) => Number(v.toFixed(d));
  const lines = post.header.slice();
  const move = (dx, dy) => {
    const w = ['G01'];
    if (dx) w.push('X' + num(dx, d));
    if (dy) w.push('Y' + num(dy, d));
    if (w.length > 1) lines.push(w.join(' '));
  };
  let pos = null;
  for (const c of chains) {
    const start = [r(c[0].a[0]), r(c[0].a[1])];
    if (pos === null) {
      if (leadIn) move(r(leadIn[0]), r(leadIn[1]));
    } else {
      move(r(start[0] - pos[0]), r(start[1] - pos[1]));
    }
    pos = start;
    for (const s of c) {
      const tgt = [r(s.b[0]), r(s.b[1])];
      const dx = r(tgt[0] - pos[0]), dy = r(tgt[1] - pos[1]);
      if (s.t === 'L') move(dx, dy);
      else {
        const i = r(s.c[0] - pos[0]), j = r(s.c[1] - pos[1]);
        lines.push(`${s.ccw ? 'G03' : 'G02'} X${num(dx, d)} Y${num(dy, d)} I${num(i, d)} J${num(j, d)}`);
      }
      pos = tgt;
    }
  }
  if (leadOut) move(r(leadOut[0]), r(leadOut[1]));
  return lines.concat(post.footer).join('\r\n') + '\r\n';
}

// ---------- .tap reading (for preview and tap -> DXF) ----------

export function parseTap(text) {
  let relative = false;
  let pos = [0, 0];
  const segs = [];
  const codes = {};
  const WORD = /([A-Za-z])\s*(-?\d*\.?\d*)/g;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(';')[0].split('(')[0].trim();
    if (!line) continue;
    const words = {};
    const order = [];
    let m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(line))) {
      const L = m[1].toUpperCase();
      let n = m[2];
      if (n === '' || n === '-' || n === '.' || n === '-.') n = '0';
      const val = parseFloat(n);
      if (L === 'G' || L === 'M') {
        const code = L + String(Math.trunc(val)).padStart(2, '0');
        order.push(code);
        codes[code] = (codes[code] || 0) + 1;
      } else words[L] = val;
    }
    if (order.includes('G91')) relative = true;
    if (order.includes('G90')) relative = false;
    let move = order.find((c) => ['G00', 'G01', 'G02', 'G03'].includes(c));
    if (!move) {
      if ('X' in words || 'Y' in words) move = 'G01';
      else continue;
    }
    const end = relative
      ? [pos[0] + (words.X || 0), pos[1] + (words.Y || 0)]
      : ['X' in words ? words.X : pos[0], 'Y' in words ? words.Y : pos[1]];
    if ((move === 'G02' || move === 'G03') && ('I' in words || 'J' in words)) {
      segs.push({ t: 'A', a: pos, b: end, c: [pos[0] + (words.I || 0), pos[1] + (words.J || 0)], ccw: move === 'G03', code: move });
    } else segs.push({ t: 'L', a: pos, b: end, code: move });
    pos = end;
  }
  return { segs, codes, relative, end: pos };
}

export function tapToDxf(segs, units = 'in') {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', units === 'mm' ? '4' : '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const f = (v) => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(6);
  for (const s of segs) {
    if (s.t === 'L') {
      if (dist(s.a, s.b) < 1e-9) continue;
      out.push('0', 'LINE', '8', '0', '10', f(s.a[0]), '20', f(s.a[1]), '30', '0', '11', f(s.b[0]), '21', f(s.b[1]), '31', '0');
    } else {
      const r = dist(s.a, s.c);
      let a0 = (Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]) * 180) / Math.PI;
      let a1 = (Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]) * 180) / Math.PI;
      if (!s.ccw) [a0, a1] = [a1, a0];
      out.push('0', 'ARC', '8', '0', '10', f(s.c[0]), '20', f(s.c[1]), '30', '0', '40', f(r), '50', f(mod(a0, 360)), '51', f(mod(a1, 360)));
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n') + '\r\n';
}

// ---------- main conversion ----------

export function convert(dxfText, o = {}) {
  const { segs, warnings, units, splines } = readDxf(dxfText);
  return convertSegments(segs, { warnings, units, splines }, o);
}

// meta: { units: 'in'|'mm'|... or null if unknown, warnings: [], splines: count }
export function convertSegments(segs, meta, o = {}) {
  // tol and curveTol are in INCHES (final machine units), so they mean the same thing for mm or inch drawings
  const opt = { unitsIn: 'auto', scale: 1, fitWidth: 0, fitHeight: 0, tol: 0.002, curveTol: 0.002, closeTol: 0.01, rotate: 0, reverse: false, mirrorX: false, mirrorY: false,
    leadIn: null, leadOut: null, allowMulti: false, header: DEFAULT_POST.header, footer: DEFAULT_POST.footer, decimals: 4, ...o };
  const { warnings = [], units = null, splines = 0 } = meta;
  const res = { tap: null, error: null, warnings: warnings.slice(), chains: [], stats: null, detectedUnits: units, gaps: [], notes: [] };
  if (!segs.length) {
    res.error = 'No usable geometry found (supported: lines, arcs, circles, polylines, splines).';
    return res;
  }
  let src = opt.unitsIn === 'auto' ? units : opt.unitsIn;
  if (!src) {
    src = 'in';
    res.warnings.push('This DXF has no units saved. Assuming inches. If the size looks wrong, pick the units or use "Fit to width".');
  } else if (opt.unitsIn !== 'auto' && units && units !== opt.unitsIn) {
    res.warnings.push(`File says ${units}, you chose ${opt.unitsIn}.`);
  }
  const base = TO_IN[src] * opt.scale; // DXF unit -> inches
  let chains = chain(segs, opt.tol / base);
  res.chains = chains;
  const b0 = bounds(chains);
  let k = base;
  if (opt.fitWidth > 0) k = opt.fitWidth / b0.w;
  else if (opt.fitHeight > 0) k = opt.fitHeight / b0.h;
  const maxJoin = chains.maxJoin * k;
  chains = xform(chains, k, opt.mirrorX, opt.mirrorY, opt.rotate);
  const rawMoves = chains.reduce((n, c) => n + c.length, 0);
  if (splines) {
    chains = simplifySplines(chains, opt.curveTol);
    const now = chains.reduce((n, c) => n + c.length, 0);
    res.notes.push(`${splines} spline${splines > 1 ? 's' : ''} turned into short straight lines, within ${opt.curveTol} in of the curve (${rawMoves} -> ${now} moves).`);
  }
  if (maxJoin > 1e-9) res.notes.push(`Closed up small gaps in the drawing (largest ${maxJoin.toFixed(4)} in).`);
  // A profile that almost closes (sketch ends a few thousandths apart) gets a short closing cut so the wire returns to its start.
  chains = chains.map((c) => {
    const first = c[0].a, last = c[c.length - 1].b;
    const g = dist(first, last);
    if (g > 1e-9 && g <= opt.closeTol && c.length > 2) {
      res.notes.push(`Closed the profile with a ${g.toFixed(4)} in cut so the wire ends where it started.`);
      return c.concat([{ t: 'L', a: last, b: first }]);
    }
    return c;
  });
  if (opt.reverse) chains = chains.map((c) => c.slice().reverse().map(rev));
  res.chains = chains;
  const b = bounds(chains);
  res.stats = { width: b.w, height: b.h, paths: chains.length, moves: chains.reduce((n, c) => n + c.length, 0),
    arcs: chains.reduce((n, c) => n + c.filter((s) => s.t === 'A').length, 0), unitsFrom: src, factor: k,
    start: chains[0][0].a, firstEnd: chains[0][0].b, maxJoin };

  if (chains.length > 1) {
    let best = Infinity, pair = null;
    for (let i = 0; i < chains.length; i++)
      for (let j = i + 1; j < chains.length; j++)
        for (const p of [chains[i][0].a, chains[i][chains[i].length - 1].b])
          for (const q of [chains[j][0].a, chains[j][chains[j].length - 1].b]) {
            const dd = dist(p, q);
            if (dd < best) { best = dd; pair = [p, q]; }
          }
    res.gaps = pair ? [{ gap: best, p: pair[0], q: pair[1] }] : [];
    if (!opt.allowMulti) {
      res.error = `${chains.length} separate paths found. This machine's format has no rapid move, so the wire would CUT a straight line between them. ` +
        `The closest gap is ${best.toFixed(4)} in. Close the gaps in the drawing, raise "Join gaps up to", or tick "Allow several paths".`;
      return res;
    }
    res.warnings.push(`${chains.length} separate paths: the wire will CUT a straight line between them.`);
  }
  res.tap = emit(chains, { header: opt.header, footer: opt.footer, decimals: opt.decimals }, opt.leadIn, opt.leadOut);
  return res;
}
