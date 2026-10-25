import fs from 'fs'; import { JSDOM } from 'jsdom';
const dom = new JSDOM(fs.readFileSync('../clouds-cad.html','utf8'), { runScripts:'dangerously' });
await new Promise(r=>dom.window.addEventListener('load', r));
dom.window.__cloud.loadText('t.dxf', fs.readFileSync('../test_profile_mm.dxf','utf8'));
let svg = dom.window.document.querySelector('#preview svg').outerHTML.replace('<svg ', '<svg width="900" height="500" ').replace(/vector-effect="non-scaling-stroke"/g,'');
svg = svg.replace(/stroke-width="2.5"/g,'stroke-width="0.35"');
fs.writeFileSync('/tmp/clouds-cad/out/ui_preview.svg', svg);
