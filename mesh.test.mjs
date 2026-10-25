import * as M from './mesh.js';
import * as S from './sketch.js';

let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// helpers: a box and a sphere as triangle soups
function box(w, d, h) {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const f = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]];
  return new Float32Array(f.flatMap((t) => t.flatMap((i) => v[i])));
}
function sphere(r, n = 48) {
  const out = [];
  const P = (a, b) => [r * Math.sin(a) * Math.cos(b), r * Math.sin(a) * Math.sin(b), r * Math.cos(a)];
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI, b0 = (j / (2 * n)) * Math.PI * 2, b1 = ((j + 1) / (2 * n)) * Math.PI * 2;
    out.push(...P(a0, b0), ...P(a1, b0), ...P(a1, b1), ...P(a0, b0), ...P(a1, b1), ...P(a0, b1));
  }
  return new Float32Array(out);
}

// basics
const b = box(2, 3, 4);
ok('bbox size', M.bboxOf(b).size.join() === '2,3,4');
ok('box volume = 24', near(M.meshVolume(b), 24, 1e-4), String(M.meshVolume(b)));
ok('scale doubles volume by 8', near(M.meshVolume(M.scalePositions(b, 2)), 192, 1e-3));
const yUp = new Float32Array([0, 0, 0, 1, 0, 0, 0, 5, 0]); // a triangle with height along Y
const zUp = M.upToZ(yUp, 'y');
ok('Y-up -> Z-up puts the height on Z', M.bboxOf(zUp).size[2] === 5);

// STL round trip + ascii
const stl = M.writeSTL(b);
ok('STL size = 84 + 50 per triangle', stl.byteLength === 84 + 12 * 50);
const back = M.parseSTL(stl);
ok('STL binary round trip', back.length === b.length && near(M.meshVolume(back), 24, 1e-4));
const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
ok('STL ascii parse', M.parseSTL(new TextEncoder().encode(ascii).buffer).length === 9);

// OBJ with quads and negative indices
const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\nf -4 -3 -2\n';
ok('OBJ quad -> 2 tris, plus one tri', M.parseOBJ(obj).length === 3 * 9);

// silhouette of a sphere: circle area
const sph = sphere(10);
const sil = M.silhouette(sph, 'front', 600);
const area = sil.mask.reduce((s, v) => s + v, 0) * sil.px * sil.px;
ok('sphere silhouette area ~ pi r^2', near(area / (Math.PI * 100), 1, 0.03), (area / (Math.PI * 100)).toFixed(3));
const loops = M.silhouetteLoops(sil);
const bb = loops.flat();
ok('silhouette loops are exactly 20 x 20', loops.length === 1 && near(Math.max(...bb.map((p) => p[0])) - Math.min(...bb.map((p) => p[0])), 20, 1e-6) && near(Math.max(...bb.map((p) => p[1])), 20, 1e-6));
ok('silhouette outline is a modest number of points', loops[0].length > 20 && loops[0].length < 300, String(loops[0].length));

// silhouette of a box = full rectangle
const bs = M.silhouette(b, 'side', 400);
const bl = M.silhouetteLoops(bs);
ok('box side silhouette -> 3 x 4 rectangle', bl.length === 1 && bl[0].length <= 8 && near(Math.max(...bl[0].map((p) => p[0])), 3, 1e-6) && near(Math.max(...bl[0].map((p) => p[1])), 4, 1e-6));

// section of a sphere at the equator and of a box
const secs = M.sectionLoops(sph, 2, 0);
ok('sphere section is one circle of radius ~10', secs.length === 1 && near(Math.max(...secs[0].map((p) => Math.hypot(p[0], p[1]))), 10, 0.1), String(secs.length));
const sb = M.sectionLoops(b, 2, 2);
ok('box section is a 2 x 3 rectangle', sb.length === 1 && sb[0].length === 4 && near(Math.max(...sb[0].map((p) => p[0])) - Math.min(...sb[0].map((p) => p[0])), 2, 1e-6));

// carve: two squares -> block; three circles -> Steinmetz solid
const sq = { mask: new Uint8Array(100).fill(1), w: 10, h: 10 };
const blk = M.carve({ front: sq, side: sq }, { W: 10, D: 10, H: 10 }, 20);
ok('carve front+side squares = solid block (volume 1000)', near(M.meshVolume(blk.positions), 1000, 1), String(M.meshVolume(blk.positions)));
const circ = (n) => { const m = new Uint8Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + 0.5 - n / 2) ** 2 + (y + 0.5 - n / 2) ** 2 <= (n / 2) ** 2) m[y * n + x] = 1; return { mask: m, w: n, h: n }; };
const c = circ(200);
const st = M.carve({ front: c, side: c, top: c }, { W: 2, D: 2, H: 2 }, 80);
const expected = 8 * (2 - Math.SQRT2); // r = 1
ok('carve three circles ~ Steinmetz volume 4.686', near(M.meshVolume(st.positions) / expected, 1, 0.04), (M.meshVolume(st.positions) / expected).toFixed(3));
ok('carved mesh is watertight (volume positive, triangles multiple of 2)', M.meshVolume(st.positions) > 0 && st.positions.length % 18 === 0);
// single view = extrusion
const one = M.carve({ front: circ(100) }, { W: 4, D: 6, H: 4 }, 60);
ok('one view extrudes along depth (cylinder volume ~ pi*4*6)', near(M.meshVolume(one.positions) / (Math.PI * 4 * 6), 1, 0.05), (M.meshVolume(one.positions) / (Math.PI * 24)).toFixed(3));

// extrude sketch outlines
const outer = S.rectangle([0, 0], [10, 6]);
const hole = S.rectangle([2, 2], [4, 4]);
const lp = M.loopsFromEnts([...outer, ...hole]);
ok('loopsFromEnts finds 2 closed loops', lp.loops.length === 2 && lp.open === 0);
const ex = M.extrudeLoops(lp.loops, 5);
ok('extrusion volume = (60 - 4) * 5 = 280', near(M.meshVolume(ex), 280, 1e-3), String(M.meshVolume(ex)));
const arcs = new S.Sketch();
arcs.add([{ t: 'C', c: [0, 0], r: 2 }]);
const ec = M.extrudeLoops(M.loopsFromEnts(arcs.ents).loops, 3);
ok('circle extrusion volume ~ pi*4*3', near(M.meshVolume(ec) / (Math.PI * 12), 1, 0.02), (M.meshVolume(ec) / (Math.PI * 12)).toFixed(3));
const openProfile = M.loopsFromEnts(outer.slice(0, 3));
ok('open outline is reported, not extruded', openProfile.loops.length === 0 && openProfile.open === 1);

// the real FreeCAD profile extrudes
import fs from 'fs';
import { readDxf, TO_IN } from './core.js';
const real = readDxf(fs.readFileSync('../real_freecad.dxf', 'utf8'));
const ents = S.fromSegments(real.segs);
const rl = M.loopsFromEnts(ents, 0.05);
ok('real FreeCAD profile forms one closed outline (0.05 mm gap tolerance)', rl.loops.length === 1 && rl.open === 0, `loops=${rl.loops.length} open=${rl.open}`);

console.log(fail ? `\n${fail} FAILED` : '\nALL MESH TESTS PASSED');
process.exit(fail ? 1 : 0);
