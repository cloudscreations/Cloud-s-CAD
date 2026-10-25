// Cloud's CAD - animated "play the cut" preview of the finished G-code. License: GPL v3
// Draws the wire path from the machine file and moves a dot along it, so mistakes show up before foam is cut.
import { parseTap } from './core.js';

const TAU = Math.PI * 2;

// Turn one parsed move into points (arcs are sampled finely).
function pointsOf(s) {
  if (s.t === 'L') return [s.a, s.b];
  const r = Math.hypot(s.a[0] - s.c[0], s.a[1] - s.c[1]);
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
  let sw = s.ccw ? ((a1 - a0) % TAU + TAU) % TAU : -(((a0 - a1) % TAU + TAU) % TAU);
  if (Math.abs(sw) < 1e-9 && Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]) < 1e-9) sw = s.ccw ? TAU : -TAU; // full circle
  const n = Math.max(6, Math.ceil(Math.abs(sw) / (TAU / 90)));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sw * i) / n; out.push([s.c[0] + r * Math.cos(a), s.c[1] + r * Math.sin(a)]); }
  out[0] = s.a; out[n] = s.b;
  return out;
}

// Builds the path: a list of points with the distance travelled so far, and the move number each point belongs to.
export function buildPath(tapText) {
  const parsed = parseTap(tapText);
  const pts = [], dist = [], move = [];
  let d = 0;
  parsed.segs.forEach((s, mi) => {
    const ps = pointsOf(s);
    for (let i = 0; i < ps.length; i++) {
      if (pts.length) { const p = pts[pts.length - 1]; d += Math.hypot(ps[i][0] - p[0], ps[i][1] - p[1]); }
      pts.push(ps[i]); dist.push(d); move.push(mi);
    }
  });
  return { segs: parsed.segs, pts, dist, move, total: d, lines: tapText.split(/\r?\n/) };
}

// Point at a given travelled distance (binary search).
export function pointAt(path, d) {
  const { pts, dist } = path;
  if (!pts.length) return { p: [0, 0], i: 0 };
  if (d <= 0) return { p: pts[0], i: 0 };
  if (d >= path.total) return { p: pts[pts.length - 1], i: pts.length - 1 };
  let lo = 0, hi = dist.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (dist[mid] <= d) lo = mid; else hi = mid; }
  const span = dist[hi] - dist[lo] || 1, t = (d - dist[lo]) / span;
  return { p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t], i: lo };
}

// Wires the controls inside `root`. Returns { load(tapText), stop() }.
export function initSim(root, units = () => 'in') {
  root.innerHTML = `<h2>Play the cut</h2>
    <canvas class="simCv" width="900" height="420"></canvas>
    <div class="simRow">
      <button class="simPlay primary">Play</button><button class="simRestart">Restart</button>
      <label>Speed <select class="simSpeed"><option value="0.25">Slow</option><option value="1" selected>Normal</option><option value="4">Fast</option><option value="16">Very fast</option></select></label>
    </div>
    <input class="simScrub" type="range" min="0" max="1000" value="0" aria-label="Position along the cut">
    <div class="simInfo hint"></div>`;
  const cv = root.querySelector('.simCv');
  let ctx = null; try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) { root.hidden = true; return { load() { root.hidden = true; }, stop() {}, path: null }; }
  const playB = root.querySelector('.simPlay'), speedS = root.querySelector('.simSpeed'), scrub = root.querySelector('.simScrub'), info = root.querySelector('.simInfo');
  let path = null, pos = 0, playing = false, last = 0, raf = 0, view = null;
  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;

  function fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of path.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const pad = 30, w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    const s = Math.min((cv.width - 2 * pad) / w, (cv.height - 2 * pad) / h);
    view = { s, ox: pad + (cv.width - 2 * pad - w * s) / 2 - x0 * s, oy: cv.height - pad - (cv.height - 2 * pad - h * s) / 2 + y0 * s };
  }
  const X = (p) => view.ox + p[0] * view.s, Y = (p) => view.oy - p[1] * view.s;

  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!path || !path.pts.length) return;
    const cur = pointAt(path, pos);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // whole path, faint
    ctx.strokeStyle = css('--muted', '#8e9aab'); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.6; ctx.beginPath();
    path.pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.stroke();
    ctx.globalAlpha = 1;
    // cut so far, bright
    ctx.strokeStyle = css('--accent', '#f5a524'); ctx.lineWidth = 2.6; ctx.beginPath();
    for (let i = 0; i <= cur.i; i++) { const p = path.pts[i]; i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)); }
    ctx.lineTo(X(cur.p), Y(cur.p)); ctx.stroke();
    // start and wire
    ctx.fillStyle = '#2a9d8f'; ctx.beginPath(); ctx.arc(X(path.pts[0]), Y(path.pts[0]), 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(X(cur.p), Y(cur.p), 6, 0, TAU); ctx.fill();
    const mv = path.segs[path.move[cur.i]] || null;
    const n = path.segs.length, k = mv ? path.move[cur.i] + 1 : 0;
    const line = mv && mv.ln != null ? path.lines[mv.ln].trim() : '';
    info.textContent = `Move ${k} of ${n}   |   wire at ${cur.p[0].toFixed(3)}, ${cur.p[1].toFixed(3)} ${units()}   |   ${Math.round((path.total ? pos / path.total : 0) * 100)}% done${line ? '   |   ' + line : ''}`;
    scrub.value = path.total ? Math.round((pos / path.total) * 1000) : 0;
  }
  function tick(t) {
    if (!playing) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    pos += (path.total / 12) * parseFloat(speedS.value) * dt; // normal speed: the whole cut in about 12 s
    if (pos >= path.total) { pos = path.total; playing = false; playB.textContent = 'Play again'; }
    draw();
    if (playing) raf = requestAnimationFrame(tick);
  }
  function setPlaying(v) {
    playing = v;
    if (v) { if (pos >= path.total) pos = 0; playB.textContent = 'Pause'; last = performance.now(); raf = requestAnimationFrame(tick); }
    else { cancelAnimationFrame(raf); playB.textContent = 'Play'; }
  }
  playB.addEventListener('click', () => { if (path) setPlaying(!playing); });
  root.querySelector('.simRestart').addEventListener('click', () => { if (!path) return; pos = 0; setPlaying(true); });
  scrub.addEventListener('input', () => { if (!path) return; setPlaying(false); pos = (scrub.value / 1000) * path.total; draw(); });

  return {
    load(tapText) {
      setPlaying(false); pos = 0;
      path = tapText ? buildPath(tapText) : null;
      root.hidden = !path || path.pts.length < 2;
      if (!root.hidden) { fit(); draw(); }
    },
    stop() { setPlaying(false); },
    get path() { return path; },
  };
}
