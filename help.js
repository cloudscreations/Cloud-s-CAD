// Cloud's CAD - searchable help and step-by-step walkthroughs. License: GPL v3

export const TOPICS = [
  {
    id: 'dxf-to-tap', title: 'Turn a DXF into G-code (.tap)', keys: 'dxf gcode g-code tap convert freecad librecad bobcad machine file download start here main job',
    text: 'The everyday job: open the DXF, check the size, pick where the cut starts, download the .tap. Speed, temperature and the start position are handled by your machine, so none of that is in the file.',
    tour: [
      { tab: 'machine', sel: '#openBtn', text: 'Click Open file and choose your DXF (or just drop the file on the page). The size and units are read from the file.' },
      { tab: 'machine', sel: '#fitWidth', text: 'If the size looks wrong, type the width the profile should really be, in inches. This replaces the LibreCAD scale fix.' },
      { tab: 'draw', tool: 'start', sel: '[data-tool=start]', text: 'Optional: click Cut start, then click the point on the outline where the wire should start. For a closed shape it goes all the way around and ends there.' },
      { tab: 'machine', sel: '#preview', text: 'This picture is drawn from the finished G-code. Arrows show the direction the wire travels. Green dot is the start, orange dot the end.' },
      { tab: 'machine', sel: '#dlTap', text: 'Click Download .tap, put it where your machine reads files, and do a dry run before cutting foam.' },
    ],
  },
  {
    id: 'draw-profile', title: 'Draw a profile from scratch', keys: 'draw line rectangle circle arc create new sketch profile make shape type length',
    text: 'Pick a tool on the left, click in the drawing area. You can type exact sizes: press a number key, type, press Enter.',
    tour: [
      { tab: 'draw', tool: 'line', sel: '[data-tool=line]', text: 'Choose Line. Click where it starts.' },
      { tab: 'draw', sel: '#num', text: 'Now type a length, like 4, and press Enter. For an angle type 4<90 (4 long, pointing straight up). Or type 3,2 to move 3 across and 2 up.' },
      { tab: 'draw', sel: '[data-tool=rect]', text: 'Rectangle and Circle work the same way: click, then click again or type the size (width,height for a rectangle, radius for a circle).' },
      { tab: 'draw', sel: '[data-tool=trim]', text: 'Trim removes the part of a line between where it crosses other lines. Fillet rounds a corner, Chamfer cuts it.' },
      { tab: 'draw', sel: '#report', text: 'When the outline is closed this says "One closed outline". Red circles on the drawing mark gaps.' },
    ],
  },
  {
    id: 'trace-by-hand', title: 'Trace a picture by hand (like FreeCAD)', keys: 'trace image picture photo underlay background curve by hand scale calibrate ruler',
    text: 'Put the picture behind the grid, tell the program one real size on it, then draw over it with Curve and Line.',
    tour: [
      { tab: 'draw', sel: '#imgFile', text: 'Choose your picture here.' },
      { tab: 'draw', sel: '#bgUse', text: 'Click Show picture behind the drawing.' },
      { tab: 'draw', sel: '#bgCal', text: 'Click Set size by 2 points, click two spots on the picture whose real distance you know (a ruler, or a labeled dimension), then type that distance.' },
      { tab: 'draw', tool: 'curve', sel: '[data-tool=curve]', text: 'Choose Curve. Click points along the edge one at a time. Enter or right-click finishes. Backspace removes the last point. Click the first point to close it.' },
      { tab: 'draw', sel: '#bgOp', text: 'Use the opacity slider if the picture is hard to see. The picture is never part of the cut.' },
    ],
  },
  {
    id: 'auto-trace', title: 'Trace a picture automatically', keys: 'auto trace outline picture photo image silhouette convert color',
    text: 'Best with a clear colored or dark shape on a plain background. Text and dimension lines in other colors are ignored.',
    tour: [
      { tab: 'draw', sel: '#imgFile', text: 'Choose your picture.' },
      { tab: 'draw', sel: '#imgW', open: true, text: 'Type the real width of the object (or of everything in the picture) in your drawing units.' },
      { tab: 'draw', sel: '#imgGo', text: 'Click Trace into drawing. Double-click a traced shape to select it, then use Set width or Set height to fix its exact size.' },
    ],
  },
  {
    id: 'cut-start', title: 'Choose where the cut starts', keys: 'start point begin end direction reverse bobcad shift right click tail ends first point',
    text: 'Use the Cut start tool (key S). Click the outline where the wire should start. A closed shape ends at the same point. If the wire runs the wrong way, tick "Cut in the opposite direction" on the Machine tab.',
    tour: [
      { tab: 'draw', tool: 'start', sel: '[data-tool=start]', text: 'Click Cut start, then click on the outline. A green diamond shows the start.' },
      { tab: 'machine', sel: '#startInfo', text: 'The Machine tab confirms the start. Clear cut start goes back to the drawing\'s first point.' },
      { tab: 'machine', sel: '#reverse', text: 'Wrong direction? Tick this.' },
    ],
  },
  {
    id: 'wrong-size', title: 'The size came out wrong', keys: 'size scale wrong units mm inches too big too small fit width freecad librecad',
    text: 'DXF files from FreeCAD are usually millimeters. Cloud\'s CAD reads the unit from the file. If it is wrong, change Units in the Draw tab, or type the real width into "Fit to width" on the Machine tab.',
    tour: [
      { tab: 'draw', sel: '#docUnits', text: 'Units: pick the unit the file was drawn in. The question asks whether to resize or just relabel. Choose Cancel to relabel (numbers stay), OK to resize.' },
      { tab: 'machine', sel: '#fitWidth', text: 'Or skip all that: type the real width in inches here and it scales to match.' },
    ],
  },
  {
    id: 'open-gaps', title: 'Red circles / "open outline" / won\'t make G-code', keys: 'open gap red circle not closed error multiple paths separate shapes close outline refuse',
    text: 'Red circles mark loose ends where lines do not quite meet. Zoom in and drag a grip (square handle) onto the neighbor, or draw a short line to close it. Small gaps under 0.01 in are closed for you. Several separate shapes are refused by default because your machine has no rapid move: the wire would cut a straight line between them. Join them into one path or tick "Allow several separate paths" in Advanced.',
    tour: [
      { tab: 'draw', sel: '#report', text: 'This line tells you how many closed outlines and open pieces there are.' },
      { tab: 'draw', sel: '#showOpen', text: 'Keep this on to see the loose ends as red circles.' },
      { tab: 'machine', sel: '#messages', text: 'The Machine tab explains in plain words what is wrong and where.' },
    ],
  },
  {
    id: 'curves', title: 'Draw smooth curves', keys: 'curve spline smooth bezier freehand points trace',
    text: 'Curve tool (key U): click points along the shape. It passes exactly through every point you click. Enter, double-click or right-click finishes; clicking the first point closes it. For the machine file the curve becomes short straight moves within 0.002 in of the curve.',
    tour: [{ tab: 'draw', tool: 'curve', sel: '[data-tool=curve]', text: 'Choose Curve and click points one at a time. Backspace removes the last point.' }],
  },
  {
    id: 'parallel', title: 'Make a parallel copy (offset)', keys: 'offset parallel copy distance line arc circle kerf',
    text: 'Parallel tool (key P): set the distance in the right panel, click the line, arc or circle, then click the side the copy should go to.',
    tour: [
      { tab: 'draw', tool: 'offset', sel: '[data-tool=offset]', text: 'Choose Parallel.' },
      { tab: 'draw', sel: '#offsetD', text: 'Type the distance here.' },
      { tab: 'draw', sel: '#cv', text: 'Click the line, then click on the side where the copy should appear.' },
    ],
  },
  {
    id: 'modify-tools', title: 'Scale, stretch, extend, break, explode, join', keys: 'scale resize bigger smaller factor stretch extend lengthen break cut split explode join weld gap close merge modify',
    text: 'All in the Modify group on the left. Scale (K): select, click a fixed point, type a factor like 1.5. Stretch (G): box the end points to pull, then base and target points. Extend (E): click near a line end to grow it to the next object. Break (B): click a line or arc to cut it in two. After a break, click a piece and drag it: only that line moves, the other piece stays. Drag its end point to move just that end (hold Ctrl to move every line joined at that point). Explode: turns a circle into two arcs and a curve into plain lines. Join: closes tiny gaps and merges straight pieces.',
    tour: [
      { tab: 'draw', sel: '#tools', text: 'The Modify group has Move, Copy, Rotate, Scale, Mirror, Stretch, Trim, Extend, Break, Explode, Join, Parallel, Fillet and Chamfer.' },
      { tab: 'draw', sel: '[data-tool=scale]', text: 'Scale: select first, click the fixed point, then type a factor (2 = twice as big) and press Enter.' },
      { tab: 'draw', sel: '#joinBtn', text: 'Join closes tiny gaps and merges straight pieces, so a shape shows as one closed outline.' },
    ],
  },
  {
    id: 'more-shapes', title: 'More lines, circles, arcs, polygons, ellipses', keys: 'horizontal vertical perpendicular right angle tangent bisector divide polygon star ellipse circle three points diameter arc freehand pencil delete point node tilted rectangle inscribed',
    text: 'Open the "More ..." sections in the Lines and Shapes groups on the left. Freehand (W): hold the button and draw, it becomes a smooth curve. Horizontal and Vertical keep lines level. Right angle to, Parallel through point, Bisector and Tangent build lines from other objects. Divide cuts a line, arc or circle into equal parts. Circles can be made by center + radius, 2 points, 3 points, 2 points + radius, or inside 3 lines. Arcs: center + angles, or continue a line. Polygons, stars and ellipses ask for their numbers (sides, points) under Tool options. Delete point (X) removes a corner between two lines. Each tool tells you what to click next in the bar at the bottom.',
    tour: [
      { tab: 'draw', sel: '#tools', text: 'Look for the small "More ..." headings under Lines and Shapes. Click one to open it.' },
      { tab: 'draw', sel: '[data-tool=freehand]', text: 'Freehand: hold the mouse button and draw. Let go and it becomes a smooth curve you can reshape.' },
      { tab: 'draw', sel: '#cv', text: 'The bar at the bottom always says what to click next.' },
    ],
  },
  {
    id: 'print3d', title: '3D printing: slice and talk to the printer', keys: '3d print printer slice slicer gcode filament nozzle bed usb serial marlin klipper moonraker octoprint temperature jog preheat layer support brim',
    text: 'Make or load a 3D model, then open the 3D Print tab. Pick your printer, material and quality, set the size, and press Slice. The desktop app has the real Cura slicing engine built in (Slicer engine box), so supports, bridges and good walls just work. You can also pick PrusaSlicer if you have it installed. Use the slider to look through the layers. To print, connect by USB (Marlin printers) or by network (Klipper/Moonraker or OctoPrint, desktop app only), then Preheat, Start or Upload. You can also just Save G-code and use an SD card. Watch the first layer and keep the E-stop in reach. Bambu Lab printers are not supported: save the model and use Bambu Studio.',
    tour: [
      { tab: 'print', sel: '#printSide', text: 'Choose printer, material and quality, then press Slice.' },
      { tab: 'print', sel: '#pvLayer', text: 'Slide through the layers to check walls, infill and supports.' },
      { tab: 'print', sel: '#cConnect', text: 'Connect to the printer here. Preheat and jog before starting, and watch the first layer.' },
    ],
  },
  {
    id: 'add-drawing', title: 'Put two drawings together (add a second file)', keys: 'add insert import merge combine two pieces halves molding join drawings second file',
    text: 'Open the first drawing with Open file. Then press Add drawing and pick the second file (DXF, project or machine file). It lands in the same drawing, already selected, and is converted if one file is in inches and the other in mm. If both halves were drawn from the same corner they will line up on their own. If not, use Move, Rotate or Mirror (with snap on) to bring them together, then Join to close the gaps. Undo removes the added drawing. You can pick several files at once.',
    tour: [
      { tab: 'draw', sel: '#addBtn', text: 'Add drawing brings another file into this one instead of replacing it.' },
      { tab: 'draw', sel: '#tools', text: 'The new pieces are selected. Use Move, Rotate or Mirror to line them up, then Join.' },
    ],
  },
  {
    id: 'library', title: 'Profile library: save, search, match', keys: 'library save profile customer search tags find match same similar old job previous reuse',
    text: 'Open the Library tab. Save a profile with a name, customer, tags and notes (it saves your selection, or the whole drawing if nothing is selected). Search by any of those words. Insert adds it to the drawing you have open; Open replaces the drawing (Undo brings yours back). "Find the closest profiles" compares your drawing to everything saved, ignoring size, and even if it is turned or flipped, and shows a percent match with both sizes so you can spot a re-order of an old job. Export library makes a backup file you can move to another computer.',
    tour: [
      { tab: 'library', sel: '#libSide', text: 'Name it, add the customer and tags, and press Save to library.' },
      { tab: 'library', sel: '#lbMatch', text: 'Open a customer file, come here and press this to see if you have cut it before.' },
      { tab: 'library', sel: '#lbExport', text: 'Export makes a backup file. Do this now and then.' },
    ],
  },
  {
    id: 'cleanup', title: 'Clean up a messy customer file', keys: 'clean cleanup duplicate overlap speck tiny gap messy units wrong size mirror join half smooth traced curve history autosave undo recover',
    text: 'Copies > Clean up > "Clean up the file" removes duplicate and overlapping lines, tiny loose specks and zero-length lines, and closes small gaps, then tells you how many closed outlines you have and where loose ends remain. When you open a file whose size looks wrong for its units (like 100 "inches"), it asks if it is really millimeters. To make a full profile from half: select the half, open Modify > "Mirror + join, smooth", pick which edge to mirror across and press Mirror and join. "Smooth traced lines" turns jagged traced lines into smooth curves and keeps sharp corners. Undo goes back 5000 steps and opening a file does not erase it. The History button brings back earlier versions kept automatically, even after you close the app.',
    tour: [
      { tab: 'draw', sel: '#cleanBtn', text: 'Clean up the file: duplicates, overlaps, specks and small gaps.' },
      { tab: 'draw', sel: '#histBtn', text: 'History: go back to an earlier version of your drawing.' },
    ],
  },
  {
    id: 'measure', title: 'Measure a distance or show sizes', keys: 'measure distance dimension size length width height label fraction',
    text: 'Measure tool (key D): click two points to see distance, angle and across/up. "Show overall size" in the right panel labels the width and height of the selection (or everything). Inch sizes also show as fractions like 1-1/16".',
    tour: [
      { tab: 'draw', tool: 'measure', sel: '[data-tool=measure]', text: 'Choose Measure and click two points. The answer shows at the bottom and on the drawing.' },
      { tab: 'draw', sel: '#showDims', text: 'Tick this to show the overall width and height.' },
    ],
  },
  {
    id: 'four-piece', title: 'Several pieces / mirrored and repeated layouts', keys: 'copy mirror array repeat pieces nest layout four 4 piece row pattern flip',
    text: 'Draw one piece, select it, then use Copy (move by a typed offset), Mirror (click two points for the mirror line), or the "Row of copies" and "Copies around a point" panels on the right. Join the pieces into one path with lines if the machine must cut them in one pass.',
    tour: [
      { tab: 'draw', tool: 'select', sel: '[data-tool=select]', text: 'Select the piece: click it, or drag a box around it. Double-click selects a whole outline.' },
      { tab: 'draw', sel: '[data-tool=mirror]', text: 'Mirror: click two points to define the mirror line. Keep the original with the box on the right.' },
      { tab: 'draw', sel: '#laGo', open: true, text: 'Or make a row of copies: choose how many and how far apart.' },
    ],
  },
  {
    id: 'extrude', title: 'Make a 3D shape from my drawing', keys: '3d extrude thickness solid stl print model depth',
    text: 'Needs a closed outline. 3D tab, set the thickness, click Extrude. Export STL for 3D printing.',
    tour: [
      { tab: 'd3', sel: '#exDepth', text: 'Type how thick the part is.' },
      { tab: 'd3', sel: '#exGo', text: 'Click Extrude closed outlines.' },
      { tab: 'd3', sel: '#exportSTL', text: 'Export STL gives you a file for slicers and 3D printers.' },
    ],
  },
  {
    id: 'model-to-profile', title: 'Get a 2D profile from a 3D model', keys: 'model stl obj glb ply modly import profile silhouette slice section front side top',
    text: 'Open the model (STL, OBJ, GLB or PLY), fix the up direction and size, then take a front, side or top outline, or slice it at a height.',
    tour: [
      { tab: 'd3', sel: '#openModel', text: 'Choose your model file.' },
      { tab: 'd3', sel: '#upAxis', text: 'If it lies on its side, change which way is up and set the real size, then click Apply.' },
      { tab: 'd3', sel: '[data-sil=front]', text: 'Front, Side and Top turn the model\'s outline into a drawing. Or use the slice height below.' },
    ],
  },
  {
    id: 'carve', title: 'Make 3D from pictures / views', keys: 'carve views photos silhouettes front side top multiple pictures generate 3d',
    text: 'Give one to three outlines (your drawing, a picture, or the model). The result is the shape that fits all of them. With one view it is just the outline pushed through; two or three views give a real 3D shape.',
    tour: [
      { tab: 'd3', sel: '#slots', text: 'Choose a source for each view you have.' },
      { tab: 'd3', sel: '#cvW', text: 'Type the real width, depth and height.' },
      { tab: 'd3', sel: '#cvGo', text: 'Click Carve.' },
    ],
  },
  {
    id: 'g00', title: 'What about G00, speed, temperature?', keys: 'g00 rapid speed feed temperature heat m90 g74 m11 m21 m02 header footer controller',
    text: 'The file only contains the cut path in your machine\'s own dialect: your start lines, relative G01/G02/G03 moves, and your end lines. There is no G00, no speed and no temperature: the machine controls those. The start and end lines can be edited under Advanced on the Machine tab if another machine needs different ones.',
    tour: [{ tab: 'machine', sel: '#code', text: 'This is exactly what the machine receives.' }],
  },
  {
    id: 'save', title: 'Save and reopen my work', keys: 'save open project file autosave restore lost undo redo dxf export',
    text: 'Your drawing is saved in this browser automatically. Save project makes a .cloudcad file you can keep. "Save drawing as DXF" is on the Machine tab. Ctrl+Z undoes, Ctrl+Y redoes.',
    tour: [
      { tab: 'draw', sel: '#saveProj', text: 'Save project makes a file. Open file brings it back.' },
      { tab: 'machine', sel: '#dlDxf', text: 'Save drawing as DXF gives a DXF for other programs.' },
    ],
  },
  {
    id: 'sheet', title: 'Print a drawing sheet with sizes', keys: 'print drawing sheet paper pdf dimensions shop drawing customer size scale title block',
    text: 'Machine tab, "Print drawing sheet": a US Letter landscape page with the outline, overall width and height (with fractions like 1-1/16"), a tidy scale, the cut start marker and a title block. In the print window choose "Save as PDF" to make a PDF. "Download sheet (SVG)" saves it as a file.',
    tour: [{ tab: 'machine', sel: '#printSheet', text: 'Click Print drawing sheet. Choose your printer, or Save as PDF.' }],
  },
  {
    id: 'reshape', title: 'Reshape a curve after drawing it', keys: 'reshape edit curve handle point drag move add remove smooth adjust',
    text: 'Select the curve (click it). Round handles appear on its points. Drag a handle to reshape it. Ctrl+click on the curve adds a point. Alt+click a handle removes one. Traced outlines come in as curves too, so you can clean them up the same way.',
    tour: [{ tab: 'draw', tool: 'select', sel: '[data-tool=select]', text: 'With Select, click a curve, then drag the round handles. Ctrl+click on the curve adds a handle; Alt+click a handle removes it.' }],
  },
  {
    id: 'move-around', title: 'Move, zoom and shortcuts', keys: 'pan zoom scroll right drag keys shortcuts hotkeys mouse navigate',
    text: 'Right-drag moves around. The wheel zooms. Space + left-drag also pans. V select, L line, R rect, C circle, A arc, U curve, T trim, F fillet, H chamfer, M move, Y copy, O rotate, I mirror, P parallel, D measure, S cut start. Shift keeps lines straight.',
    tour: [],
  },
];

const norm = (s) => String(s).toLowerCase();
export function searchTopics(q) {
  const words = norm(q).split(/[^a-z0-9<.-]+/).filter(Boolean);
  if (!words.length) return TOPICS.slice();
  const scored = TOPICS.map((t) => {
    const title = norm(t.title), keys = norm(t.keys), text = norm(t.text);
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 5;
      if (keys.split(' ').some((k) => k === w)) score += 4;
      else if (keys.includes(w)) score += 2;
      if (text.includes(w)) score += 1;
    }
    return { t, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.t);
}

// ---------------- UI ----------------
export function initHelp(api) {
  const $ = (id) => document.getElementById(id);
  const dlg = $('help'), list = $('helpList'), art = $('helpArticle'), search = $('helpSearch');
  const tour = { topic: null, i: 0 };
  const openDlg = (d) => { if (d.showModal) { try { d.showModal(); return; } catch (e) { /* fall through */ } } d.setAttribute('open', ''); };
  const closeDlg = (d) => { if (d.close) { try { d.close(); return; } catch (e) { /* fall through */ } } d.removeAttribute('open'); };

  function renderList(q = '') {
    const found = searchTopics(q);
    list.innerHTML = found.length ? found.map((t) => `<button class="topic" data-id="${t.id}">${t.title}</button>`).join('') : '<p class="hint">Nothing matched. Try words like "size", "start", "trace", "gaps" or "3D".</p>';
    list.querySelectorAll('.topic').forEach((b) => b.addEventListener('click', () => showTopic(b.dataset.id)));
  }
  function showTopic(id) {
    const t = TOPICS.find((x) => x.id === id);
    if (!t) return;
    art.hidden = false;
    art.innerHTML = `<h3>${t.title}</h3><p>${t.text}</p>${t.tour && t.tour.length ? `<button class="primary" id="walk">Walk me through it</button>` : ''}`;
    const w = $('walk');
    if (w) w.addEventListener('click', () => { closeDlg(dlg); startTour(id); });
  }
  function clearHl() { document.querySelectorAll('.tour-hl').forEach((n) => n.classList.remove('tour-hl')); }
  function endTour() { clearHl(); $('tour').hidden = true; tour.topic = null; }
  function showStep() {
    const t = TOPICS.find((x) => x.id === tour.topic);
    const s = t.tour[tour.i];
    clearHl();
    if (s.tab) api.setTab(s.tab);
    if (s.tool) api.setTool(s.tool);
    const target = s.sel ? document.querySelector(s.sel) : null;
    if (target) {
      let p = target.parentElement;
      while (p) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
      target.classList.add('tour-hl');
      if (target.scrollIntoView) try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }
    $('tourTitle').textContent = `${t.title}  (${tour.i + 1} of ${t.tour.length})`;
    $('tourText').textContent = s.text;
    $('tourBack').disabled = tour.i === 0;
    $('tourNext').textContent = tour.i === t.tour.length - 1 ? 'Done' : 'Next';
    $('tour').hidden = false;
  }
  function startTour(id) {
    const t = TOPICS.find((x) => x.id === id);
    if (!t || !t.tour.length) return;
    tour.topic = id; tour.i = 0;
    showStep();
  }
  $('tourNext').addEventListener('click', () => {
    const t = TOPICS.find((x) => x.id === tour.topic);
    if (!t) return;
    if (tour.i >= t.tour.length - 1) endTour(); else { tour.i++; showStep(); }
  });
  $('tourBack').addEventListener('click', () => { if (tour.i > 0) { tour.i--; showStep(); } });
  $('tourClose').addEventListener('click', endTour);
  search.addEventListener('input', () => { renderList(search.value); art.hidden = true; });
  $('helpBtn').addEventListener('click', () => { search.value = ''; renderList(''); art.hidden = true; openDlg(dlg); setTimeout(() => search.focus && search.focus(), 30); });
  $('helpClose').addEventListener('click', () => closeDlg(dlg));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); $('helpBtn').click(); }
    if (e.key === 'Escape' && tour.topic) endTour();
  });

  // welcome screen
  const wel = $('welcome');
  const welcomeGo = {
    dxf: () => { closeDlg(wel); startTour('dxf-to-tap'); },
    draw: () => { closeDlg(wel); startTour('draw-profile'); },
    pic: () => { closeDlg(wel); startTour('trace-by-hand'); },
    model: () => { closeDlg(wel); startTour('model-to-profile'); },
  };
  wel.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => welcomeGo[b.dataset.go]()));
  $('welcomeSkip').addEventListener('click', () => closeDlg(wel));
  wel.addEventListener('close', () => { try { localStorage.setItem('cloudcad-welcomed', '1'); } catch (e) { /* ignore */ } });
  $('welcomeSkip').addEventListener('click', () => { try { localStorage.setItem('cloudcad-welcomed', '1'); } catch (e) { /* ignore */ } });
  renderList('');
  return {
    showWelcome() { openDlg(wel); },
    startTour, endTour, searchTopics, showTopic,
  };
}
