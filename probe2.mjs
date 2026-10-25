import DxfParser from 'dxf-parser';
import fs from 'fs';
const d = new DxfParser().parseSync(fs.readFileSync('../test_profile_mm.dxf','utf8'));
console.log(d.header['$INSUNITS']);
console.log(JSON.stringify(d.entities.find(e=>e.type==='LWPOLYLINE')));
