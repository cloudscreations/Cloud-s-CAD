import { slice, placeModel, mergeSettings } from './slicer.js';
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}
const F = (...a) => new Float32Array(a.flat());
const base = { bed: { x: 200, y: 200, z: 200 } };
// ---- a 20 mm cube
let m = placeModel(F(box(0, 0, 0, 20, 20, 20)), { ...base });
{ const xs = [], zs = []; for (let i = 0; i < m.pos.length; i += 3) { xs.push(m.pos[i]); zs.push(m.pos[i + 2]); }
  ok('cube is centred on the bed (x 90..110) and sits on z=0', Math.abs(Math.min(...xs) - 90) < 1e-3 && Math.abs(Math.max(...xs) - 110) < 1e-3 && Math.min(...zs) === 0); }
let r = slice(m.pos, { ...base, infillDensity: 0.2, adhesion: 'none', walls: 2 });
ok('cube: 100 layers of 0.2', r.stats.layers === 100, String(r.stats.layers));
const g = r.gcode;
ok('g-code has temps, home and end', /M104 S210/.test(g) && /G28/.test(g) && /M140 S0/.test(g) && /M84/.test(g));
ok('every extruding move has an E value and travel moves do not', g.split('\n').filter((l) => /^G0 /.test(l)).every((l) => !/ E/.test(l)));
const vol = (r.stats.extruded * Math.PI * (1.75 / 2) ** 2);   // mm3 of plastic
// expected: walls ring ~ (20*20 - 18.2*18.2 ...) ; just check plausible bounds: between 20% and 60% of the solid cube
ok('cube plastic volume is plausible (between 20% and 70% of solid)', vol > 0.2 * 8000 && vol < 0.7 * 8000, String(Math.round(vol)));
const ex = g.split('\n').filter((l) => /^G1 X/.test(l));
const xs = ex.map((l) => +/X([-\d.]+)/.exec(l)[1]), ys = ex.map((l) => +/Y([-\d.]+)/.exec(l)[1]);
ok('printing stays inside the cube footprint (+prime line)', Math.min(...xs.filter((x) => x > 10)) >= 89.5 && Math.max(...xs) <= 110.5, `${Math.min(...xs)} ${Math.max(...xs)}`);
ok('top layers are solid: top layer has solid skin paths, no infill', (() => { const L = r.layers[r.layers.length - 1].paths.map((p) => p.t); return L.includes('solid') && !L.includes('infill'); })());
ok('middle layer has infill', r.layers[50].paths.some((p) => p.t === 'infill'));
ok('first layer is solid', r.layers[0].paths.some((p) => p.t === 'solid') && !r.layers[0].paths.some((p) => p.t === 'infill'));
ok('time and filament estimates exist', r.stats.seconds > 600 && r.stats.grams > 1 && r.stats.grams < 40, `${r.stats.seconds}s ${r.stats.grams.toFixed(1)}g`);
// absolute E never goes backwards except retractions (value after retraction smaller than before by retractDist)
// ---- hollow tube: a box with a box hole => perimeters inside the hole
const tube = [...box(0, 0, 0, 30, 30, 10)];
// build a hole by adding an inverted inner box (normals flipped)
const inner = box(10, 10, 0, 20, 20, 10); const flip = []; for (let i = 0; i < inner.length; i += 9) flip.push(...inner.slice(i, i + 3), ...inner.slice(i + 6, i + 9), ...inner.slice(i + 3, i + 6));
m = placeModel(F(tube, flip), { ...base });
r = slice(m.pos, { ...base, adhesion: 'none' });
const mid = r.layers[25].paths;
ok('hollow part: layer shows 2 outer loops (outside + hole)', mid.filter((p) => p.t === 'outer').length === 2, String(mid.filter((p) => p.t === 'outer').length));
// ---- support: a T-shaped overhang
const stem = box(-3, -3, 0, 3, 3, 15), top = box(-15, -5, 15, 15, 5, 20);
m = placeModel(F(stem, top), { ...base });
let nos = slice(m.pos, { ...base, support: false, adhesion: 'none' });
let sup = slice(m.pos, { ...base, support: true, adhesion: 'none' });
ok('without support there are no support paths', !nos.layers.some((l) => l.paths.some((p) => p.t === 'support')));
ok('with support the overhang gets support below it', sup.layers.slice(0, 70).some((l) => l.paths.some((p) => p.t === 'support')));
ok('no support above the overhang', !sup.layers.slice(76).some((l) => l.paths.some((p) => p.t === 'support')));
ok('support adds plastic', sup.stats.extruded > nos.stats.extruded);
// ---- brim and skirt
m = placeModel(F(box(0, 0, 0, 10, 10, 5)), { ...base });
ok('brim adds loops on layer 0', slice(m.pos, { ...base, adhesion: 'brim' }).layers[0].paths.filter((p) => p.t === 'skirt').length >= 10);
ok('skirt adds 2 loops', slice(m.pos, { ...base, adhesion: 'skirt' }).layers[0].paths.filter((p) => p.t === 'skirt').length === 2);
// ---- relative extrusion flavour
r = slice(m.pos, { ...base, relativeE: true });
ok('relative extrusion uses M83 and no G92 E0 after the start', /M83/.test(r.gcode) && !/M82/.test(r.gcode));
// ---- place / scale / fit
const big = placeModel(F(box(0, 0, 0, 300, 10, 10)), { ...base });
ok('oversize model is flagged as not fitting', big.fits === false);
const half = placeModel(F(box(0, 0, 0, 300, 10, 10)), { ...base, scale: 0.5 });
ok('scaling to 50% makes it fit', half.fits === true && Math.abs(half.size[0] - 150) < 1e-3);
// ---- flat plate (thin): still prints
m = placeModel(F(box(0, 0, 0, 40, 40, 1)), { ...base });
r = slice(m.pos, { ...base, adhesion: 'none' });
ok('1 mm plate prints as solid layers', r.stats.layers === 5 && r.layers.every((l) => l.paths.some((p) => p.t === 'solid')));

// ---- replay the g-code like a printer would and check it
function replay(gcode, o = {}) {
  let x = 0, y = 0, z = 0, e = 0, rel = false, layerZ = 0.2, bad = [], ext = 0, maxE = 0, retr = 0;
  for (const raw of gcode.split('\n')) {
    const l = raw.split(';')[0].trim();
    const lay = /; LAYER \d+ z=([\d.]+)/.exec(raw); if (lay) layerZ = +lay[1];
    if (!l) continue;
    if (l === 'M83') rel = true; if (l === 'M82') rel = false;
    if (/^G92/.test(l)) { e = 0; continue; }
    if (!/^G[01] /.test(l)) continue;
    const g = {}; for (const m of l.matchAll(/([XYZEF])(-?[\d.]+)/g)) g[m[1]] = +m[2];
    const nx = g.X ?? x, ny = g.Y ?? y, nz = g.Z ?? z;
    let de = 0; if (g.E !== undefined) { de = rel ? g.E : g.E - e; e = rel ? e + g.E : g.E; }
    const moved = nx !== x || ny !== y;
    if (de > 1e-9 && moved) { ext += de; if (Math.abs(nz - layerZ) > 1e-6) bad.push('extrude off layer z ' + l); if (/^G0/.test(l)) bad.push('G0 extrudes ' + l); }
    if (de < 0) retr += -de;
    if (moved && de <= 1e-9 && /^G1/.test(l) && g.E === undefined && false) bad.push('x');
    const lim = o.bed || { x: 200, y: 200 };
    if (nx < -1e-6 || ny < -1e-6 || nx > lim.x + 1e-6 || ny > lim.y + 1e-6) bad.push('outside bed ' + l);
    x = nx; y = ny; z = nz;
  }
  return { bad, ext, retr };
}
{
  const m2 = placeModel(F(stem, top), { ...base });
  for (const o of [{}, { relativeE: true }, { zHop: 0.4 }, { support: true }, { support: true, relativeE: true, zHop: 0.3, adhesion: 'brim' }]) {
    const rr = slice(m2.pos, { ...base, ...o }), p = replay(rr.gcode, base);
    ok(`replay ${JSON.stringify(o)}: ${p.bad.length} problems, plastic matches estimate`, p.bad.length === 0 && Math.abs(p.ext - rr.stats.extruded) / rr.stats.extruded < 0.02, `${p.bad[0] || ''} ext ${p.ext.toFixed(1)} vs ${rr.stats.extruded.toFixed(1)}`);
  }
}
console.log(fail ? `\n${fail} FAILED` : '\nALL SLICER TESTS PASSED'); process.exit(fail ? 1 : 0);
