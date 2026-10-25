// Cloud's CAD - feature history: a base solid plus editable steps. Change a number and the model is rebuilt. License: GPL v3
import * as S from './solids-client.js';

export const BASES = {
  extrude: { label: 'Extrude', fields: [{ k: 'depth', label: 'Thickness', unit: 'u' }] },
  revolve: { label: 'Spin around the left edge', fields: [{ k: 'degrees', label: 'Degrees', unit: '°' }] },
  sweep: { label: 'Sweep along the open line', fields: [{ k: 'closed', label: '', hidden: true }] },
  loft: { label: 'Loft first outline to second', fields: [{ k: 'height', label: 'Height', unit: 'u' }] },
  model: { label: 'Opened model', fields: [] },
};
export const STEPS = {
  round: { label: 'Round edges', fields: [{ k: 'r', label: 'Radius', unit: 'u' }] },
  roundIn: { label: 'Round inside corners', fields: [{ k: 'r', label: 'Radius', unit: 'u' }] },
  chamfer: { label: 'Chamfer edges', fields: [{ k: 'd', label: 'Size', unit: 'u' }] },
  shell: { label: 'Hollow out', fields: [{ k: 't', label: 'Wall', unit: 'u' }] },
  cup: { label: 'Hollow, open top', fields: [{ k: 't', label: 'Wall', unit: 'u' }] },
  offset: { label: 'Grow (+) or shrink (-)', fields: [{ k: 'd', label: 'By', unit: 'u' }] },
  hole: { label: 'Hole from the top', fields: [{ k: 'x', label: 'Across', unit: 'u' }, { k: 'y', label: 'Back', unit: 'u' }, { k: 'dia', label: 'Width', unit: 'u' }, { k: 'depth', label: 'Depth (0 = through)', unit: 'u' }] },
};

// ctx: { loops, paths, baseModel } -> Float32Array. Throws Error with `.step` = index of the failing step (-1 = base).
export async function evaluate(recipe, ctx) {
  const b = recipe.base; let pos;
  const fail = (e, i) => { e.step = i; return e; };
  try {
    if (b.kind === 'extrude') {
      const { extrudeLoops } = await import('./mesh.js');
      pos = extrudeLoops(ctx.loops, b.depth);
      if (!pos.length) throw new Error('Thickness must be bigger than zero, and the drawing needs a closed outline.');
    } else if (b.kind === 'revolve') pos = await S.revolveLoops(ctx.loops, { degrees: b.degrees });
    else if (b.kind === 'sweep') {
      if (!ctx.paths.length) throw new Error('Draw one open line or curve for the path, plus a closed outline to sweep.');
      pos = await S.sweepLoops(ctx.loops, ctx.paths[0]);
    } else if (b.kind === 'loft') {
      if (ctx.loops.length < 2) throw new Error('A loft needs two closed outlines in the drawing: a bottom one and a top one.');
      const area = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      const two = ctx.loops.slice().sort((a, c) => area(c) - area(a));
      pos = await S.loftLoops(two[0], two[1], { height: b.height });
    } else if (b.kind === 'model') pos = ctx.baseModel;
    else throw new Error('Unknown base.');
  } catch (e) { throw fail(e, -1); }
  for (let i = 0; i < recipe.steps.length; i++) {
    const s = recipe.steps[i];
    try {
      if (s.kind === 'round') pos = await S.roundEdges(pos, s.r, 'outer');
      else if (s.kind === 'roundIn') pos = await S.roundEdges(pos, s.r, 'inner');
      else if (s.kind === 'chamfer') pos = await S.chamferEdges(pos, s.d, 'outer');
      else if (s.kind === 'shell') pos = await S.shellModel(pos, s.t);
      else if (s.kind === 'cup') pos = await S.shellModel(pos, s.t, { openTop: true });
      else if (s.kind === 'offset') pos = await S.offsetModel(pos, s.d);
      else if (s.kind === 'hole') pos = await S.addHole(pos, { x: s.x, y: s.y, dia: s.dia, depth: s.depth || 0 });
    } catch (e) { throw fail(e, i); }
  }
  return pos;
}
