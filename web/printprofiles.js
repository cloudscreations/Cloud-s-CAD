// Cloud's CAD - starting points for printers, materials and quality. Everything can be edited on screen. License: GPL v3
export const PRINTERS = {
  generic: { name: 'Generic Marlin printer', bed: { x: 220, y: 220, z: 250 }, retractDist: 1.0, retractSpeed: 35, relativeE: false },
  ender3: { name: 'Creality Ender-3 / V2 / Pro (Bowden)', bed: { x: 220, y: 220, z: 250 }, retractDist: 5.0, retractSpeed: 40, relativeE: false },
  ender3s1: { name: 'Creality Ender-3 S1 / V3 (direct drive)', bed: { x: 220, y: 220, z: 270 }, retractDist: 0.8, retractSpeed: 35, relativeE: false },
  cr10: { name: 'Creality CR-10 (Bowden)', bed: { x: 300, y: 300, z: 400 }, retractDist: 5.0, retractSpeed: 40, relativeE: false },
  neptune: { name: 'Elegoo Neptune 3 / 4', bed: { x: 225, y: 225, z: 265 }, retractDist: 0.8, retractSpeed: 35, relativeE: false },
  kobra: { name: 'Anycubic Kobra / Kobra 2', bed: { x: 220, y: 220, z: 250 }, retractDist: 0.8, retractSpeed: 35, relativeE: false },
  prusa: { name: 'Prusa i3 MK3 / MK4', bed: { x: 250, y: 210, z: 210 }, retractDist: 0.8, retractSpeed: 35, relativeE: true },
  klipper250: { name: 'Klipper printer, 250 mm bed', bed: { x: 250, y: 250, z: 250 }, retractDist: 0.5, retractSpeed: 40, relativeE: true },
  klipper300: { name: 'Klipper printer, 300 mm bed', bed: { x: 300, y: 300, z: 300 }, retractDist: 0.5, retractSpeed: 40, relativeE: true },
  small: { name: 'Small printer, 180 mm bed', bed: { x: 180, y: 180, z: 180 }, retractDist: 1.0, retractSpeed: 35, relativeE: false },
};
export const MATERIALS = {
  pla: { name: 'PLA', nozzleTemp: 205, firstLayerNozzleTemp: 210, bedTemp: 60, fan: 100, speedScale: 1, retractScale: 1, density: 1.24, note: 'Easiest. Prints cool, no enclosure needed.' },
  petg: { name: 'PETG', nozzleTemp: 235, firstLayerNozzleTemp: 240, bedTemp: 80, fan: 50, speedScale: 0.85, retractScale: 1, density: 1.27, note: 'Stringy. Slower, less fan, glue stick on glass helps.' },
  abs: { name: 'ABS / ASA', nozzleTemp: 245, firstLayerNozzleTemp: 250, bedTemp: 100, fan: 0, speedScale: 0.9, retractScale: 1, density: 1.05, note: 'Needs a draft-free or enclosed printer. Fumes: ventilate.' },
  tpu: { name: 'TPU (flexible)', nozzleTemp: 225, firstLayerNozzleTemp: 230, bedTemp: 50, fan: 50, speedScale: 0.4, retractScale: 0.4, density: 1.2, note: 'Very slow. Direct drive extruder strongly recommended.' },
};
export const QUALITIES = {
  draft: { name: 'Draft (0.30 mm, fast)', layerHeight: 0.3, firstLayerHeight: 0.3, walls: 2, topThickness: 0.9, bottomThickness: 0.9, infillDensity: 0.15, lineWidth: 0.5 },
  standard: { name: 'Standard (0.20 mm)', layerHeight: 0.2, firstLayerHeight: 0.2, walls: 2, topThickness: 0.8, bottomThickness: 0.6, infillDensity: 0.2, lineWidth: 0.45 },
  fine: { name: 'Fine (0.12 mm, slow)', layerHeight: 0.12, firstLayerHeight: 0.2, walls: 3, topThickness: 0.84, bottomThickness: 0.72, infillDensity: 0.2, lineWidth: 0.42 },
  strong: { name: 'Strong (4 walls, 40% infill)', layerHeight: 0.2, firstLayerHeight: 0.2, walls: 4, topThickness: 1.0, bottomThickness: 1.0, infillDensity: 0.4, lineWidth: 0.45 },
};
export const BASE_SPEEDS = { firstLayer: 20, outerWall: 40, wall: 50, solid: 50, infill: 70, support: 60, travel: 150, zMove: 15 };
