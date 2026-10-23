import * as S from './sketch.js';
import { cleanupAll, guessUnits, mirrorJoin, edgeAxis, smoothChains, shapePoints, compareShapes, rankMatches } from './shapetools.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const L = (a, b, c, d) => ({ t: 'L', a: [a, b], b: [c, d] });
const doc = (list) => { const d = new S.Sketch(); d.set(list); return d.ents; };

// cleanup
let e = doc([L(0, 0, 4, 0), L(4, 0, 4, 3), L(4, 3, 0, 3), L(0, 3, 0.0004, 0.0003), L(0, 3, 0, 0), L(0, 0, 4, 0), L(1, 0, 3, 0), L(10, 10, 10.005, 10), L(5, 5, 5, 5)]);
let r = cleanupAll(e, { tol: 0.002, speck: 0.02 });
ok('dups/overlap/speck removed', r.report.dup + r.report.zero >= 3 && r.report.overlap >= 1 && r.report.specks === 1, JSON.stringify(r.report));
const rep = S.profileReport(r.ents, 0.003);
ok('result is one closed rectangle', rep.paths === 1 && rep.closed === 1 && rep.open.length === 0, JSON.stringify(rep));
ok('corner kept connected after overlap merge', r.ents.length <= 5, r.ents.length);
ok('summary text', /Removed/.test(r.summary), r.summary);
const t = doc([L(0, 0, 4, 0), L(4, 0, 4, 2), L(4, 2, 0, 2)]);   // touching pieces must not be merged across a T-junction
ok('T junction untouched', cleanupAll(doc([L(0, 0, 4, 0), L(2, 0, 2, 3)]), {}).ents.length === 2);
ok('units guess: inches file that is 300 wide', guessUnits('in', 300, 100)?.unit === 'mm');
ok('units guess: mm file 3 wide', guessUnits('mm', 3, 2)?.unit === 'in');
ok('units guess: normal ok', guessUnits('in', 6, 4) === null && guessUnits('mm', 150, 60) === null);

// mirror and join: half of a symmetric profile (axis at x=0 is drawn as a closing line)
const half = doc([L(0, 0, 3, 0), L(3, 0, 3, 1), L(3, 1, 1, 2), L(1, 2, 0, 2), L(0, 2, 0, 0)]);
const ax = edgeAxis(half, 'left');
const mj = mirrorJoin(half, half.map((x) => x.id), ax[0], ax[1], 0.002);
const rp = S.profileReport(mj.ents, 0.003);
const bb = S.bbox(mj.ents);
ok('mirror+join gives one closed outline', rp.paths === 1 && rp.closed === 1 && rp.open.length === 0, JSON.stringify(rp));
ok('width doubled (6)', Math.abs(bb.w - 6) < 1e-6 && Math.abs(bb.h - 2) < 1e-6, bb.w + 'x' + bb.h);
ok('axis lines removed', mj.removedOnAxis === 2, mj.removedOnAxis);
// open half (no closing line on axis) joins across axis
const open = doc([L(0, 2, 1, 2), L(1, 2, 3, 1), L(3, 1, 3, 0), L(3, 0, 0, 0)]);
const ax2 = edgeAxis(open, 'left'); const mj2 = mirrorJoin(open, open.map((x) => x.id), ax2[0], ax2[1], 0.002);
ok('open half becomes one chain', S.profileReport(mj2.ents, 0.003).paths === 1);

// smoothing a noisy traced circle-ish polyline
const pts = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2; const rr = 2 + 0.004 * Math.sin(i * 7); pts.push([rr * Math.cos(a), rr * Math.sin(a)]); }
const poly = doc(pts.map((p, i) => ({ t: 'L', a: p, b: pts[(i + 1) % pts.length] })));
const sm = smoothChains(poly, [], { tol: 0.02, cornerDeg: 40, gap: 0.002 });
ok('smoothing reduces 120 pieces for a circle', sm.n === 1 && sm.ents.length > 0, sm.n + ' ' + sm.ents.length);
const sb = S.bbox(sm.ents); ok('smoothed circle still ~4 wide', Math.abs(sb.w - 4) < 0.05, sb.w);
const sq = doc([L(0, 0, 3, 0), L(3, 0, 3, 3), L(3, 3, 0, 3), L(0, 3, 0, 0)]);
const sms = smoothChains(sq, [], { tol: 0.02, cornerDeg: 40, gap: 0.002 }); const bs = S.bbox(sms.ents);
ok('square corners stay sharp', Math.abs(bs.w - 3) < 1e-6 && Math.abs(bs.h - 3) < 1e-6, bs.w + 'x' + bs.h);

// matching
const crown = (s, flip) => doc([L(0, 0, 4 * s, 0), L(4 * s, 0, 4 * s * (flip ? 1 : 1), 0.5 * s), L(4 * s, 0.5 * s, 2 * s, 2.5 * s), L(2 * s, 2.5 * s, 1 * s, 2.5 * s), L(1 * s, 2.5 * s, 0, 0.5 * s), L(0, 0.5 * s, 0, 0)]);
const other = doc([L(0, 0, 3, 0), L(3, 0, 3, 3), L(3, 3, 0, 3), L(0, 3, 0, 0)]);
const a = shapePoints(crown(1)), b = shapePoints(crown(2.5)), c = shapePoints(other);
ok('same shape different size ~100%', compareShapes(a, b).pct >= 95, compareShapes(a, b).pct);
ok('different shape scores low', compareShapes(a, c).pct < 70, compareShapes(a, c).pct);
const mirrored = doc(crown(1).map((x) => ({ t: 'L', a: [-x.a[0], x.a[1]], b: [-x.b[0], x.b[1]] })));
ok('mirrored copy recognised', compareShapes(a, shapePoints(mirrored)).pct >= 95 && /flipped/.test(compareShapes(a, shapePoints(mirrored)).how));
const rot = doc(crown(1).map((x) => ({ t: 'L', a: [-x.a[1], x.a[0]], b: [-x.b[1], x.b[0]] })));
ok('turned copy recognised', compareShapes(a, shapePoints(rot)).pct >= 95);
const lib = [{ id: 1, ents: other }, { id: 2, ents: crown(3) }, { id: 3, ents: rot }];
const rk = rankMatches(crown(1), lib); ok('ranking puts a crown first', [2, 3].includes(rk[0].id) && rk[2].id === 1, JSON.stringify(rk));
console.log(fail ? `\n${fail} FAILED` : '\nALL SHAPE TESTS PASSED'); process.exit(fail ? 1 : 0);
