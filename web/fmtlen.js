// Cloud's CAD - length formatting. License: GPL v3
const trim = (v, d) => { const s = (+v).toFixed(d); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
// 1.0625 -> 1-1/16"   (nearest 1/32 inch, only when it is within 0.0016 in of that fraction)
export function toFraction(v) {
  const a = Math.abs(v);
  const q = Math.round(a * 32);
  if (Math.abs(a - q / 32) > 0.0016) return null;
  const whole = Math.floor(q / 32);
  let n = q % 32, den = 32;
  while (n && n % 2 === 0) { n /= 2; den /= 2; }
  const sign = v < 0 ? '-' : '';
  if (!n) return `${sign}${whole}"`;
  return `${sign}${whole ? whole + '-' : ''}${n}/${den}"`;
}
export function fmtLen(v, units, d = 4) {
  const base = `${trim(v, d)} ${units}`;
  if (units === 'in') { const f = toFraction(v); if (f && f !== `${trim(v, d)}"`) return `${base} (${f})`; }
  return base;
}
