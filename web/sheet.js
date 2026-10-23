// Cloud's CAD - printable drawing sheet (SVG). License: GPL v3
import { toSegments, bbox } from './sketch.js';
import { flatten, TO_IN } from './core.js';
import { fmtLen } from './fmtlen.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (v) => (+v).toFixed(3);

// Page is US Letter landscape, 11 x 8.5 in. Returns an SVG string.
export function buildSheet(ents, { units = 'in', name = 'drawing', startPt = null, date = new Date(), dims = [] } = {}) {
  const PW = 11, PH = 8.5, M = 0.5, TB = 0.9; // margin, title block height
  const b = bbox(ents);
  if (!b) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}in" height="${PH}in"><text x="1" y="1" font-size=".3">Nothing drawn yet.</text></svg>`;
  const availW = PW - 2 * M - 1.4, availH = PH - 2 * M - TB - 1.0;
  let k = Math.min(availW / Math.max(b.w, 1e-9), availH / Math.max(b.h, 1e-9)); // page inches per drawing unit
  // round the scale down to a tidy ratio
  const inPerUnit = TO_IN[units] || 1;
  const ratio = k / inPerUnit; // page inches per real inch
  const tidy = [8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.2, 0.125, 0.1, 0.0625, 0.05, 0.025, 0.01];
  const pick = tidy.find((t) => t <= ratio) || ratio;
  k = pick * inPerUnit;
  const w = b.w * k, h = b.h * k;
  const ox = M + 0.7 + (availW - w) / 2, oy = M + 0.4 + (availH - h) / 2 + h; // lower-left of drawing on the page
  const X = (x) => ox + (x - b.x0) * k, Y = (y) => oy - (y - b.y0) * k;
  let d = '';
  for (const s of toSegments(ents)) {
    const p = flatten(s, 2);
    d += 'M' + p.map((q) => `${n2(X(q[0]))},${n2(Y(q[1]))}`).join('L');
  }
  const lbl = (x, y, t, o = '') => {
    const base = { 'font-size': '.16', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#1a3a8a' };
    for (const k of Object.keys(base)) if (new RegExp(`(^|\\s)${k}=`).test(o)) delete base[k];
    const attrs = Object.entries(base).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<text x="${n2(x)}" y="${n2(y)}" ${attrs} ${o}>${esc(t)}</text>`;
  };
  const dim = [];
  const yd = oy + 0.38, xd = ox + w + 0.45;
  dim.push(`<path d="M${n2(ox)},${n2(oy + 0.08)}V${n2(yd + 0.06)}M${n2(ox + w)},${n2(oy + 0.08)}V${n2(yd + 0.06)}M${n2(ox)},${n2(yd)}H${n2(ox + w)}" stroke="#1a3a8a" stroke-width=".012" fill="none"/>`);
  dim.push(lbl(ox + w / 2, yd - 0.07, fmtLen(b.w, units), 'text-anchor="middle"'));
  dim.push(`<path d="M${n2(ox + w + 0.08)},${n2(oy - h)}H${n2(xd + 0.06)}M${n2(ox + w + 0.08)},${n2(oy)}H${n2(xd + 0.06)}M${n2(xd)},${n2(oy - h)}V${n2(oy)}" stroke="#1a3a8a" stroke-width=".012" fill="none"/>`);
  dim.push(lbl(xd + 0.1, oy - h / 2, fmtLen(b.h, units), `transform="rotate(90 ${n2(xd + 0.1)} ${n2(oy - h / 2)})" text-anchor="middle"`));
  // dimensions the user added in the drawing
  const dstyle = 'stroke="#1a3a8a" stroke-width=".012" fill="none"';
  for (const d of dims || []) {
    if (d.k === 'd') {
      const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const off = (d.o[0] - d.a[0]) * -uy + (d.o[1] - d.a[1]) * ux;
      const A = [d.a[0] - uy * off, d.a[1] + ux * off], B = [d.b[0] - uy * off, d.b[1] + ux * off];
      const sg = off >= 0 ? 1 : -1, e = 0.06 / k * sg;
      dim.push(`<path d="M${n2(X(d.a[0]))},${n2(Y(d.a[1]))}L${n2(X(A[0] - uy * e))},${n2(Y(A[1] + ux * e))}M${n2(X(d.b[0]))},${n2(Y(d.b[1]))}L${n2(X(B[0] - uy * e))},${n2(Y(B[1] + ux * e))}M${n2(X(A[0]))},${n2(Y(A[1]))}L${n2(X(B[0]))},${n2(Y(B[1]))}" ${dstyle}/>`);
      let ang = (-Math.atan2(uy, ux) * 180) / Math.PI; if (ang > 90 || ang < -90) ang += 180;
      const mx = X((A[0] + B[0]) / 2), my = Y((A[1] + B[1]) / 2) - 0.06;
      dim.push(lbl(mx, my, fmtLen(L, units), `text-anchor="middle" transform="rotate(${n2(ang)} ${n2(mx)} ${n2(my)})"`));
    } else if (d.k === 'a') {
      const a1 = Math.atan2(d.p1[1] - d.v[1], d.p1[0] - d.v[0]), a2 = Math.atan2(d.p2[1] - d.v[1], d.p2[0] - d.v[0]);
      let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const R = 0.5 / k; let path = '';
      for (let i = 0; i <= 24; i++) { const t = a1 + (da * i) / 24; path += `${i ? 'L' : 'M'}${n2(X(d.v[0] + R * Math.cos(t)))},${n2(Y(d.v[1] + R * Math.sin(t)))}`; }
      dim.push(`<path d="${path}" ${dstyle}/>`);
      const am = a1 + da / 2;
      dim.push(lbl(X(d.v[0] + (R + 0.12 / k) * Math.cos(am)), Y(d.v[1] + (R + 0.12 / k) * Math.sin(am)), (Math.abs(da) * 180 / Math.PI).toFixed(2) + '\u00b0', 'text-anchor="middle"'));
    } else if (d.k === 'r') {
      dim.push(`<path d="M${n2(X(d.c[0]))},${n2(Y(d.c[1]))}L${n2(X(d.e[0]))},${n2(Y(d.e[1]))}" ${dstyle}/>`);
      dim.push(lbl(X((d.c[0] + d.e[0]) / 2) + 0.05, Y((d.c[1] + d.e[1]) / 2) - 0.06, 'R ' + fmtLen(d.r, units)));
    }
  }
  let start = '';
  if (startPt) {
    const sx = X(startPt[0]), sy = Y(startPt[1]);
    start = `<path d="M${n2(sx)},${n2(sy - 0.1)}L${n2(sx + 0.1)},${n2(sy)}L${n2(sx)},${n2(sy + 0.1)}L${n2(sx - 0.1)},${n2(sy)}Z" fill="#2a9d8f"/>` + lbl(sx + 0.14, sy - 0.12, 'START');
  }
  const scaleTxt = pick >= 1 ? `${pick}:1` : `1:${+(1 / pick).toFixed(2)}`;
  const dt = date.toISOString().slice(0, 10);
  const tb = PH - M - TB;
  const title = `<rect x="${M}" y="${tb}" width="${PW - 2 * M}" height="${TB}" fill="none" stroke="#000" stroke-width=".02"/>
${lbl(M + 0.15, tb + 0.35, name, 'font-size=".26" font-weight="bold" fill="#000"')}
${lbl(M + 0.15, tb + 0.65, `Overall ${fmtLen(b.w, units)} x ${fmtLen(b.h, units)}`, 'fill="#000"')}
${lbl(PW - M - 3.1, tb + 0.35, `Scale ${scaleTxt}`, 'fill="#000"')}${lbl(PW - M - 3.1, tb + 0.65, `Units: ${units}`, 'fill="#000"')}${lbl(PW - M - 1.6, tb + 0.65, dt, 'fill="#000"')}
${lbl(PW - M - 1.6, tb + 0.35, "Cloud's CAD", 'fill="#555"')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}in" height="${PH}in"><rect width="${PW}" height="${PH}" fill="#fff"/>
<rect x="${M - 0.1}" y="${M - 0.1}" width="${PW - 2 * M + 0.2}" height="${PH - 2 * M + 0.2}" fill="none" stroke="#000" stroke-width=".02"/>
<path d="${d}" fill="none" stroke="#000" stroke-width=".02" stroke-linejoin="round" stroke-linecap="round"/>
${dim.join('\n')}
${start}
${title}</svg>`;
}
