// Cloud's CAD - helpers for running an installed PrusaSlicer (or a program that takes the same command line, such as SuperSlicer)
// and reading back its G-code so the Print tab can preview it and send it to a printer. License: GPL v3

// Binary STL bytes from a triangle list [x,y,z, x,y,z, ...] (already placed on the bed, in mm).
export function buildStl(pos) {
  const n = Math.floor(pos.length / 9), buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const head = 'Cloud\'s CAD'; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50, p = t * 9;
    const ux = pos[p + 3] - pos[p], uy = pos[p + 4] - pos[p + 1], uz = pos[p + 5] - pos[p + 2], vx = pos[p + 6] - pos[p], vy = pos[p + 7] - pos[p + 1], vz = pos[p + 8] - pos[p + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[p + k], true);
  }
  return new Uint8Array(buf);
}

const num = (v, d) => (Number.isFinite(+v) ? +v : d);

import { mergeSettings } from './slicer.js';

// A PrusaSlicer config file made from our settings (the same settings the built-in slicer uses).
export function buildPrusaIni(s0, extra = {}) {
  const s = mergeSettings(s0);
  const sp = s.speed || {}, bx = num(s.bed.x, 220), by = num(s.bed.y, 220);
  const bed = s.originCenter ? `${-bx / 2}x${-by / 2},${bx / 2}x${-by / 2},${bx / 2}x${by / 2},${-bx / 2}x${by / 2}` : `0x0,${bx}x0,${bx}x${by},0x${by}`;
  const lines = Math.max(0, Math.round((s.skirtLoops ?? 2)));
  const q = (t, h) => Math.max(0, Math.ceil((t - 1e-6) / h));
  const lh = s.layerHeight, ps = {
    bed_shape: bed, max_print_height: s.bed.z, nozzle_diameter: s.nozzleDia || 0.4, filament_diameter: s.filamentDia, extrusion_multiplier: s.flow, filament_density: s.density,
    gcode_flavor: 'marlin2', use_relative_e_distances: s.relativeE ? 1 : 0, use_firmware_retraction: 0,
    layer_height: lh, first_layer_height: s.firstLayerHeight, perimeters: s.walls, top_solid_layers: q(s.topThickness, lh), bottom_solid_layers: q(s.bottomThickness, lh),
    fill_density: `${Math.round(s.infillDensity * 100)}%`, fill_pattern: ({ grid: 'grid', triangles: 'triangles', cubic: 'cubic', gyroid: 'gyroid' })[s.infillPattern] || 'rectilinear',
    extrusion_width: s.lineWidth, perimeter_extrusion_width: s.lineWidth, external_perimeter_extrusion_width: s.lineWidth, infill_extrusion_width: s.lineWidth, solid_infill_extrusion_width: s.lineWidth, top_infill_extrusion_width: s.lineWidth,
    first_layer_extrusion_width: s.lineWidth,
    perimeter_speed: sp.wall, external_perimeter_speed: sp.outerWall, small_perimeter_speed: sp.outerWall, infill_speed: sp.infill, solid_infill_speed: sp.solid, top_solid_infill_speed: sp.solid,
    support_material_speed: sp.support, travel_speed: sp.travel, first_layer_speed: sp.firstLayer, bridge_speed: sp.wall, gap_fill_speed: sp.wall,
    retract_length: s.retractDist, retract_speed: s.retractSpeed, deretract_speed: s.retractSpeed, retract_lift: s.zHop || 0, retract_before_travel: s.minRetractTravel,
    temperature: s.nozzleTemp, first_layer_temperature: s.firstLayerNozzleTemp, bed_temperature: s.bedTemp, first_layer_bed_temperature: s.bedTemp,
    fan_always_on: 1, min_fan_speed: s.fan, max_fan_speed: s.fan, bridge_fan_speed: 100, disable_fan_first_layers: Math.max(0, (s.fanStartLayer ?? 2) - 1), cooling: 1, slowdown_below_layer_time: s.minLayerTime, fan_below_layer_time: s.minLayerTime,
    support_material: s.support ? 1 : 0, support_material_auto: 1, support_material_threshold: Math.round(90 - (s.supportAngle ?? 50)), support_material_contact_distance: s.supportGap ?? 0.2,
    brim_width: s.adhesion === 'brim' ? s.brimWidth : 0, skirts: s.adhesion === 'none' ? 0 : s.adhesion === 'brim' ? 0 : lines, skirt_distance: s.skirtDistance ?? 3, skirt_height: 1,
    complete_objects: 0, gcode_comments: 0, wipe: 0,
    start_gcode: s.startGcode || `M104 S[first_layer_temperature]\\nM140 S[first_layer_bed_temperature]\\nG28\\nM190 S[first_layer_bed_temperature]\\nM109 S[first_layer_temperature]\\nG92 E0`,
    end_gcode: s.endGcode || `M104 S0\\nM140 S0\\nM107\\nG91\\nG1 Z10 F600\\nG90\\nG1 X0 Y${by} F3000\\nM84`,
    ...extra,
  };
  return Object.entries(ps).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v))).map(([k, v]) => `${k} = ${String(v)}`).join('\n') + '\n';
}

const TYPE = { 'wall-outer': 'outer', 'wall-inner': 'wall', skin: 'solid', fill: 'infill', 'support-interface': 'support', support: 'support', 'external perimeter': 'outer', 'overhang perimeter': 'outer', perimeter: 'wall', 'internal infill': 'infill', 'solid infill': 'solid', 'top solid infill': 'solid', 'bridge infill': 'solid',
  'gap fill': 'solid', 'support material': 'support', 'support material interface': 'support', skirt: 'skirt', 'skirt/brim': 'skirt', brim: 'skirt', custom: 'skirt' };

// Reads G-code (any slicer that writes G0/G1 with X Y Z E) into layers for the preview, plus rough stats.
export function parseGcode(text, { filamentDia = 1.75, density = 1.24 } = {}) {
  const layers = []; let cur = null, x = 0, y = 0, z = 0, e = 0, f = 1500, absXYZ = true, absE = true, type = 'wall';
  let ext = 0, secs = 0, travel = 0, seg = null, minz = Infinity, last = null;
  const flush = () => { if (seg && seg.p.length >= 4 && cur) cur.paths.push(seg); seg = null; };
  const area = Math.PI * (filamentDia / 2) ** 2;
  for (const raw of String(text).split(/\r?\n/)) {
    const semi = raw.indexOf(';');
    const code = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
    if (semi >= 0) {
      const m = /^;\s*(?:TYPE|FEATURE):\s*(.+)$/i.exec(raw.trim());
      if (m) { flush(); const k = m[1].trim().toLowerCase(); type = TYPE[k] || (k.includes('support') ? 'support' : k.includes('infill') ? (k.includes('solid') ? 'solid' : 'infill') : k.includes('perimeter') ? (k.includes('external') || k.includes('outer') ? 'outer' : 'wall') : 'wall'); }
    }
    if (!code) continue;
    const w = code.split(/\s+/), c = w[0].toUpperCase();
    if (c === 'G90') { absXYZ = true; absE = true; continue; }
    if (c === 'G91') { absXYZ = false; absE = false; continue; }
    if (c === 'M82') { absE = true; continue; }
    if (c === 'M83') { absE = false; continue; }
    if (c === 'G92') { for (const t of w.slice(1)) if (t[0].toUpperCase() === 'E') e = num(t.slice(1), 0); continue; }
    if (c !== 'G0' && c !== 'G1' && c !== 'G00' && c !== 'G01' && c !== 'G2' && c !== 'G3') continue;
    let nx = x, ny = y, nz = z, de = 0;
    for (const t of w.slice(1)) {
      const v = num(t.slice(1), NaN); if (Number.isNaN(v)) continue;
      switch (t[0].toUpperCase()) {
        case 'X': nx = absXYZ ? v : x + v; break;
        case 'Y': ny = absXYZ ? v : y + v; break;
        case 'Z': nz = absXYZ ? v : z + v; break;
        case 'E': de = absE ? v - e : v; e = absE ? v : e; break;
        case 'F': f = v; break;
        default:
      }
    }
    const d = Math.hypot(nx - x, ny - y, nz - z);
    if (d > 0 && f > 0) secs += d / (f / 60);
    const printing = de > 1e-6 && (nx !== x || ny !== y);
    if (printing) {
      if (!cur || z > cur.z + 1e-4) { flush(); cur = { z, paths: [] }; layers.push(cur); if (z < minz) minz = z; }
      if (!seg || seg.t !== type || last === null || Math.hypot(last[0] - x, last[1] - y) > 1e-4) { flush(); seg = { t: type, p: [x, y] }; }
      seg.p.push(nx, ny); ext += de; last = [nx, ny];
    } else { flush(); last = null; if (nx !== x || ny !== y) travel += Math.hypot(nx - x, ny - y); }
    x = nx; y = ny; z = nz;
  }
  flush();
  const mm = ext, vol = mm * area;
  const stats = { layers: layers.length, height: layers.length ? layers[layers.length - 1].z : 0, extruded: mm, filamentMeters: mm / 1000, grams: vol * density / 1000, seconds: secs, travelMm: travel };
  // Pull the slicer's own estimate if it wrote one
  const em = /estimated printing time[^=]*=\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i.exec(text);
  if (em) { const t = (+em[1] || 0) * 86400 + (+em[2] || 0) * 3600 + (+em[3] || 0) * 60 + (+em[4] || 0); if (t) stats.seconds = t; }
  return { gcode: text, layers, stats, warnings: layers.length ? [] : ['The slicer wrote no printing moves. Check the model and settings.'] };
}

// Settings for the built-in CuraEngine (key/value pairs, global scope). `s` is our usual settings object.
export function buildCuraSettings(s0, extra = {}) {
  const s = mergeSettings(s0), sp = s.speed, lh = s.layerHeight;
  const startG = s.startGcode || 'G28 ;home\nG92 E0\nG1 Z2 F3000\nG1 X10 Y20 Z0.3 F5000\nG1 X10 Y' + Math.max(40, s.bed.y - 20) + ' Z0.3 F1500 E15 ;prime line\nG92 E0';
  const endG = s.endGcode || 'M104 S0\nM140 S0\nG91\nG1 E-2 F2700\nG1 Z10 F600\nG90\nG1 X0 Y' + s.bed.y + ' F3000\nM84';
  const o = {
    machine_width: s.bed.x, machine_depth: s.bed.y, machine_height: s.bed.z, machine_center_is_zero: false, machine_heated_bed: s.bedTemp > 0,
    machine_gcode_flavor: 'RepRap (Marlin/Sprinter)', machine_nozzle_size: s.nozzleDia || 0.4, material_diameter: s.filamentDia,
    layer_height: lh, layer_height_0: s.firstLayerHeight, line_width: s.lineWidth, wall_line_count: s.walls,
    top_thickness: s.topThickness, bottom_thickness: s.bottomThickness,
    infill_sparse_density: Math.round(s.infillDensity * 100), infill_pattern: ({ grid: 'grid', triangles: 'triangles', cubic: 'cubic', gyroid: 'gyroid' })[s.infillPattern] || 'lines',
    speed_print: sp.infill, speed_wall_0: sp.outerWall, speed_wall_x: sp.wall, speed_infill: sp.infill, speed_topbottom: sp.solid, speed_travel: sp.travel, speed_layer_0: sp.firstLayer, speed_support: sp.support,
    retraction_enable: s.retractDist > 0, retraction_amount: s.retractDist, retraction_speed: s.retractSpeed, retraction_hop_enabled: (s.zHop || 0) > 0, retraction_hop: s.zHop || 0.2,
    material_print_temperature: s.nozzleTemp, material_print_temperature_layer_0: s.firstLayerNozzleTemp, material_bed_temperature: s.bedTemp, material_bed_temperature_layer_0: s.bedTemp,
    material_flow: Math.round(s.flow * 100), cool_fan_enabled: s.fan > 0, cool_fan_speed: s.fan, cool_fan_full_layer: Math.max(1, s.fanStartLayer ?? 2), cool_min_layer_time: s.minLayerTime,
    support_enable: !!s.support, support_angle: s.supportAngle, support_infill_rate: Math.round((s.supportDensity ?? 0.15) * 100), support_z_distance: s.supportGap,
    adhesion_type: s.adhesion === 'brim' ? 'brim' : s.adhesion === 'none' ? 'none' : 'skirt', brim_width: s.brimWidth, skirt_line_count: s.skirtLoops, skirt_gap: s.skirtDistance,
    relative_extrusion: !!s.relativeE, machine_start_gcode: startG, machine_end_gcode: endG,
    ...extra,
  };
  return Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : String(value) }));
}
// Moves a bed-placed triangle list so Cura's own centring puts it back where it was.
export function centerForCura(pos, s) {
  const out = new Float32Array(pos), dx = s.originCenter ? 0 : s.bed.x / 2, dy = s.originCenter ? 0 : s.bed.y / 2;
  for (let i = 0; i < out.length; i += 3) { out[i] -= dx; out[i + 1] -= dy; }
  return out;
}
