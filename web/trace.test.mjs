import * as T from './trace.js';

let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// a filled rectangle 40x20 inside a 60x50 image
const W = 60, H = 50;
const rect = new Uint8Array(W * H);
for (let y = 10; y < 30; y++) for (let x = 5; x < 45; x++) rect[y * W + x] = 1;
let loops = T.traceContours(rect, W, H);
ok('rectangle -> one loop', loops.length === 1, String(loops.length));
// the contour runs along pixel edges, so a 40 x 20 pixel block has area 800 (minus four tiny corner cuts)
ok('rectangle loop area is the full 40 x 20 pixels', near(Math.abs(T.signedArea(loops[0])), 800, 1), String(T.signedArea(loops[0])));
const simp = T.simplifyLoop(loops[0], 0.5);
ok('rectangle simplifies to about 4-8 points (corners clipped by marching squares)', simp.length >= 4 && simp.length <= 8, String(simp.length));

// ring with a hole
const ring = new Uint8Array(W * H);
for (let y = 5; y < 45; y++) for (let x = 5; x < 55; x++) ring[y * W + x] = 1;
for (let y = 15; y < 35; y++) for (let x = 20; x < 40; x++) ring[y * W + x] = 0;
loops = T.traceContours(ring, W, H);
const cls = T.classifyLoops(loops);
ok('ring -> 2 loops, one is a hole', loops.length === 2 && cls.filter((c) => c.hole).length === 1);

// disc: simplify keeps shape within tolerance
const disc = new Uint8Array(100 * 100);
for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if ((x - 50) ** 2 + (y - 50) ** 2 <= 40 * 40) disc[y * 100 + x] = 1;
loops = T.traceContours(disc, 100, 100);
const sd = T.simplifyLoop(T.smoothLoop(loops[0], 1), 0.4);
// disc centre is pixel (50,50); radius 40 in pixel centres is about 40.5 at the pixel edges
const maxErr = Math.max(...sd.map((p) => Math.abs(Math.hypot(p[0] - 50, p[1] - 50) - 40.5)));
ok('disc traces to a round loop within about 1 pixel', loops.length === 1 && maxErr < 1.1, 'maxErr=' + maxErr.toFixed(2) + ' pts=' + sd.length);

// two separate blobs
const two = new Uint8Array(W * H);
for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) two[y * W + x] = 1;
for (let y = 20; y < 30; y++) for (let x = 30; x < 50; x++) two[y * W + x] = 1;
ok('two blobs -> two loops', T.traceContours(two, W, H).length === 2);

// diagonal-touching pixels do not crash / produce valid loops
const diag = new Uint8Array(16); diag[0] = 1; diag[5] = 1; diag[10] = 1; diag[15] = 1;
ok('diagonal pixels trace without error', T.traceContours(diag, 4, 4).length >= 1);

// loops -> entities: size and orientation (y flipped to y-up)
const ents = T.loopsToEnts([[[0, 0], [10, 0], [10, 5], [0, 5]]], 2);
const xs = ents.flatMap((e) => [e.a[0], e.b[0]]), ys = ents.flatMap((e) => [e.a[1], e.b[1]]);
ok('loopsToEnts scales to 20 x 10 and sits at 0,0', Math.max(...xs) === 20 && Math.min(...xs) === 0 && Math.max(...ys) === 10 && Math.min(...ys) === 0 && ents.length === 4);

// raster triangles: right triangle covering half of a 10x10 square
const tri = new Float32Array([0, 0, 10, 0, 0, 10]);
const mk = T.rasterTriangles(tri, 0, 10, 1, 10, 10);
const filled = mk.reduce((s, v) => s + v, 0);
ok('triangle raster covers about half the pixels', filled >= 50 && filled <= 60, String(filled));

// raster loops with a hole
const sq = [[0, 0], [10, 0], [10, 10], [0, 10]], hole = [[3, 3], [7, 3], [7, 7], [3, 7]];
const rl = T.rasterLoops([sq, hole], 0, 10, 1, 10, 10);
ok('raster loops honours holes (100 - 16 = 84)', rl.reduce((s, v) => s + v, 0) === 84, String(rl.reduce((s, v) => s + v, 0)));

// RGBA mask
const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 200, 200, 200, 255]);
const mm = T.maskFromRGBA(rgba, 4, 1, { threshold: 128 });
ok('mask: dark=1, light=0, transparent=0', mm[0] === 1 && mm[1] === 0 && mm[2] === 0 && mm[3] === 0);
const mi = T.maskFromRGBA(rgba, 4, 1, { threshold: 128, invert: true });
ok('mask invert: light=1, transparent still 0', mi[0] === 0 && mi[1] === 1 && mi[2] === 0 && mi[3] === 1);
const cr = T.cropMask(rect, W, H);
ok('crop mask to bounds', cr.w === 40 && cr.h === 20);

// smooth tracing: a disc stays one curve, a rectangle stays four sharp lines
{
  const circ = Array.from({ length: 24 }, (_, i) => [50 + 40 * Math.cos(i * Math.PI / 12), 50 + 40 * Math.sin(i * Math.PI / 12)]);
  const ce = T.loopsToSmoothEnts([circ], 0.1);
  ok('smooth trace: disc becomes ONE closed curve', ce.every((e) => e.sp === ce[0].sp) && ce[0].cl === true && ce[0].cp.length === 24, `${ce.length} ents`);
  const re = T.loopsToSmoothEnts([[[0, 0], [10, 0], [10, 5], [0, 5]]], 1);
  ok('smooth trace: rectangle stays 4 sharp lines', re.length === 4 && re.every((e) => e.sp === undefined));
  const mix = [[0, 0], [10, 0], [10, 3], [12, 5], [14, 6], [16, 5], [18, 3], [18, 0], [28, 0], [28, 20], [0, 20]];
  const me = T.loopsToSmoothEnts([mix], 1);
  ok('smooth trace: a bumpy edge becomes a curve between sharp corners', me.some((e) => e.sp !== undefined) && me.some((e) => e.sp === undefined), String(me.length));
}
// colour masks: red shape + blue text pixels + white
const px2 = new Uint8ClampedArray(6 * 4);
const put = (i, r, g, b) => { px2.set([r, g, b, 255], i * 4); };
put(0, 255, 255, 255); put(1, 110, 0, 0); put(2, 112, 4, 2); put(3, 108, 0, 0); put(4, 0, 0, 255); put(5, 255, 255, 255);
const dc = T.dominantColor(px2, 6, 1);
ok('dominant colour is the red, not the single blue pixel', dc && dc[0] > 100 && dc[0] < 120 && dc[2] < 10, JSON.stringify(dc));
const cm = T.maskFromColor(px2, 6, 1, dc, 60);
ok('colour mask keeps the red pixels only', cm.join('') === '011100', cm.join(''));

console.log(fail ? `\n${fail} FAILED` : '\nALL TRACE TESTS PASSED');
process.exit(fail ? 1 : 0);
