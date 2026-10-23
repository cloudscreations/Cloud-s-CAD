// Cloud's CAD - machine settings: open the controller's settings file (the .dbi the old Machine Parameters program used), show every
// setting in plain words, edit the safe ones, compare two files, print a settings sheet. It never writes to the controller itself.
// License: GPL v3
import MDBReader from 'mdb-reader';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const AX = { X: 'Left-right (X)', Y: 'Up-down (Y)', R: 'Second pair (R)', W: 'W' };

// Settings that can wreck a cut or the machine if they are wrong: locked until "Unlock" is ticked.
const CRITICAL = /^(TABLE_|BACKOFF_|LIMIT_MASK|NUM_DIMEN|CONFIG_BITS|UNITS_DISTANCE|PENDANT_MODEL|UADJUST|VADJUST|HOME_SPEED|SLEW_ACCEL|MMACCEL_|MMVACC_|MMVMIN_|JGACC_|MMREVDLY_|ARC_RES|VRTX_ANG|TIME_SCALE|JOG_XY_MODE|KDM_BSTRING|MACH_MAX_WTEMP|PULSE_WIDTH)/;
const GROUPS = [
  ['Table size and homing', /^(TABLE_|BACKOFF_|HOME_SPEED_|UADJUST|VADJUST)/, 'How far the machine travels and where it finds home. Wrong values can drive the carriage into its stops.'],
  ['Speeds and acceleration', /^(MMV|MMACCEL|MMREVDLY|JG|SLEW_)/, 'Cutting speed limits, jog speeds and how hard the motors accelerate.'],
  ['Wire', /^(MACH_MAX_WTEMP|WIRE_DELAY|REVDLY|PULSE_WIDTH)/, 'Wire power and timing.'],
];
const clean = (r) => !/^PARAM\d+$/.test(r.Keyword) && r.Type !== 'MODULE';

export function parseDbi(arrayBuffer) {
  const rd = new MDBReader(Buffer.from(new Uint8Array(arrayBuffer)));
  if (!rd.getTableNames().includes('Machine')) throw new Error('That is not a machine settings (.dbi) file. It has no Machine table.');
  const fam = (() => { try { return rd.getTable('DBI_Version').getData()[0]; } catch (e) { return null; } })();
  const rows = rd.getTable('Machine').getData().filter((r) => r.Type !== 'MODULE').map((r) => {
    const t = String(r.Type || '').toUpperCase();
    const v = t === 'STRING' ? (r.StringValue == null ? '' : String(r.StringValue)) : t === 'FLOAT' ? Number(r.DoubleValue) : Number(r.LongValue);
    return { key: r.Keyword, loc: r.Location, type: t, desc: (r.Description || '').trim(), value: v };
  });
  return { rows, family: fam ? `${fam.FamilyCode || ''} v${fam.Version || ''}`.trim() : '' };
}

export function initMachineSettings({ $, toast, download }) {
  let cur = null;        // { name, family, rows:[{key,loc,type,desc,value,orig}] }
  let other = null;      // comparison file
  let dlg = null, unlocked = false, query = '';

  const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
  const same = (a, b) => (typeof a === 'string' || typeof b === 'string' ? String(a) === String(b) : Math.abs(num(a) - num(b)) < 1e-9);
  const changed = () => cur.rows.filter((r) => !same(r.value, r.orig));
  const fmtV = (r, v) => (r.type === 'STRING' ? String(v) : Number.isInteger(+v) && r.type === 'INTEGER' ? String(v) : String(+(+v).toFixed(6)));
  const otherOf = (key) => other && other.rows.find((r) => r.key === key);

  function load(name, parsed) { cur = { name, family: parsed.family, rows: parsed.rows.map((r) => ({ ...r, orig: r.value })) }; other = null; unlocked = false; render(); }

  async function openFile(file, asOther) {
    try {
      const buf = await file.arrayBuffer();
      let parsed;
      if (/\.(json|cloudmachine)$/i.test(file.name)) { const p = JSON.parse(new TextDecoder().decode(buf)); if (p.format !== 'cloudmachine') throw new Error('That is not a Cloud\'s CAD machine settings file.'); parsed = { rows: p.rows.map((r) => ({ key: r.key, loc: r.loc, type: r.type, desc: r.desc, value: r.value })), family: p.family || '' }; }
      else parsed = parseDbi(buf);
      if (asOther) { other = { name: file.name, rows: parsed.rows }; render(); }
      else { load(file.name, parsed); }
    } catch (e) { toast('Could not open that: ' + (e.message || e)); }
  }
  function pick(asOther) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.dbi,.mdb,.json,.cloudmachine';
    i.onchange = () => { if (i.files[0]) openFile(i.files[0], asOther); };
    i.click();
  }

  function rowHtml(r, critical) {
    const ch = !same(r.value, r.orig), o = otherOf(r.key), diff = o && !same(o.value, r.value);
    const lock = critical && !unlocked;
    const inp = r.type === 'STRING' ? `<input type="text" value="${esc(r.value)}" data-k="${esc(r.key)}" ${lock ? 'disabled' : ''}>` : `<input type="number" step="any" value="${esc(fmtV(r, r.value))}" data-k="${esc(r.key)}" ${lock ? 'disabled' : ''}>`;
    return `<tr class="${ch ? 'ch' : ''}"><td>${esc(r.desc || r.key)}<div class="k">${esc(r.key)}</div></td><td>${inp}</td><td class="was">${ch ? 'was ' + esc(fmtV(r, r.orig)) : ''}</td>${other ? `<td class="${diff ? 'df' : ''}">${o ? esc(fmtV(o, o.value)) : '<i>not in file</i>'}</td>` : ''}</tr>`;
  }
  const matchQ = (r) => !query || (r.key + ' ' + r.desc).toLowerCase().includes(query);

  function materialsHtml() {
    const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9], by = (k) => cur.rows.find((r) => r.key === k);
    const rows = idx.map((i) => ({ i, l: by('LABEL_MAT_' + i), s: by('CUTVEL_MAT_' + i), a: by('WIREAMP_MAT_' + i) })).filter((m) => m.l && m.s);
    if (!rows.length) return '';
    const cell = (r, type) => r ? `<td><input type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(type === 'number' ? fmtV(r, r.value) : r.value)}" data-k="${esc(r.key)}"></td>` : '<td></td>';
    return `<h3>Cutting materials <span class="hint">the nine presets on the pendant: name, cut speed and wire amps</span></h3><table class="msT"><tr><th>#</th><th>Name</th><th>Cut speed</th><th>Wire amps</th>${other ? '<th>Other file</th>' : ''}</tr>` +
      rows.map((m) => { const o = otherOf('CUTVEL_MAT_' + m.i), ol = otherOf('LABEL_MAT_' + m.i); return `<tr class="${[m.l, m.s, m.a].some((x) => x && !same(x.value, x.orig)) ? 'ch' : ''}"><td>${m.i}</td>${cell(m.l, 'text')}${cell(m.s, 'number')}${cell(m.a, 'number')}${other ? `<td>${ol ? esc(ol.value) : ''} ${o ? '/ ' + esc(fmtV(o, o.value)) : ''}</td>` : ''}</tr>`; }).join('') + '</table>';
  }

  function render() {
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'msDlg'; document.body.appendChild(dlg); dlg.addEventListener('close', () => { /* keep state */ }); }
    if (!cur) {
      dlg.innerHTML = `<div class="msHead"><h2>Machine settings</h2><button data-a="close">Close</button></div><p>Open the settings file your old Machine Parameters program used. In your copy of the old program it is <b>Hotwire8700.dbi</b> in the Machine Tools folder.</p><div class="actions"><button class="primary" data-a="open">Open settings file...</button></div><p class="hint">This only reads and edits a copy on this computer. It does not send anything to the machine.</p>`;
      wire(); return;
    }
    const mat = /^(CUTVEL_MAT_|WIREAMP_MAT_|LABEL_MAT_)/;
    const used = new Set(); let body = materialsHtml();
    for (const [title, re, note] of GROUPS) {
      const rs = cur.rows.filter((r) => re.test(r.key) && clean(r) && !mat.test(r.key) && matchQ(r)); rs.forEach((r) => used.add(r.key));
      if (rs.length) body += `<h3>${esc(title)} <span class="hint">${esc(note)}</span></h3><table class="msT">${rs.map((r) => rowHtml(r, CRITICAL.test(r.key))).join('')}</table>`;
    }
    const rest = cur.rows.filter((r) => clean(r) && !mat.test(r.key) && !used.has(r.key) && matchQ(r));
    if (rest.length) body += `<h3>Other settings</h3><table class="msT">${rest.map((r) => rowHtml(r, CRITICAL.test(r.key))).join('')}</table>`;
    const unnamed = cur.rows.filter((r) => !clean(r) && matchQ(r));
    if (unnamed.length) body += `<details><summary>Unnamed settings (${unnamed.length}). Leave these alone.</summary><table class="msT">${unnamed.map((r) => rowHtml(r, true)).join('')}</table></details>`;
    const n = changed().length;
    dlg.innerHTML = `<div class="msHead"><h2>Machine settings <span class="hint">${esc(cur.name)}${cur.family ? ' &middot; ' + esc(cur.family) : ''}</span></h2><button data-a="close">Close</button></div>
      <div class="msBar"><input id="msQ" type="text" placeholder="Search settings" value="${esc(query)}"><label class="check"><input id="msUnlock" type="checkbox" ${unlocked ? 'checked' : ''}> Unlock the locked settings (table size, homing, acceleration)</label></div>
      <div class="actions"><button data-a="open">Open another file</button><button data-a="cmp">${other ? 'Compare with: ' + esc(other.name) : 'Compare with another file...'}</button><button data-a="csv" ${n ? '' : 'disabled'}>Save list of ${n} change${n === 1 ? '' : 's'}</button><button data-a="json">Save settings file</button><button data-a="cmd" ${n ? '' : 'disabled'} title="Writes the changed values as the controller's own text commands (value, location number, set_float / set_integer / set_string)">Save as controller commands</button><button data-a="print">Print settings sheet</button><button data-a="undo" ${n ? '' : 'disabled'}>Undo all changes</button></div>
      <div class="msWarn">Edits here change this copy only. To put changed values into the machine they still have to be sent to the controller, which this app cannot do yet. Keep your old file as a backup.</div>
      <div class="msBody">${body}</div>`;
    wire();
  }

  function wire() {
    dlg.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act(b.dataset.a)));
    dlg.querySelectorAll('input[data-k]').forEach((i) => i.addEventListener('change', () => {
      const r = cur.rows.find((x) => x.key === i.dataset.k); if (!r) return;
      const v = r.type === 'STRING' ? i.value : parseFloat(i.value);
      if (r.type !== 'STRING' && !Number.isFinite(v)) { i.value = fmtV(r, r.value); return; }
      r.value = r.type === 'INTEGER' ? Math.round(v) : v; touch(i, r);
    }));
    const q = dlg.querySelector('#msQ'); if (q) q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); const p = q.selectionStart; render(); const q2 = dlg.querySelector('#msQ'); q2.focus(); q2.setSelectionRange(p, p); });
    const u = dlg.querySelector('#msUnlock'); if (u) u.addEventListener('change', () => {
      if (u.checked && !window.confirm('These settings control how far the machine travels and how hard it accelerates. A wrong value can crash the carriage or break the wire. Unlock them anyway?')) { u.checked = false; return; }
      unlocked = u.checked; render();
    });
  }

  // update only what changed on screen, so the field you click next keeps focus
  function touch(input, r) {
    const tr = input.closest('tr'), ins = [...tr.querySelectorAll('input[data-k]')].map((x) => cur.rows.find((q) => q.key === x.dataset.k));
    tr.classList.toggle('ch', ins.some((q) => q && !same(q.value, q.orig)));
    const was = tr.querySelector('.was'); if (was) was.textContent = same(r.value, r.orig) ? '' : 'was ' + fmtV(r, r.orig);
    const n = changed().length;
    const set = (a, txt, dis) => { const b = dlg.querySelector(`[data-a=${a}]`); if (b) { if (txt) b.textContent = txt; b.disabled = dis; } };
    set('csv', `Save list of ${n} change${n === 1 ? '' : 's'}`, !n); set('cmd', null, !n); set('undo', null, !n);
  }
  function listText() {
    return changed().map((r) => `${r.desc || r.key} (${r.key}): ${fmtV(r, r.orig)} -> ${fmtV(r, r.value)}`).join('\r\n');
  }
  // The controller takes postfix text commands: <value> <location> set_float | set_integer, "<text>" <location> set_string.
  // Layout read from the old MachineParameters program. Not yet checked against a controller, so treat it as a draft.
  function cmdText() {
    const f = (r) => (r.type === 'STRING' ? `"${String(r.value).replace(/"/g, '')}" ${r.loc} set_string` : r.type === 'INTEGER' ? `${Math.round(r.value)} ${r.loc} set_integer` : `${+(+r.value).toFixed(6)} ${r.loc} set_float`);
    return ['; Cloud\'s CAD - changed machine parameters (draft, not yet checked against a controller)', ...changed().map((r) => f(r) + ' ; ' + (r.desc || r.key) + ' was ' + fmtV(r, r.orig))].join('\r\n') + '\r\n';
  }
  function sheetHtml() {
    const rows = cur.rows.filter(clean).map((r) => `<tr><td>${esc(r.desc || r.key)}</td><td>${esc(r.key)}</td><td style="text-align:right">${esc(fmtV(r, r.value))}</td></tr>`).join('');
    return `<!doctype html><html><head><style>body{font:12px Arial;margin:18px}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ccc;padding:2px 6px}td:nth-child(2){color:#666;font-size:10px}</style></head><body><h1>Machine settings: ${esc(cur.name)}</h1><div>${esc(cur.family)} &middot; printed ${new Date().toLocaleDateString()}</div><table>${rows}</table></body></html>`;
  }

  function act(a) {
    if (a === 'close') dlg.close();
    else if (a === 'open') pick(false);
    else if (a === 'cmp') { if (other) { other = null; render(); } else pick(true); }
    else if (a === 'csv') download(cur.name.replace(/\.[^.]+$/, '') + ' changes.txt', listText(), 'text/plain');
    else if (a === 'json') download(cur.name.replace(/\.[^.]+$/, '') + '.cloudmachine', JSON.stringify({ format: 'cloudmachine', version: 1, family: cur.family, source: cur.name, rows: cur.rows.map(({ orig, ...r }) => r) }, null, 1), 'application/json');
    else if (a === 'cmd') download(cur.name.replace(/\.[^.]+$/, '') + ' changes.nvram.txt', cmdText(), 'text/plain');
    else if (a === 'undo') { cur.rows.forEach((r) => { r.value = r.orig; }); render(); }
    else if (a === 'print') {
      const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; f.srcdoc = sheetHtml();
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not open the print window.'); } setTimeout(() => f.remove(), 60000); };
      document.body.appendChild(f);
    }
  }

  $('msOpen').addEventListener('click', () => { render(); if (!dlg.open) dlg.showModal(); });
  return { openFile, parseDbi };
}
