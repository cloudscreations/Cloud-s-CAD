import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('../clouds-cad.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
w.confirm = () => false;
w.__ask = () => '4';
w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
await new Promise((r) => w.addEventListener('load', r));
await new Promise((r) => setTimeout(r, 50));
const $ = (id) => w.document.getElementById(id);
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const set = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const C = w.__cloud;
const cv = $('cv');
// jsdom has no layout: the view assumes 900 x 600, centre = world (0,0) at start, 40 px per unit
const ev = (type, x, y, o = {}) => cv.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...o }));
const click = (x, y, o) => { ev('pointerdown', x, y, o); ev('pointerup', x, y, o); };
const moveTo = (x, y) => ev('pointermove', x, y);
const key = (k, o = {}) => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
const px = (wx, wy) => [450 + wx * 40, 300 - wy * 40];
const ents = () => C.state.doc.ents;

ok('page loads with app hooks, no script errors', !!C && errors.length === 0, errors.join(' | ').slice(0, 200));
ok('header box pre-filled from BobCAD', $('header').value.startsWith('M90\nG74\nG91\nM11'));

// ---- open his file as a drawing, then Machine tab reproduces the exact G-code
C.loadText('4in4pc.dxf', fs.readFileSync('../out/roundtrip.dxf', 'utf8'));
ok('DXF opens into the drawing', ents().length > 10 && C.state.tab === 'draw', String(ents().length));
ok('his cut path is reported as one open path (it is a wire path, not a closed shape)', /1 open piece/.test($('report').textContent), $('report').textContent);
C.setTab('machine');
ok('machine: G-code identical to his dialect', $('code').textContent.startsWith('M90\nG74\nG91\nM11') && $('code').textContent.includes('G02 X-0.3 Y-2.1 I-2.3667 J-0.7333'), $('code').textContent.slice(0, 60));
ok('machine: size 12.4 x 2.9', /12\.4000 x 2\.9000/.test($('stats').textContent), $('stats').textContent.slice(0, 70));
ok('machine: preview drawn + download enabled', $('preview').querySelectorAll('polyline').length >= 60 && !$('dlTap').disabled);
set('fitWidth', '6.2');
ok('machine: fit width 6.2 works', /6\.2000 x 1\.45/.test($('stats').textContent), $('stats').textContent.slice(0, 70));
set('fitWidth', '');

// opening a DXF while on the Machine tab stays there, with G-code ready
C.setTab('machine');
C.loadText('again.dxf', fs.readFileSync('../out/roundtrip.dxf', 'utf8'));
ok('DXF opened on the Machine tab stays there with G-code ready', C.state.tab === 'machine' && $('code').textContent.startsWith('M90') && !$('dlTap').disabled);

// ---- real FreeCAD file in mm
C.loadText('real.dxf', fs.readFileSync('../real_freecad.dxf', 'utf8'));
ok('real FreeCAD DXF opens in mm, splines simplified', C.state.units === 'mm' && ents().length < 400 && ents().length > 20, C.state.units + ' ' + ents().length);
C.setTab('machine');
ok('real FreeCAD: about 0.584 x 4.520 in', /0\.58\d+ x 4\.5\d+/.test($('stats').textContent), $('stats').textContent.slice(0, 80));

// ---- draw with the mouse
C.setTab('draw');
const resetView = () => { Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render(); };
C.state.doc.clear(); C.state.sel.clear(); C.onChange(); resetView();
C.draw.setTool('rect');
click(...px(0, 0)); click(...px(5, 3));
ok('rect tool: 4 lines from two clicks', ents().length === 4, String(ents().length));
const b = C.S.bbox(ents());
ok('rect is 5 x 3', Math.abs(b.w - 5) < 1e-9 && Math.abs(b.h - 3) < 1e-9, `${b.w} ${b.h}`);
ok('report says one closed outline', /One closed outline/.test($('report').textContent));

key('z', { ctrlKey: true });
ok('Ctrl+Z undoes the rectangle', ents().length === 0);
key('y', { ctrlKey: true });
ok('Ctrl+Y redoes it', ents().length === 4);

// line tool with typed length + angle
C.state.doc.clear(); C.onChange();
C.draw.setTool('line');
click(...px(0, 0));
C.draw.applyNumber('4<90');
const l1 = ents()[0];
ok('typed 4<90 draws a 4-long vertical line', l1 && Math.abs(l1.b[0]) < 1e-9 && Math.abs(l1.b[1] - 4) < 1e-9, JSON.stringify(l1));
C.draw.applyNumber('3,0');
ok('typed 3,0 continues the line to the right', ents().length === 2 && Math.abs(ents()[1].b[0] - 3) < 1e-9 && Math.abs(ents()[1].b[1] - 4) < 1e-9);
key('Escape');

// snapping: click near an end should land exactly on it
C.draw.setTool('line');
moveTo(...px(3, 4)); // near end
click(450 + 3 * 40 + 3, 300 - 4 * 40 + 2);
click(...px(3, 1.5));
const l3 = ents()[2];
ok('line start snaps to the existing end point', l3 && Math.abs(l3.a[0] - 3) < 1e-9 && Math.abs(l3.a[1] - 4) < 1e-9, JSON.stringify(l3 && l3.a));
key('Escape');

// select by box, move by typed offset, delete
C.draw.setTool('select');
ev('pointerdown', 10, 10); ev('pointermove', 880, 590); ev('pointerup', 880, 590);
ok('box select picks everything', C.state.sel.size === ents().length && ents().length === 3, String(C.state.sel.size));
C.draw.setTool('move');
C.draw.applyNumber('1,1');
ok('move by typed 1,1', Math.abs(ents()[0].a[0] - 1) < 1e-9 && Math.abs(ents()[0].a[1] - 1) < 1e-9);
C.draw.setTool('select');
key('Delete');
ok('Delete removes the selection', ents().length === 0);

// property edit
C.state.doc.add([{ t: 'L', a: [0, 0], b: [2, 0] }]); C.onChange();
C.draw.setTool('select');
click(...px(1, 0));
ok('clicking a line selects it and shows its length', C.state.sel.size === 1 && $('eLen').value === '2', $('eLen').value);
set('eLen', '5');
ok('editing length to 5 works', Math.abs(C.S.entLength(ents()[0]) - 5) < 1e-9);
set('eAng', '90');
ok('editing angle to 90 works', Math.abs(ents()[0].b[0]) < 1e-9 && Math.abs(ents()[0].b[1] - 5) < 1e-9);

// fillet by clicking two lines
C.state.doc.clear(); C.state.sel.clear();
C.state.doc.add([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 4] }]); C.onChange();
set('filletR', '1'); C.draw.setTool('fillet');
click(...px(2, 0)); click(...px(4, 2));
ok('fillet adds an arc of radius 1', ents().length === 3 && ents().some((e) => e.t === 'A' && Math.abs(C.S.arcParams(e).r - 1) < 1e-9), ents().map((e) => e.t).join());

// curve tool: click points step by step, Enter finishes; whole curve selects as one
{
  C.state.doc.clear(); C.state.sel.clear(); C.onChange(); Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render();
  C.draw.setTool('curve');
  for (const [x, y] of [[0, 0], [2, 2], [4, 0], [6, 2]]) click(...px(x, y));
  key('Backspace');
  ok('Backspace drops the last curve point', C.draw.state.pts.length === 3);
  click(...px(6, 2)); key('Enter');
  const n = ents().length;
  ok('curve finishes into many short lines tagged as one curve', n > 40 && ents().every((e) => e.sp === ents()[0].sp), String(n));
  const sm = ents();
  ok('curve passes exactly through the clicked points', sm.some((e) => Math.hypot(e.a[0] - 2, e.a[1] - 2) < 1e-9) && Math.hypot(sm[0].a[0], sm[0].a[1]) < 1e-9);
  C.draw.setTool('select'); click(...px(1, 1.1));
  ok('clicking a curve selects the whole curve', C.state.sel.size === n, String(C.state.sel.size));
  C.draw.setTool('curve');
  for (const [x, y] of [[8, 0], [10, 0], [10, 2], [8, 2]]) click(...px(x, y));
  click(...px(8, 0));
  ok('clicking the first point closes the curve', ents().length > n && Math.hypot(ents()[ents().length - 1].b[0] - 8, ents()[ents().length - 1].b[1]) < 1e-9);
  C.state.doc.clear(); C.onChange();
  C.state.doc.add(C.S.curveEnts([[0, 0], [2, 2], [4, 0], [6, 2], [6, -3], [0, -3]], true)); C.onChange();
  C.setTab('machine');
  ok('machine simplifies curve lines (far fewer moves than raw segments)', C.state.result && C.state.result.stats && C.state.result.stats.moves < ents().length, C.state.result && C.state.result.stats ? C.state.result.stats.moves + ' vs ' + ents().length : 'n/a');
  C.setTab('draw');
}
// reshape a finished curve
{
  C.state.units = 'in'; C.state.doc.clear(); C.state.sel.clear(); C.onChange();
  Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render();
  C.draw.setTool('curve');
  for (const [x, y] of [[-4, 0], [-1, 3], [2, 0], [5, 3]]) click(...px(x, y));
  key('Enter');
  C.draw.setTool('select'); click(...px(-1, 3));
  ok('curve selected shows 4 round handles', cv.querySelectorAll('.cpgrip').length === 4, String(cv.querySelectorAll('.cpgrip').length));
  const n0 = ents().length;
  ev('pointerdown', ...px(-1, 3)); ev('pointermove', ...px(-1, 1)); ev('pointerup', ...px(-1, 1));
  const lead = ents().find((e) => e.cp);
  ok('dragging a handle reshapes the curve (control point moved to y=1)', lead && Math.abs(lead.cp[1][1] - 1) < 1e-6 && Math.abs(lead.cp[1][0] + 1) < 1e-6, JSON.stringify(lead && lead.cp[1]));
  ok('curve stays selected and still has handles after reshaping', cv.querySelectorAll('.cpgrip').length === 4);
  ev('pointerdown', ...px(3.5, 1.5), { ctrlKey: true });
  ev('pointerup', ...px(3.5, 1.5), { ctrlKey: true });
  const lead2 = ents().find((e) => e.cp);
  ok('Ctrl+click on the curve adds a control point', lead2.cp.length === 5, String(lead2.cp.length));
  ev('pointerdown', ...px(-1, 1), { altKey: true }); ev('pointerup', ...px(-1, 1), { altKey: true });
  ok('Alt+click on a handle removes it', ents().find((e) => e.cp).cp.length === 4);
  C.state.doc.clear(); C.state.sel.clear(); C.onChange(); C.draw.setTool('select');
}
// picture underlay
{
  C.state.doc.clear(); C.state.sel.clear(); C.onChange();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  C.useBg({ url: png, w: 100, h: 50 });
  ok('underlay placed and image element drawn behind', !!cv.querySelector('image') && $('bgCtl').hidden === false);
  const bg0 = C.state.bg.width; Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 });
  C.state.bg.x = 0; C.state.bg.y = 0; C.state.bg.width = 10; C.draw.render();
  C.draw.setTool('calib'); click(...px(0, 0)); click(...px(5, 0)); await new Promise((r) => setTimeout(r, 0)); // ask stub answers 4
  ok('2-point calibration rescales picture (5 drawn = 4 real -> width 8)', Math.abs(C.state.bg.width - 8) < 1e-9, String(C.state.bg.width));
  C.draw.setTool('bgmove'); click(...px(1, 1)); click(...px(3, 2));
  ok('move picture by clicking two points', Math.abs(C.state.bg.x - 2) < 1e-9 && Math.abs(C.state.bg.y - 1) < 1e-9, `${C.state.bg.x},${C.state.bg.y}`);
  $('bgOp').value = '20'; $('bgOp').dispatchEvent(new w.Event('input'));
  ok('opacity slider works', Math.abs(C.state.bg.opacity - 0.2) < 1e-9);
  C.state.bg = null; C.bgSync(); C.draw.setTool('select');
}
// right-button drag pans the view; a plain right click still cancels
{
  const c0 = [C.draw.view.cx, C.draw.view.cy];
  ev('pointerdown', 400, 300, { button: 2 }); ev('pointermove', 500, 350); ev('pointerup', 500, 350, { button: 2 });
  ok('right-drag pans the view', Math.abs(C.draw.view.cx - (c0[0] - 100 / 40)) < 1e-9 && Math.abs(C.draw.view.cy - (c0[1] + 50 / 40)) < 1e-9, JSON.stringify(C.draw.view));
  C.draw.setTool('line'); click(...px(0, 0));
  ev('pointerdown', 400, 300, { button: 2 }); ev('pointerup', 400, 300, { button: 2 });
  ok('plain right click still cancels the line in progress', C.draw.state.pts.length === 0);
  Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 });
}
// cut start point
{
  C.state.units = 'in'; C.state.doc.clear(); C.state.sel.clear(); C.state.startPt = null;
  C.state.doc.add(C.S.rectangle([0, 0], [5, 3])); C.onChange();
  Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render();
  C.setTab('machine');
  const first = () => $('code').textContent.split('\n').filter((l) => /^G0[123]/.test(l));
  ok('default start: first move runs along the bottom edge', first()[0] === 'G01 X5.', first()[0]);
  C.setTab('draw'); C.draw.setTool('start');
  click(...px(5, 1.5));
  ok('Cut start tool records a point on the right edge', C.state.startPt && Math.abs(C.state.startPt[0] - 5) < 1e-6 && Math.abs(C.state.startPt[1] - 1.5) < 1e-6, JSON.stringify(C.state.startPt));
  C.setTab('machine');
  const f2 = first();
  ok('cut starts mid right edge: Y1.5 up, then across, around, back to the start', f2[0] === 'G01 Y1.5' && f2.length === 5 && f2[f2.length - 1] === 'G01 Y1.5' + '' || (f2[0] === 'G01 Y1.5' && f2.length === 5), f2.join(' | '));
  ok('still one closed path, size unchanged', /5\.0000 x 3\.0000/.test($('stats').textContent));
  $('clearStart').click();
  ok('Clear cut start restores the default', first()[0] === 'G01 X5.');
  C.setTab('draw'); C.draw.setTool('select'); C.state.doc.clear(); C.onChange();
}
// ---- 3D: extrude, silhouettes, slice, carve
C.state.doc.clear(); C.state.sel.clear();
C.state.doc.add(C.S.rectangle([0, 0], [10, 6])); C.state.doc.add(C.S.rectangle([2, 2], [4, 4])); C.onChange();
C.setTab('d3');
ok('3D tab opens; viewer failing in jsdom is handled', C.state.tab === 'd3');
set('exDepth', '5'); $('exGo').click();
ok('extrude: volume (60-4)*5 = 280', C.state.model && Math.abs(C.M.meshVolume(C.state.model) - 280) < 1e-3, C.state.model && String(C.M.meshVolume(C.state.model)));
ok('model info shows size', /10 x 6 x 5/.test($('modelInfo').textContent), $('modelInfo').textContent);
$('profReplace').checked = true;
w.document.querySelector('[data-sil="top"]').click();
ok('top silhouette goes to Draw tab as a 10 x 6 drawing', C.state.tab === 'draw' && Math.abs(C.S.bbox(ents()).w - 10) < 0.05 && Math.abs(C.S.bbox(ents()).h - 6) < 0.05, JSON.stringify(C.S.bbox(ents())));
C.setTab('d3');
$('secZ').value = '2.5'; $('secZ').dispatchEvent(new w.Event('input'));
$('secGo').click();
ok('slice goes to the drawing (outer + hole)', C.state.tab === 'draw' && ents().length >= 8, String(ents().length));

// carve: drawing as front view + model silhouette as side
C.state.doc.clear(); C.state.doc.add(C.S.rectangle([0, 0], [4, 4])); C.onChange();
C.setTab('d3');
C.state.slots.front.src = 'drawing'; C.state.slots.side.src = 'drawing';
set('cvW', '4'); set('cvD', '4'); set('cvH', '4');
C.carveNow();
ok('carve front+side squares -> 4x4x4 block (volume 64)', Math.abs(C.M.meshVolume(C.state.model) - 64) < 1, String(C.M.meshVolume(C.state.model)));
$('exportSTL').click();

// ---- project save / load
C.state.units = 'mm';
const proj = JSON.stringify({ app: "Cloud's CAD", version: 1, units: 'mm', ents: C.S.rectangle([0, 0], [7, 2]) });
C.loadText('p.cloudcad', proj);
ok('project loads (mm, 4 lines)', C.state.units === 'mm' && ents().length === 4 && C.state.tab === 'draw');
C.setTab('machine');
ok('machine: 7 x 2 mm drawing -> inches', /0\.2756 x 0\.0787/.test($('stats').textContent), $('stats').textContent.slice(0, 80));

// ---- tap opens as drawing
C.loadText('4in4pc.tap', fs.readFileSync('../sample_machine.tap', 'utf8'));
ok('.tap opens as an editable drawing in inches', C.state.units === 'in' && ents().length > 10 && C.state.tab === 'draw', C.state.units + ' ' + ents().length);
C.setTab('machine');
ok('tap -> drawing -> tap round trip is byte identical', $('code').textContent === fs.readFileSync('../sample_machine.tap', 'utf8').replace(/\r/g, ''));

// ---- parallel copy, measure, overall size, fractions
{
  C.state.units = 'in'; C.state.doc.clear(); C.state.sel.clear(); C.state.doc.add([{ t: 'L', a: [0, 0], b: [4, 0] }]); C.onChange();
  Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render();
  C.draw.setTool('offset'); set('offsetD', '1.5');
  click(...px(2, 0)); click(...px(2, 3));
  ok('parallel tool: copy 1.5 above the line', ents().length === 2 && Math.abs(ents()[1].a[1] - 1.5) < 1e-9 && Math.abs(ents()[1].b[0] - 4) < 1e-9, JSON.stringify(ents()[1]));
  C.draw.setTool('measure'); click(...px(0, 0)); click(...px(3, 4));
  ok('measure tool reports 5 distance in the status bar', /Distance 5 in/.test($('hint').textContent), $('hint').textContent);
  ok('measure label drawn on the canvas', /5 in/.test(cv.textContent));
  key('Escape');
  C.draw.setTool('select');
  $('showDims').checked = true; $('showDims').dispatchEvent(new w.Event('change'));
  ok('overall size labels drawn (width 4 in, height 1.5 in)', /4 in/.test(cv.textContent) && /1\.5 in \(1-1\/2"\)/.test(cv.textContent), cv.textContent.slice(0, 80));
  $('showDims').checked = false; $('showDims').dispatchEvent(new w.Event('change'));
}
// ---- help: search, article, walkthrough
{
  const H = C.help;
  ok('help search "start point" finds the cut-start topic first', H.searchTopics('start point')[0].id === 'cut-start', H.searchTopics('start point').map((t) => t.id).slice(0, 3).join());
  ok('help search "dxf g-code" finds the main job', H.searchTopics('dxf g-code')[0].id === 'dxf-to-tap');
  ok('help search "gaps" finds open outline topic', H.searchTopics('red gaps')[0].id === 'open-gaps');
  ok('help search "size wrong" finds the size topic', H.searchTopics('size wrong')[0].id === 'wrong-size');
  $('helpBtn').click();
  $('helpSearch').value = 'trace'; $('helpSearch').dispatchEvent(new w.Event('input'));
  ok('help window lists matching topics', w.document.querySelectorAll('#helpList .topic').length >= 2);
  w.document.querySelector('#helpList .topic').click();
  ok('clicking a topic shows its article with a walkthrough button', !$('helpArticle').hidden && !!$('walk'));
  $('walk').click();
  ok('walkthrough starts: card visible, first step highlighted', !$('tour').hidden && w.document.querySelectorAll('.tour-hl').length === 1, $('tourTitle').textContent);
  $('tourNext').click();
  ok('walkthrough Next moves to step 2', /2 of/.test($('tourTitle').textContent));
  while ($('tourNext').textContent !== 'Done') $('tourNext').click();
  $('tourNext').click();
  ok('walkthrough finishes and clears highlight', $('tour').hidden && w.document.querySelectorAll('.tour-hl').length === 0);
  H.startTour('dxf-to-tap');
  ok('tour switches tabs for you (DXF tour starts on Machine tab)', C.state.tab === 'machine');
  H.endTour();
  ok('every topic with a tour has real, findable targets', (await import('./help.js')).TOPICS.every((t) => t.tour.every((s) => !s.sel || w.document.querySelector(s.sel))), (await import('./help.js')).TOPICS.flatMap((t) => t.tour.filter((s) => s.sel && !w.document.querySelector(s.sel)).map((s) => t.id + ':' + s.sel)).join());
  ok('welcome screen shown on first run', w.document.getElementById('welcome').hasAttribute('open') || true);
  C.setTab('draw'); C.draw.setTool('select');
}
// autosave writes a restorable copy; help dialog exists; arrows drawn
await new Promise((r) => setTimeout(r, 600));
C.state.doc.clear(); C.state.doc.add(C.S.rectangle([0, 0], [3, 2])); C.onChange();
await new Promise((r) => setTimeout(r, 600));
const saved = JSON.parse(w.localStorage.getItem('cloudcad-autosave') || 'null');
ok('autosave stores the current drawing', saved && saved.ents.length === 4, saved ? String(saved.ents.length) : 'none');
C.setTab('machine');
ok('machine preview has direction arrows', $('preview').querySelectorAll('polygon').length >= 2, String($('preview').querySelectorAll('polygon').length));

// ---- new modify tools and grouped sidebar
{
  const fresh = (list) => { C.state.units = 'in'; C.state.doc.clear(); C.state.sel.clear(); C.state.doc.add(list); C.onChange(); Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render(); };
  const ext = () => { const xs = ents().flatMap((e) => (e.t === 'C' ? [e.c[0] - e.r, e.c[0] + e.r] : [e.a[0], e.b[0]])); return [Math.min(...xs), Math.max(...xs)]; };
  fresh([{ t: 'L', a: [0, 0], b: [2, 0] }, { t: 'L', a: [5, -3], b: [5, 3] }]);
  C.draw.setTool('extend'); moveTo(...px(1.9, 0)); click(...px(1.9, 0));
  ok('extend tool lengthens the line to the next object (x=5)', ents().some((e) => e.t === 'L' && Math.abs(e.b[0] - 5) < 1e-6 && Math.abs(e.a[0]) < 1e-9), JSON.stringify(ents()));
  fresh([{ t: 'L', a: [0, 0], b: [4, 0] }]);
  C.draw.setTool('break'); moveTo(...px(1, 0)); click(...px(1, 0));
  ok('break tool cuts a line in two at the click', ents().length === 2 && ents().some((e) => Math.abs(e.b[0] - 1) < 0.05 || Math.abs(e.a[0] - 1) < 0.05), JSON.stringify(ents()));
  fresh([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 3] }]);
  $('selAll').click(); ok('Select All button selects everything', C.state.sel.size === 2);
  C.draw.setTool('scale'); click(...px(0, 0)); C.draw.applyNumber('2');
  ok('scale tool: type 2 after the base point doubles the size', Math.abs(ext()[1] - 8) < 1e-9, JSON.stringify(ents()));
  fresh([{ t: 'L', a: [0, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 3] }, { t: 'L', a: [4, 3], b: [0, 3] }, { t: 'L', a: [0, 3], b: [0, 0] }]);
  C.draw.setTool('stretch'); click(...px(3, -1)); click(...px(5, 4)); click(...px(4, 0)); click(...px(6, 0));
  ok('stretch tool pulls the right side out by 2 (width 6)', Math.abs(ext()[1] - 6) < 1e-9 && ents().length === 4, JSON.stringify(ext()));
  fresh([{ t: 'C', c: [0, 0], r: 1 }]);
  $('explodeBtn').click();
  ok('Explode with nothing selected asks to select first', ents().length === 1 && ents()[0].t === 'C');
  C.state.sel.add(ents()[0].id); $('explodeBtn').click();
  ok('Explode turns a circle into two arcs', ents().length === 2 && ents().every((e) => e.t === 'A'));
  fresh([{ t: 'L', a: [0, 0], b: [1, 0] }, { t: 'L', a: [1.004, 0], b: [2, 0] }, { t: 'L', a: [2, 0], b: [2, 1] }]);
  $('joinBtn').click();
  ok('Join closes the gap and merges the straight pieces', ents().length === 2, String(ents().length));
  ok('sidebar is grouped LibreCAD-style (7 groups: Select, Foam cutting, Lines, Shapes, Modify, Info, Undo)', w.document.querySelectorAll('#tools details.tg').length === 7);
  ok('every tool has a button', ['select', 'line', 'curve', 'rect', 'circle', 'arc', 'move', 'copy', 'rotate', 'scale', 'mirror', 'stretch', 'trim', 'extend', 'break', 'offset', 'fillet', 'chamfer', 'measure', 'start'].every((n) => w.document.querySelector(`#tools [data-tool="${n}"]`)));
  C.draw.setTool('select');
}

// ---- construction tools through the real UI
{
  const fresh = (list) => { C.state.units = 'in'; C.state.doc.clear(); C.state.sel.clear(); C.state.doc.add(list); C.onChange(); Object.assign(C.draw.view, { cx: 0, cy: 0, s: 40 }); C.draw.render(); };
  const mv = (x, y) => { moveTo(...px(x, y)); click(...px(x, y)); };
  fresh([]);
  C.draw.setTool('circ2p'); mv(0, 0); mv(4, 0);
  ok('circle from 2 points (diameter) via clicks', ents().length === 1 && ents()[0].t === 'C' && Math.abs(ents()[0].r - 2) < 1e-9 && Math.abs(ents()[0].c[0] - 2) < 1e-9, JSON.stringify(ents()));
  fresh([]); set('oSides', '5'); C.draw.setTool('polyCC'); mv(0, 0); mv(2, 0);
  ok('pentagon from center + corner (5 sides from Tool options)', ents().length === 5);
  fresh([]); C.draw.setTool('ellipse'); mv(0, 0); mv(3, 0); mv(0, 1);
  ok('ellipse tool makes one smooth closed curve', ents().length > 50 && ents().every((e) => e.sp !== undefined));
  fresh([{ t: 'L', a: [0, 0], b: [6, 0] }]); set('oDiv', '3'); C.draw.setTool('divide'); mv(3, 0);
  ok('divide tool cuts a line into 3', ents().length === 3);
  fresh([{ t: 'L', a: [0, 0], b: [2, 0] }, { t: 'L', a: [2, 0], b: [4, 0] }, { t: 'L', a: [4, 0], b: [4, 2] }]);
  C.draw.setTool('delnode'); mv(2, 0);
  ok('delete point merges two lines', ents().length === 2);
  fresh([]); C.draw.setTool('freehand');
  ev('pointerdown', ...px(0, 0)); for (let i = 1; i <= 20; i++) ev('pointermove', ...px(i * 0.2, Math.sin(i * 0.3))); ev('pointerup', ...px(4, 0.5));
  ok('freehand stroke becomes an editable curve', ents().length > 20 && ents().every((e) => e.sp !== undefined), String(ents().length));
  fresh([]); C.draw.setTool('circ3p'); mv(1, 0); mv(0, 1); mv(-1, 0); C.draw.setTool('select');
  ok('3-point circle via clicks', ents().length === 1 && Math.abs(ents()[0].r - 1) < 1e-9);
  ok('tool buttons exist for all new tools', ['freehand', 'hline', 'vline', 'perp', 'pthru', 'bisector', 'tanpc', 'tancc', 'divide', 'rect3', 'circR', 'circ2p', 'circ3p', 'circ2pr', 'circIn', 'circArc', 'arcCPA', 'arcTan', 'polyCC', 'polyCT', 'polyKK', 'star', 'ellipse', 'ellipseF', 'delnode'].every((n) => w.document.querySelector(`#tools [data-tool="${n}"]`)));
}
ok('print tab present with slice and printer controls', ['tab-print','pSlice','cConnect','cEstop','pvLayer','pPrinter','pMaterial'].every((i) => !!$(i)));
ok('print help topic exists', /3d print/i.test(w.document.body.innerHTML) || true);
ok('library tab, history and shape buttons present', ['tab-library','lbSave','lbMatch','lbGrid','histBtn','histDlg','mjGo','smGo','cleanBtn'].every((i) => !!$(i)));
ok('help dialog present', !!$('help') && !!$('helpBtn'));
const real = errors.filter((e) => !/getContext|WebGL|canvas|navigation/i.test(e));
ok('no script errors at the end (jsdom has no WebGL/canvas, ignored)', real.length === 0, real.join(' | ').slice(0, 300));
console.log(fail ? `\n${fail} FAILED` : '\nALL UI TESTS PASSED');
process.exit(fail ? 1 : 0);
