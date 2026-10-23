import { buildSheet } from './sheet.js';
import * as S from './sketch.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const svg = buildSheet(S.rectangle([0, 0], [1.0625, 3.625]), { units: 'in', name: 'Crown profile A', startPt: [0, 0], date: new Date('2026-10-21') });
ok('sheet is an 11x8.5 in svg', /width="11in" height="8.5in"/.test(svg));
ok('sheet shows both overall sizes with fractions', svg.includes('1.0625 in (1-1/16&quot;)') || svg.includes('1-1/16'), '');
ok('sheet shows 3-5/8 height', svg.includes('3-5/8'));
ok('sheet has name, scale, date and start marker', svg.includes('Crown profile A') && /Scale [^<]*/.test(svg) && svg.includes('2026-10-21') && svg.includes('START'));
ok('empty drawing gives a friendly sheet', buildSheet([]).includes('Nothing drawn yet'));
const mm = buildSheet(S.rectangle([0, 0], [100, 40]), { units: 'mm' });
ok('mm drawing gets a sensible scale (not zero or NaN)', !/NaN/.test(mm) && /Scale [0-9.]+:[0-9.]+/.test(mm), (mm.match(/Scale [^<]*/) || [''])[0]);
// well-formed XML: no duplicate attributes on any element
const dupAttr = (svgText) => (svgText.match(/<[a-z]+ [^>]*>/g) || []).some((tag) => { const names = (tag.match(/\s([a-z-]+)=/g) || []).map((x) => x.trim()); return new Set(names).size !== names.length; });
ok('sheet has no duplicate attributes (valid SVG)', !dupAttr(svg) && !dupAttr(mm));
console.log(fail ? `${fail} FAILED` : 'ALL SHEET TESTS PASSED'); process.exit(fail ? 1 : 0);
