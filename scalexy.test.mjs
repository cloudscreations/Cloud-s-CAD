import * as S from './sketch.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
{ const d = new S.Sketch(); d.set([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 2] }, { t: 'C', c: [2, 1], r: 1 }]);
  const ids = d.ents.map((e) => e.id); const r = S.scaleXY(d.ents, ids, [0, 0], 2, 1); const bb = S.bbox(r);
  ok('scaleXY width doubles, height unchanged', Math.abs(bb.w - 8) < 1e-6 && Math.abs(bb.h - 2) < 1e-6, JSON.stringify(bb));
  ok('scaleXY turned the circle into lines and counted it', r.converted === 1 && r.every((e) => e.t === 'L'));
  const only = S.scaleXY(d.ents, [ids[0]], [0, 0], 2, 1); ok('scaleXY leaves unselected alone', only[1].b[0] === 4 && only[0].b[0] === 8); }

process.exit(fail ? 1 : 0);
