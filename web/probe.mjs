import DxfParser from 'dxf-parser';
import fs from 'fs';
const d = new DxfParser().parseSync(fs.readFileSync('../out/roundtrip.dxf','utf8'));
console.log(Object.keys(d), d.header && d.header['$INSUNITS']);
const types = {}; d.entities.forEach(e=>types[e.type]=(types[e.type]||0)+1); console.log(types);
console.log(JSON.stringify(d.entities.find(e=>e.type==='LINE')));
console.log(JSON.stringify(d.entities.find(e=>e.type==='ARC')));
