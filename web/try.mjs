import fs from 'fs';
import { convert, parseTap } from './core.js';
const t = fs.readFileSync('../real_freecad.dxf','utf8');
const r = convert(t);
console.log('error:', r.error);
console.log('warnings:', r.warnings);
console.log('units detected:', r.detectedUnits, 'stats:', JSON.stringify(r.stats));
console.log('chains:', r.chains.length, 'gaps:', JSON.stringify(r.gaps));
if (r.tap) { const p = parseTap(r.tap); console.log('tap lines:', r.tap.split('\r\n').length, 'end rel start:', p.end); }
