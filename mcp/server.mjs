// Cloud's CAD - MCP server. Lets a person's own Claude (Claude Desktop / Claude Code) use Cloud's CAD's engine.
// License: GPL v3. Runs locally; reads and writes only the files you name.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readDxf, chain, simplifySplines, convertSegments, parseTap, tapToDxf, flatten, bounds, DEFAULT_POST, TO_IN } from '../web/core.js';
import * as S from '../web/sketch.js';
import * as M from '../web/mesh.js';
import { applyStart } from '../web/startpoint.js';

const VERSION = '1.0.0';
const server = new McpServer({ name: 'clouds-cad', version: VERSION });

const text = (t, extra = {}) => ({ content: [{ type: 'text', text: t }], ...extra });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const r4 = (v) => Math.round(v * 10000) / 10000;
const abs = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'));

function readText(p) {
  const f = abs(p);
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  return { file: f, data: fs.readFileSync(f, 'utf8') };
}
// Never overwrite silently.
function writeOut(p, data, overwrite) {
  const f = abs(p);
  if (fs.existsSync(f) && !overwrite) throw new Error(`${f} already exists. Pick another name or set overwrite to true.`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return f;
}
const withExt = (inp, ext) => path.join(path.dirname(abs(inp)), path.basename(abs(inp), path.extname(inp)) + ext);

// ---------------------------------------------------------------- tools
server.registerTool('check_dxf', {
  title: 'Check a DXF file',
  description: 'Read a DXF and report its units, size, how many lines/arcs/splines it has, how many separate outlines it forms, and any gaps or problems that would stop G-code from being made. Use this first when the user asks about a DXF.',
  inputSchema: { dxf_path: z.string().describe('Full path to the .dxf file') },
}, async ({ dxf_path }) => {
  try {
    const { file, data } = readText(dxf_path);
    const r = readDxf(data);
    if (!r.segs.length) return fail('No usable geometry found (supported: lines, arcs, circles, polylines, splines).');
    const unit = r.units || null;
    const base = TO_IN[unit || 'in'];
    const chains = chain(r.segs, 0.002 / base);
    const b = bounds(chains);
    const open = chains.filter((c) => c.length < 2 || Math.hypot(c[0].a[0] - c[c.length - 1].b[0], c[0].a[1] - c[c.length - 1].b[1]) > 0.01 / base).length;
    const lines = [
      `File: ${file}`,
      `Units in file: ${unit || 'not saved in the file (assumed inches)'}`,
      `Size: ${r4(b.w * base)} x ${r4(b.h * base)} inches`,
      `Objects: ${r.segs.length} segments (${r.segs.filter((s) => s.t === 'A').length} arcs, ${r.splines} splines)`,
      `Outlines: ${chains.length} separate path(s), ${open} not closed`,
    ];
    if (chains.length > 1) lines.push('Several separate paths: the machine has no rapid move, so dxf_to_tap refuses this unless allow_multi is true.');
    for (const w of r.warnings) lines.push('Warning: ' + w);
    return text(lines.join('\n'));
  } catch (e) { return fail(e.message); }
});

server.registerTool('dxf_to_tap', {
  title: 'Turn a DXF into machine G-code (.tap)',
  description: 'Convert a DXF profile into a .tap file for the HotWire Direct pedestal hot-wire machine (relative G01/G02/G03 moves, shop header and footer, no G00, no speeds or temperatures). Sizes are in inches. If the DXF has several separate shapes it is refused unless allow_multi is true. Writes the file and returns a summary.',
  inputSchema: {
    dxf_path: z.string().describe('Full path to the .dxf file'),
    output_path: z.string().optional().describe('Where to write the .tap. Default: next to the DXF, same name.'),
    units: z.enum(['auto', 'in', 'mm', 'cm', 'ft', 'm']).optional().describe('Units the DXF was drawn in. Default auto (read from the file).'),
    fit_width_in: z.number().positive().optional().describe('Scale so the profile is exactly this wide, in inches'),
    fit_height_in: z.number().positive().optional().describe('Scale so the profile is exactly this tall, in inches'),
    rotate_deg: z.enum(['0', '90', '180', '270']).optional().describe('Rotate counter-clockwise'),
    reverse: z.boolean().optional().describe('Cut in the opposite direction'),
    mirror_x: z.boolean().optional().describe('Flip left to right'),
    mirror_y: z.boolean().optional().describe('Flip top to bottom'),
    start_x: z.number().optional().describe('Cut start point X, in the DXF\'s own units. Give both start_x and start_y.'),
    start_y: z.number().optional().describe('Cut start point Y, in the DXF\'s own units.'),
    allow_multi: z.boolean().optional().describe('Allow several separate paths in one file'),
    overwrite: z.boolean().optional().describe('Replace the output file if it exists'),
  },
}, async (a) => {
  try {
    const { file, data } = readText(a.dxf_path);
    const r = readDxf(data);
    const units = a.units && a.units !== 'auto' ? a.units : r.units || 'in';
    let segs = r.segs;
    if (a.start_x !== undefined && a.start_y !== undefined) segs = applyStart(segs, [a.start_x, a.start_y], (0.002 / TO_IN[units]) * 1.5);
    const res = convertSegments(segs, { units: r.units, warnings: r.warnings, splines: r.splines }, {
      unitsIn: a.units || 'auto', fitWidth: a.fit_width_in || 0, fitHeight: a.fit_height_in || 0, rotate: Number(a.rotate_deg || 0),
      reverse: !!a.reverse, mirrorX: !!a.mirror_x, mirrorY: !!a.mirror_y, allowMulti: !!a.allow_multi,
    });
    if (res.error || !res.tap) {
      const why = [res.error, ...(res.warnings || []), ...(res.notes || [])].filter(Boolean).join('\n');
      return fail('No G-code was made.\n' + why);
    }
    const out = writeOut(a.output_path || withExt(file, '.tap'), res.tap, a.overwrite);
    const s = res.stats;
    const lines = [
      `Wrote ${out}`,
      `Size: ${r4(s.width)} x ${r4(s.height)} in; ${s.paths} path, ${s.moves} moves (${s.arcs} arcs)`,
      `Units read as: ${s.unitsFrom}`,
      ...(res.warnings || []).map((w) => 'Warning: ' + w),
      ...(res.notes || []).map((n) => 'Note: ' + n),
      'Do a dry run on the machine before cutting foam. The file has no speed, temperature or rapid moves: the machine controls those.',
    ];
    return text(lines.join('\n'));
  } catch (e) { return fail(e.message); }
});

server.registerTool('tap_info', {
  title: 'Inspect a machine .tap file',
  description: 'Read a .tap file and report its size, number of moves and arcs, cut length, whether the path ends where it started, and the header/footer lines.',
  inputSchema: { tap_path: z.string().describe('Full path to the .tap file') },
}, async ({ tap_path }) => {
  try {
    const { file, data } = readText(tap_path);
    const p = parseTap(data);
    const pts = p.segs.flatMap((s) => flatten(s));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    let L = 0;
    for (const s of p.segs) { const f = flatten(s, 2); for (let i = 1; i < f.length; i++) L += Math.hypot(f[i][0] - f[i - 1][0], f[i][1] - f[i - 1][1]); }
    const lines = data.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    const closed = Math.hypot(p.end[0], p.end[1]) < 0.01;
    return text([
      `File: ${file}`,
      `Mode: ${p.relative ? 'relative (G91)' : 'absolute or not stated; preview assumes start 0,0'}`,
      `Moves: ${p.segs.length} (${p.segs.filter((s) => s.t === 'A').length} arcs)`,
      `Size: ${r4(Math.max(...xs) - Math.min(...xs))} x ${r4(Math.max(...ys) - Math.min(...ys))} (file units)`,
      `Cut length: ${r4(L)}`,
      `Ends ${closed ? 'back at the start (closed path)' : `${r4(p.end[0])}, ${r4(p.end[1])} away from the start (open path)`}`,
      `First lines: ${lines.slice(0, 5).join(' | ')}`,
      `Last lines: ${lines.slice(-3).join(' | ')}`,
    ].join('\n'));
  } catch (e) { return fail(e.message); }
});

server.registerTool('tap_to_dxf', {
  title: 'Turn a machine .tap back into a DXF',
  description: 'Rebuild a DXF (true lines and arcs) from a .tap file so it can be edited in a CAD program.',
  inputSchema: {
    tap_path: z.string().describe('Full path to the .tap file'),
    output_path: z.string().optional().describe('Where to write the DXF. Default: next to the .tap.'),
    overwrite: z.boolean().optional(),
  },
}, async ({ tap_path, output_path, overwrite }) => {
  try {
    const { file, data } = readText(tap_path);
    const p = parseTap(data);
    if (!p.segs.length) return fail('No moves found in that file.');
    const out = writeOut(output_path || withExt(file, '.dxf'), tapToDxf(p.segs, 'in'), overwrite);
    return text(`Wrote ${out} (${p.segs.length} entities, inches).`);
  } catch (e) { return fail(e.message); }
});

function loadModel(p) {
  const f = abs(p);
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  const ext = path.extname(f).toLowerCase();
  const buf = fs.readFileSync(f);
  let pos;
  if (ext === '.stl') pos = M.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  else if (ext === '.obj') pos = M.parseOBJ(buf.toString('utf8'));
  else throw new Error('Supported model files here: .stl and .obj (use the app for .glb/.ply).');
  if (!pos || !pos.length) throw new Error('No triangles found in that model.');
  return M.toOrigin(pos);
}
function applyModelOptions(pos, a) {
  let p = pos;
  if (a.up_axis && a.up_axis !== 'z') p = M.toOrigin(M.upToZ(p, a.up_axis));
  if (a.longest_side) { const cur = Math.max(...M.bboxOf(p).size); if (cur > 0) p = M.toOrigin(M.scalePositions(p, a.longest_side / cur)); }
  return p;
}
const modelOpts = {
  up_axis: z.enum(['x', 'y', 'z']).optional().describe('Which model axis points up (many 3D apps use y). Default z.'),
  longest_side: z.number().positive().optional().describe('Resize so the longest side is this many inches'),
};

server.registerTool('model_outline', {
  title: 'Get a 2D profile from a 3D model',
  description: 'Take the front, side or top outline (silhouette) of a 3D model (.stl or .obj) and save it as a DXF in inches.',
  inputSchema: {
    model_path: z.string().describe('Full path to the .stl or .obj'),
    view: z.enum(['front', 'side', 'top']),
    output_path: z.string().optional(), overwrite: z.boolean().optional(), ...modelOpts,
  },
}, async (a) => {
  try {
    const pos = applyModelOptions(loadModel(a.model_path), a);
    const sil = M.silhouette(pos, a.view, 1400);
    const loops = M.silhouetteLoops(sil);
    if (!loops.length) return fail('No outline found.');
    const ents = M.loopsToLineEnts(loops);
    const b = S.bbox(ents);
    const out = writeOut(a.output_path || withExt(a.model_path, `-${a.view}.dxf`), tapToDxf(S.toSegments(ents), 'in'), a.overwrite);
    return text(`Wrote ${out}: ${a.view} outline, ${r4(b.w)} x ${r4(b.h)} (inches if the model was sized in inches), ${loops.length} loop(s), ${ents.length} lines.`);
  } catch (e) { return fail(e.message); }
});

server.registerTool('model_slice', {
  title: 'Slice a 3D model into a 2D profile',
  description: 'Cut a 3D model (.stl or .obj) with a horizontal plane at a height and save the cross-section as a DXF.',
  inputSchema: {
    model_path: z.string(), height: z.number().min(0).describe('Height above the model bottom, same units as the model (after longest_side resize)'),
    output_path: z.string().optional(), overwrite: z.boolean().optional(), ...modelOpts,
  },
}, async (a) => {
  try {
    const pos = applyModelOptions(loadModel(a.model_path), a);
    const bb = M.bboxOf(pos);
    const loops = M.sectionLoops(pos, 2, bb.min[2] + a.height);
    if (!loops.length) return fail(`The slice at height ${a.height} is empty. The model is ${r4(bb.size[2])} tall.`);
    const ents = M.loopsToLineEnts(M.toLowerLeft(loops));
    const out = writeOut(a.output_path || withExt(a.model_path, `-slice.dxf`), tapToDxf(S.toSegments(ents), 'in'), a.overwrite);
    return text(`Wrote ${out}: cross-section at ${a.height}, ${loops.length} loop(s), ${ents.length} lines.`);
  } catch (e) { return fail(e.message); }
});

server.registerTool('machine_format_help', {
  title: 'Explain the machine file format',
  description: 'Explain what the .tap files for this hot-wire machine contain and what Cloud\'s CAD does and does not know about them. Use when the user asks about G-code, G00, speeds, header or footer lines.',
  inputSchema: {},
}, async () => text([
  'Machine file format (from the shop\'s own BobCAD-made file, reproduced byte for byte):',
  `Header: ${DEFAULT_POST.header.filter(Boolean).join(', ')}, then a blank line. Footer: ${DEFAULT_POST.footer.join(', ')}. CRLF line endings.`,
  'Moves are relative G01 (lines) and G02/G03 with I/J arc centers. There is no G00 rapid, no feed (F) and no wire temperature: the machine controls start position, speed and heat.',
  'Cloud\'s CAD does not know what M90, G74, M11 and M21 mean (no public documentation was found); it copies them verbatim. A dry run before cutting foam is recommended.',
].join('\n')));

const transport = new StdioServerTransport();
await server.connect(transport);
