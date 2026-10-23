import * as THREE from 'three';
import { makeShape, weld, fixTJunctions, faceGroup, extrudeFaces, subdivide, deleteVerts, isClosed } from './modeler.js';
import { Evaluator, Brush, SUBTRACTION, ADDITION } from 'three-bvh-csg';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
for (const k of ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'wedge', 'plane']) { const g = makeShape(k); ok(k + ' is a closed solid', isClosed(g.index.array), g.index.count / 3); }
const vol = (pos, idx) => { let v = 0; for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3; v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6; } return v; };
const cube = makeShape('cube', 2); const cp = cube.attributes.position.array, ci = cube.index.array;
ok('cube volume 8 (outward normals)', Math.abs(vol(cp, ci) - 8) < 1e-6, vol(cp, ci));
// top face = triangles with normal +z
let top = -1; for (let t = 0; t < ci.length / 3 && top < 0; t++) { const z = [0, 1, 2].map((k) => cp[ci[t * 3 + k] * 3 + 2]); if (z.every((v) => Math.abs(v - 1) < 1e-6)) top = t; }
const grp = faceGroup(ci, cp, top); ok('top face is 2 triangles', grp.length === 2, grp.length);
const ex = extrudeFaces(cp, ci, grp); const dz = 3;
for (const i of ex.newVerts) ex.pos[i * 3 + 2] += dz;
ok('extrude stays closed', isClosed(ex.index));
ok('extrude volume = 8 + 4*3', Math.abs(vol(ex.pos, ex.index) - 20) < 1e-6, vol(ex.pos, ex.index));
const sd = subdivide(cp, ci); ok('subdivide closed, 4x triangles', isClosed(sd.index) && sd.index.length === ci.length * 4);
ok('subdivide keeps volume', Math.abs(vol(sd.pos, sd.index) - 8) < 1e-6);
const dv = deleteVerts(cp, ci, [0]); ok('delete point removes faces', dv.index.length < ci.length && dv.index.length > 0);
const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
const A = new Brush(makeShape('cube', 2)), B = new Brush(makeShape('cylinder', 1)); B.geometry.translate(0.5, 0, 0); A.updateMatrixWorld(); B.updateMatrixWorld();
const r = ev.evaluate(A, B, SUBTRACTION); ok('cut result has triangles', r.geometry.index.count > 0 || r.geometry.attributes.position.count > 0);
const nonIdx = r.geometry.attributes.position.count; ok('cut produced geometry', nonIdx > 12, nonIdx);
{ const gb = makeShape('cylinder', 1); gb.translate(1, 0, 0); const A2 = new Brush(makeShape('cube', 2)), B2 = new Brush(gb); A2.updateMatrixWorld(); B2.updateMatrixWorld();
  const w0 = weld(ev.evaluate(A2, B2, SUBTRACTION).geometry), fx = fixTJunctions(w0.attributes.position.array, w0.index.array);
  ok('cut across a face: sewn closed', isClosed(fx.index)); const v = vol(fx.pos, fx.index); ok('cut volume about 8 - 0.39', Math.abs(v - 7.607) < 0.03, v); }
process.exit(fail ? 1 : 0);
