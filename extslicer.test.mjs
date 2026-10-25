import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { buildStl, buildPrusaIni, parseGcode } from './extslicer.js';
import { mergeSettings, placeModel } from './slicer.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const cube = (a) => { const v = [[0,0,0],[a,0,0],[a,a,0],[0,a,0],[0,0,a],[a,0,a],[a,a,a],[0,a,a]], f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]; return new Float32Array(f.flatMap((t) => t.flatMap((i) => v[i]))); };
const s = mergeSettings({ walls: 2, infillDensity: 0.2 }); const pm = placeModel(cube(20), { bed: s.bed });
const stl = buildStl(pm.pos); ok('stl size', stl.length === 84 + 12 * 50);
const ini = buildPrusaIni({ walls: 2, speed: { outerWall: 30 }, bed: { x: 200, y: 200, z: 200 } }); ok('partial settings ok (no undefined)', !/undefined|NaN/.test(ini)); const ini2 = buildPrusaIni(s); ok('ini has bed + temps', /bed_shape = 0x0,220x0/.test(ini2) && /first_layer_temperature = 210/.test(ini));
const hasPrusa = (() => { try { execFileSync('which', ['prusa-slicer']); return true; } catch { return false; } })();
if (hasPrusa) {
  fs.mkdirSync('/tmp/exttest', { recursive: true }); fs.writeFileSync('/tmp/exttest/m.stl', stl); fs.writeFileSync('/tmp/exttest/c.ini', ini2);
  let out = ''; try { out = execFileSync('prusa-slicer', ['--export-gcode', '--load', '/tmp/exttest/c.ini', '--output', '/tmp/exttest/o.gcode', '/tmp/exttest/m.stl'], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = String(e.stdout) + String(e.stderr); }
  ok('prusa-slicer wrote gcode', fs.existsSync('/tmp/exttest/o.gcode'), out.slice(0, 400));
  if (fs.existsSync('/tmp/exttest/o.gcode')) {
    const r = parseGcode(fs.readFileSync('/tmp/exttest/o.gcode', 'utf8'));
    console.log(JSON.stringify(r.stats), [...new Set(r.layers.flatMap((l) => l.paths.map((p) => p.t)))].join(','));
    ok('about 100 layers for 20 mm at 0.2', r.stats.layers >= 98 && r.stats.layers <= 101, r.stats.layers);
    ok('has outer, infill, solid', ['outer', 'infill', 'solid'].every((t) => r.layers.some((l) => l.paths.some((p) => p.t === t))));
    ok('stays on bed', r.layers.every((l) => l.paths.every((p) => p.p.every((v, i) => v > 85 && v < 135))));
    ok('top at 20 mm', Math.abs(r.stats.height - 20) < 0.05, r.stats.height);
    ok('filament plausible (20mm cube ~ 1-2 m)', r.stats.filamentMeters > 0.8 && r.stats.filamentMeters < 3, r.stats.filamentMeters);
  }
} else console.log('SKIP prusa-slicer not installed');
const a = parseGcode('G90\nM83\nG1 Z0.2\nG1 X10 Y10 F3000\n;TYPE:Perimeter\nG1 X20 Y10 E0.5\nG1 X20 Y20 E0.5\nG1 Z0.4\nG1 X10 Y20 E0.5\nG1 X10 Y10 E0.5\n');
ok('parser layers + relative E', a.layers.length === 2 && Math.abs(a.stats.extruded - 2) < 1e-9, JSON.stringify(a.stats));
console.log(fail ? `\n${fail} FAILED` : '\nALL EXT SLICER TESTS PASSED'); process.exit(fail ? 1 : 0);
