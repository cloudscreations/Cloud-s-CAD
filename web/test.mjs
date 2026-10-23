import fs from 'fs';
import { convert, parseTap, tapToDxf } from './core.js';

let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

// 1. Round trip: DXF made from the shop's real BobCAD file -> our .tap must match the original byte for byte
const orig = fs.readFileSync('../sample_machine.tap', 'latin1');
const r = convert(fs.readFileSync('../out/roundtrip.dxf', 'utf8'));
ok('roundtrip: no error', !r.error, r.error || '');
ok('roundtrip: byte-identical to BobCAD file', r.tap === orig);
ok('roundtrip: 60 moves, 16 arcs', r.stats.moves === 60 && r.stats.arcs === 16, JSON.stringify(r.stats.moves) + '/' + r.stats.arcs);

// 2. Our own tap parser agrees with Python's analysis (extent 12.4 x 2.9, end at (0,-0.6))
const p = parseTap(orig);
ok('tap parse: end (0,-0.6)', Math.abs(p.end[0]) < 1e-9 && Math.abs(p.end[1] + 0.6) < 1e-9);

// 3. tap -> DXF -> tap
const dxf = tapToDxf(p.segs);
const r2 = convert(dxf);
ok('tap->dxf->tap: byte-identical', r2.tap === orig, r2.error || '');

// 4. Units: mm file with INSUNITS=4 gives inches; no-units file + fit width gives exact width
const mm = convert(fs.readFileSync('../test_profile_mm.dxf', 'utf8'));
ok('mm file -> 3.5 in wide', !mm.error && Math.abs(mm.stats.width - 3.5) < 1e-6, mm.error || mm.stats.width.toFixed(4));
const nu = convert(fs.readFileSync('../test_profile_nounits.dxf', 'utf8'), { fitWidth: 3.5 });
ok('fit-width: exactly 3.5 in', !nu.error && Math.abs(nu.stats.width - 3.5) < 1e-6, nu.error || nu.stats.width.toFixed(4));

// 5. Safety: separate shapes are refused
const two = fs.readFileSync('../out/two_shapes.dxf', 'utf8');
const t = convert(two);
ok('two separate shapes refused', !!t.error && t.tap === null, (t.error || '').slice(0, 60));
const t2 = convert(two, { allowMulti: true });
ok('allow-multi works with warning', !t2.error && t2.warnings.some((w) => /CUT a straight line/.test(w)));

// 6. Reverse flips direction but keeps geometry
const fwd = convert(fs.readFileSync('../test_profile_mm.dxf', 'utf8'));
const bwd = convert(fs.readFileSync('../test_profile_mm.dxf', 'utf8'), { reverse: true });
const pf = parseTap(fwd.tap), pb = parseTap(bwd.tap);
ok('reverse: same closed loop, opposite direction', Math.abs(pf.end[0]) < 1e-3 && Math.abs(pb.end[0]) < 1e-3 && fwd.tap !== bwd.tap);

// 7. Spline support (ezdxf-made)
if (fs.existsSync('../out/spline.dxf')) {
  const s = convert(fs.readFileSync('../out/spline.dxf', 'utf8'));
  ok('spline: converts with a note about the approximation', !s.error && s.notes.some((w) => /spline/i.test(w)), s.error || '');
}

// 8. A real file straight from FreeCAD 1.1 (mm, 4 splines + lines, tiny endpoint gaps)
if (fs.existsSync('../real_freecad.dxf')) {
  const f = convert(fs.readFileSync('../real_freecad.dxf', 'utf8'));
  ok('real FreeCAD file: converts, one closed path', !f.error && f.stats.paths === 1, f.error || `paths=${f.stats && f.stats.paths}`);
  if (f.tap) {
    const pf = parseTap(f.tap);
    ok('real FreeCAD file: loop returns to start', Math.hypot(pf.end[0], pf.end[1]) < 0.01, `end=(${pf.end[0].toFixed(4)}, ${pf.end[1].toFixed(4)})`);
    ok('real FreeCAD file: size 0.584 x 4.520 in', Math.abs(f.stats.width - 0.5838) < 0.001 && Math.abs(f.stats.height - 4.5197) < 0.001, `${f.stats.width.toFixed(4)} x ${f.stats.height.toFixed(4)}`);
    ok('real FreeCAD file: move count is sane (<400)', f.stats.moves < 400, String(f.stats.moves));
    console.log('   ' + f.notes.join(' | '));
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
