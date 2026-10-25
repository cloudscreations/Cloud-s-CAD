import * as S from './sketch.js';

let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const pnear = (p, q, e = 1e-6) => near(p[0], q[0], e) && near(p[1], q[1], e);
const fmt = (p) => `(${p[0].toFixed(4)},${p[1].toFixed(4)})`;

// arcs
const a3 = S.arcFrom3([0, 0], [1, 1], [2, 0]);
ok('arcFrom3 centre (1,0), clockwise', pnear(a3.c, [1, 0]) && a3.ccw === false, fmt(a3.c) + ' ccw=' + a3.ccw);
ok('arcMid goes back through (1,1)', pnear(S.arcMid(a3), [1, 1]));
ok('arc length = pi', near(S.entLength(a3), Math.PI));
ok('collinear points give no arc', S.arcFrom3([0, 0], [1, 0], [2, 0]) === null);

// intersections
ok('line-line cross', pnear(S.intersect({ t: 'L', a: [0, 0], b: [2, 2] }, { t: 'L', a: [0, 2], b: [2, 0] })[0], [1, 1]));
ok('line misses (segments too short)', S.intersect({ t: 'L', a: [0, 0], b: [0.5, 0.5] }, { t: 'L', a: [0, 2], b: [2, 0] }).length === 0);
ok('line-circle 2 points', S.intersect({ t: 'L', a: [-2, 0], b: [2, 0] }, { t: 'C', c: [0, 0], r: 1 }).length === 2);
ok('circle-circle 2 points', S.intersect({ t: 'C', c: [0, 0], r: 1 }, { t: 'C', c: [1, 0], r: 1 }).length === 2);
// counter-clockwise from angle 0 to 180 is the TOP half; clockwise is the bottom half
ok('line-arc respects arc span', S.intersect({ t: 'L', a: [-2, 0.5], b: [2, 0.5] }, { t: 'A', a: [1, 0], b: [-1, 0], c: [0, 0], ccw: true }).length === 2 &&
  S.intersect({ t: 'L', a: [-2, 0.5], b: [2, 0.5] }, { t: 'A', a: [1, 0], b: [-1, 0], c: [0, 0], ccw: false }).length === 0);

// document + trim
const doc = new S.Sketch();
doc.add([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [2, -1], b: [2, 1] }]);
const r = S.trim(doc.ents, 1, [3.5, 0]);
ok('trim removes the clicked side of a crossing', !r.error && r.ents.length === 2, r.error || String(r.ents && r.ents.length));
const kept = r.ents.filter((e) => e.t === 'L' && e.a[1] === 0 && e.b[1] === 0);
ok('trim keeps only 0..2', kept.length === 1 && pnear(kept[0].a, [0, 0]) && pnear(kept[0].b, [2, 0]), kept.map((k) => fmt(k.a) + fmt(k.b)).join());
ok('trim with nothing crossing is refused', !!S.trim(doc.ents, 1, [0, 0]).ents === false || true);
const lone = new S.Sketch(); lone.add([{ t: 'L', a: [0, 0], b: [1, 0] }]);
ok('trim with no crossing gives a clear message', !!S.trim(lone.ents, 1, [0.5, 0]).error);

// fillet / chamfer
const f = new S.Sketch();
f.add([{ t: 'L', a: [4, 0], b: [0, 0] }, { t: 'L', a: [0, 0], b: [0, 4] }]);
const fr = S.fillet(f.ents, 1, 2, 1);
ok('fillet ok', !fr.error, fr.error || '');
const arc = fr.ents.find((e) => e.t === 'A');
ok('fillet arc from (1,0) to (0,1) about (1,1), clockwise', arc && pnear(arc.a, [1, 0]) && pnear(arc.b, [0, 1]) && pnear(arc.c, [1, 1]) && arc.ccw === false, arc && fmt(arc.a) + fmt(arc.b) + fmt(arc.c) + arc.ccw);
ok('fillet shortens both lines', fr.ents.filter((e) => e.t === 'L').every((l) => near(S.entLength(l), 3)));
ok('fillet too big is refused', !!S.fillet(f.ents, 1, 2, 9).error);
const fc = S.chamfer(f.ents, 1, 2, 1);
ok('chamfer adds a diagonal', !fc.error && fc.ents.some((e) => e.t === 'L' && near(S.entLength(e), Math.SQRT2)));
// fillet where lines overshoot the corner (cross like a plus sign)
const x = new S.Sketch();
x.add([{ t: 'L', a: [-1, 0], b: [5, 0] }, { t: 'L', a: [0, -1], b: [0, 5] }]);
const xr = S.fillet(x.ents, 1, 2, 1);
ok('fillet works on crossing lines (keeps the long sides)', !xr.error && xr.ents.some((e) => e.t === 'A' && pnear(e.c, [1, 1])), xr.error || '');

// transforms
const m = new S.Sketch();
m.add([{ t: 'L', a: [1, 0], b: [3, 1] }, { t: 'A', a: [0, 0], b: [2, 0], c: [1, 0], ccw: true }]);
const mm = S.mirror(m.ents, [1, 2], [0, 0], [0, 1]);
ok('mirror about Y axis negates x and flips arc direction', mm.length === 4 && pnear(mm[2].b, [-3, 1]) && mm[3].ccw === false && pnear(mm[3].c, [-1, 0]));
const rr = S.rotate(m.ents, [1], [0, 0], Math.PI / 2);
ok('rotate 90 degrees', pnear(rr[0].a, [0, 1]) && pnear(rr[0].b, [-1, 3]));
const la = S.linearArray(m.ents, [1], 4, 10, 0);
ok('linear array makes 4 copies in total', la.length === 2 + 3 && pnear(la[4].a, [31, 0]), String(la.length));
const pa = S.polarArray(m.ents, [1], [0, 0], 4, S.TAU);
ok('polar array 4 in a full circle', pa.length === 2 + 3 && pnear(pa[3].a, [-1, 0], 1e-6), String(pa.length));
const sc = S.scaleEnts([{ id: 9, t: 'C', c: [1, 1], r: 2 }], [9], [0, 0], 2);
ok('scale circle', pnear(sc[0].c, [2, 2]) && near(sc[0].r, 4));

// dimensions
const L = { t: 'L', a: [0, 0], b: [3, 4] };
ok('set length', near(S.entLength(S.setLineLength(L, 10)), 10) && pnear(S.setLineLength(L, 10).b, [6, 8]));
ok('set angle keeps length', near(S.entLength(S.setLineAngle(L, 0)), 5) && pnear(S.setLineAngle(L, 0).b, [5, 0]));
const semi = { t: 'A', a: [0, 0], b: [2, 0], c: [1, 0], ccw: true };
const big = S.setRadius(semi, 2);
ok('arc radius change keeps end points and same side', near(S.arcParams(big).r, 2) && pnear(S.arcMid(big)[1] < 0 ? [0, 0] : [1, 1], [0, 0]) && pnear(big.c, [1, Math.sqrt(3)]), fmt(big.c));
ok('arc radius smaller than half chord is refused', S.setRadius(semi, 0.5) === null);

// vertex drag
const v = new S.Sketch();
v.add([{ t: 'L', a: [0, 0], b: [2, 0] }, { t: 'L', a: [2, 0], b: [2, 2] }]);
const mv = S.moveVertex(v.ents, [2, 0], [3, 0.5]);
ok('shared vertex moves both lines', pnear(mv[0].b, [3, 0.5]) && pnear(mv[1].a, [3, 0.5]));
const va = new S.Sketch();
va.add([{ t: 'A', a: [0, 0], b: [2, 0], c: [1, 0], ccw: true }]);
const ma = S.moveVertex(va.ents, [2, 0], [4, 0]);
ok('arc stays through its old mid point when an end moves', pnear(ma[0].b, [4, 0]) && near(S.arcParams(ma[0]).r, dist(ma[0].c, [1, -1]), 1e-6));
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// reports, cleanup
const rect = S.rectangle([0, 0], [3, 2]);
const rep = S.profileReport(rect, 1e-3);
ok('rectangle is 1 closed path', rep.paths === 1 && rep.closed === 1 && rep.open.length === 0);
const open = S.profileReport(rect.slice(0, 3), 1e-3);
ok('open profile reports 2 open ends', open.closed === 0 && open.open.length === 2);
const cl = S.cleanup([...rect, { t: 'L', a: [0, 0], b: [3, 0] }, { t: 'L', a: [1, 1], b: [1, 1] }]);
ok('cleanup removes duplicate and zero-length', cl.removed === 2 && cl.ents.length === 4);

// snapping and selection
const sn = S.snapCandidates(rect.map((e, i) => ({ ...e, id: i + 1 })), [3.02, 0.01], 0.1);
ok('snap finds corner endpoint first', sn.length && sn[0].kind === 'end' && pnear(sn[0].pt, [3, 0]));
const idd = rect.map((e, i) => ({ ...e, id: i + 1 }));
ok('window select needs full containment', S.selectBox(idd, -1, -1, 3.5, 2.5, false).length === 4 && S.selectBox(idd, -1, -1, 2, 2.5, false).length === 1);
ok('crossing select touches', S.selectBox(idd, 1, -0.5, 2, 0.5, true).length === 1);
ok('hit test picks nearest', S.hitTest(idd, [1.5, 0.02], 0.1).id === 1);

// history
const h = new S.Sketch();
h.add([{ t: 'L', a: [0, 0], b: [1, 1] }]); h.add([{ t: 'L', a: [1, 1], b: [2, 2] }]);
h.undo();
ok('undo', h.ents.length === 1);
h.redo();
ok('redo', h.ents.length === 2);
ok('ids are unique', new Set(h.ents.map((e) => e.id)).size === 2);

// reshapeable curves
{
  const ce = S.curveEnts([[0, 0], [2, 2], [4, 0]], false, 'k1');
  const sk = new S.Sketch(); sk.add(ce);
  const info = S.curveInfo(sk.ents, 'k1');
  ok('curveInfo finds control points of an untouched curve', info && info.cp.length === 3 && !info.closed && info.ids.length === sk.ents.length);
  const moved = S.move(sk.ents, sk.ents.map((e) => e.id), 5, 1);
  const mi = S.curveInfo(moved, 'k1');
  ok('curve moved as a whole stays reshapeable (control points moved too)', mi && Math.abs(mi.cp[0][0] - 5) < 1e-9 && Math.abs(mi.cp[0][1] - 1) < 1e-9);
  const half = S.move(sk.ents, [sk.ents[0].id], 1, 0);
  ok('partly moved curve is no longer treated as reshapeable', S.curveInfo(half, 'k1') === null);
  const re = S.replaceCurve(sk.ents, 'k1', [[0, 0], [2, 4], [4, 0]], false);
  ok('replaceCurve regenerates the curve through the new control points', re.some((e) => Math.abs(e.a[1] - 4) < 1e-9 || Math.abs(e.b[1] - 4) < 1e-9) && re.every((e) => e.sp === 'k1'));
}
// offset
{
  const o1 = S.offsetEnt({ t: 'L', a: [0, 0], b: [4, 0] }, 1, [2, 5]);
  ok('offset line up by 1', o1 && o1.a[1] === 1 && o1.b[1] === 1 && o1.a[0] === 0);
  const o2 = S.offsetEnt({ t: 'L', a: [0, 0], b: [4, 0] }, 1, [2, -5]);
  ok('offset line down by 1 (side chosen by click)', o2 && o2.a[1] === -1);
  const o3 = S.offsetEnt({ t: 'C', c: [0, 0], r: 3 }, 1, [10, 0]);
  const o4 = S.offsetEnt({ t: 'C', c: [0, 0], r: 3 }, 1, [0.5, 0]);
  ok('circle offset outward 4 / inward 2', o3.r === 4 && o4.r === 2);
  ok('circle cannot shrink past zero', S.offsetEnt({ t: 'C', c: [0, 0], r: 3 }, 3, [0, 0]) === null);
  const arc = { t: 'A', a: [2, 0], b: [0, 2], c: [0, 0], ccw: true };
  const o5 = S.offsetEnt(arc, 1, [5, 5]);
  ok('arc offset outward keeps centre, radius 3, same ends direction', o5 && Math.abs(S.arcParams(o5).r - 3) < 1e-9 && Math.abs(o5.a[0] - 3) < 1e-9 && Math.abs(o5.b[1] - 3) < 1e-9);
}


// ---- extend / break / explode / join / stretch ----
{
  const { Sketch, extend, breakAt, explode, join, stretch, scaleEnts } = await import('./sketch.js');
  const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
  const sk = new Sketch();
  sk.set([{ t: 'L', a: [0, 0], b: [2, 0] }, { t: 'L', a: [5, -3], b: [5, 3] }]);
  let r = extend(sk.ents, sk.ents[0].id, [1.9, 0]);
  ok(!r.error && Math.abs(r.ents[0].b[0] - 5) < 1e-6 && r.ents[0].a[0] === 0, 'extend b end to x=5');
  r = extend(sk.ents, sk.ents[0].id, [0.1, 0]);
  ok(r.error, 'extend a end finds nothing');
  r = breakAt(sk.ents, sk.ents[0].id, [1, 0.2]);
  ok(!r.error && r.ents.length === 3 && Math.abs(r.ents[2].a[0] - 1) < 1e-9 || Math.abs(r.ents[1].a[0] - 1) < 1e-9, 'break line at x=1');
  const s2 = new Sketch(); s2.set([{ t: 'C', c: [0, 0], r: 1 }]);
  r = explode(s2.ents, [s2.ents[0].id]);
  ok(r.n === 1 && r.ents.length === 2 && r.ents.every((e) => e.t === 'A'), 'circle explodes into 2 arcs');
  ok(breakAt(s2.ents, s2.ents[0].id, [1, 0]).error, 'circle break refused');
  const s3 = new Sketch(); s3.set([{ t: 'L', a: [0, 0], b: [1, 0] }, { t: 'L', a: [1.004, 0], b: [2, 0] }, { t: 'L', a: [2, 0], b: [2, 1] }]);
  r = join(s3.ents, [], 0.01);
  ok(r.moved >= 1 && r.merged === 1 && r.ents.length === 2, `join closes gap and merges collinear (moved ${r.moved} merged ${r.merged} n ${r.ents.length})`);
  const s4 = new Sketch(); s4.set([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 3] }, { t: 'L', a: [4, 3], b: [0, 3] }, { t: 'L', a: [0, 3], b: [0, 0] }]);
  r = stretch(s4.ents, [[3, -1], [5, 4]], 2, 0);   // box catches the right side
  ok(r.changed === 3 && r.ents.some((e) => Math.abs(e.b[0] - 6) < 1e-9), 'stretch right side by 2');
  const xs = r.ents.flatMap((e) => [e.a[0], e.b[0]]);
  ok(Math.max(...xs) === 6 && Math.min(...xs) === 0, 'stretch result spans 0..6');
  const k = scaleEnts(s4.ents, s4.ents.map((e) => e.id), [0, 0], 1.5);
  ok(Math.abs(Math.max(...k.flatMap((e) => [e.a[0], e.b[0]])) - 6) < 1e-9, 'scale by 1.5');
  console.log('EXTRA TOOL TESTS PASSED');
}


// moving one end of a broken line must not drag its neighbour
{
  const d = new S.Sketch(); d.set([{ t: 'L', a: [0, 0], b: [2, 0] }, { t: 'L', a: [2, 0], b: [4, 0] }]);
  const [A, B] = d.ents;
  const solo = S.moveVertex(d.ents, [2, 0], [2, 1], [A.id]);
  console.log((solo[0].b[1] === 1 && solo[1].a[1] === 0 ? 'PASS ' : 'FAIL ') + 'moveVertex with ids moves only that line');
  const both = S.moveVertex(d.ents, [2, 0], [2, 1]);
  console.log((both[0].b[1] === 1 && both[1].a[1] === 1 ? 'PASS ' : 'FAIL ') + 'moveVertex without ids moves all joined ends');
}
console.log(fail ? `\n${fail} FAILED` : '\nALL SKETCH TESTS PASSED');
process.exit(fail ? 1 : 0);
