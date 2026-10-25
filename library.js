// Cloud's CAD - profile library: save profiles with customer / tags / notes, search them, bring them back, and find the closest match
// to a drawing. Stored on this computer (IndexedDB). Export / import makes a backup file. License: GPL v3
import { flatten, chain } from './core.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// downscale any picture to a compact jpeg data URL (keeps the library small)
export function shrinkImage(src, max = 900) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.naturalWidth || 1, im.naturalHeight || 1)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = () => rej(new Error('Could not read that picture.'));
    im.src = src;
  });
}
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); });

export function thumbSvg(ents, S) {
  const polys = S.toSegments(ents).map((s) => flatten(s, 5));
  const all = polys.flat();
  if (!all.length) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of all) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const w = x1 - x0 || 1, h = y1 - y0 || 1, pad = Math.max(w, h) * 0.08;
  const d = polys.map((p) => 'M' + p.map((q) => `${(q[0] - x0).toFixed(3)} ${(y1 - q[1]).toFixed(3)}`).join('L')).join('');
  return `<svg viewBox="${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${(Math.max(w, h) / 90).toFixed(4)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function initLibrary({ $, state, S, SH, store, toast, TO_IN, addEnts, replaceWith, download }) {
  let items = [], scores = null, editId = null, pic = null, openedId = null;
  const units = () => state.units;
  const sourceEnts = () => { const sel = state.doc.ents.filter((e) => state.sel.has(e.id)); return sel.length ? sel : state.doc.ents; };
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));

  async function load() { try { items = await store.all('library'); } catch (e) { items = []; } render(); }

  const NONE = '__none__';
  const custOf = (it) => (it.customer || '').trim();
  function refreshCustomers() {
    const names = new Map(); let none = 0;
    for (const it of items) { const c = custOf(it); if (c) names.set(c, (names.get(c) || 0) + 1); else none++; }
    const cur = $('lbCust').value;
    $('lbCust').innerHTML = `<option value="">All customers (${items.length})</option>` + [...names].sort((a, b) => a[0].localeCompare(b[0])).map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('') + (none && names.size ? `<option value="${NONE}">No customer (${none})</option>` : '');
    $('lbCust').value = [...$('lbCust').options].some((o) => o.value === cur) ? cur : '';
    $('lbCustomers').innerHTML = [...names.keys()].sort().map((c) => `<option value="${esc(c)}">`).join('');
  }
  const card = (it) => {
    const m = scores && scores.get(it.id);
    const size = `${fmt(it.w)} x ${fmt(it.h)} ${it.units}`;
    const badge = m ? `<div class="lbMatch ${m.pct >= 90 ? 'good' : m.pct >= 70 ? 'mid' : ''}"><b>${m.pct}% match</b> <span>${esc(m.how)}</span><br><span>Yours ${esc(m.mine)} &middot; this one ${esc(m.theirs)}</span></div>` : '';
    return `<div class="lbCard" data-id="${esc(it.id)}"><div class="lbThumb" data-act="big" title="Click to enlarge">${it.photo ? `<img class="lbPhoto" src="${it.photo}" alt=""><div class="lbMini">${it.thumb || ''}</div>` : (it.thumb || '')}</div><div class="lbInfo">
        <b>${esc(it.name)}</b>${it.customer ? `<div class="hint">Customer: ${esc(it.customer)}</div>` : ''}<div class="hint">${esc(size)}${(it.tags || []).length ? ' &middot; ' + esc(it.tags.join(', ')) : ''}</div>
        ${it.notes ? `<div class="hint lbNotes">${esc(it.notes)}</div>` : ''}${badge}
        <div class="lbBtns"><button data-act="insert" title="Add it to the drawing that is open">Insert</button><button data-act="open" title="Replace the drawing with this profile (Undo brings yours back)">Open</button><button data-act="edit">Edit</button><button data-act="del">Delete</button></div></div></div>`;
  };
  const filtered = () => {
    const q = $('lbSearch').value.trim().toLowerCase(), cf = $('lbCust').value;
    return items.filter((it) => (!q || [it.name, it.customer, (it.tags || []).join(' '), it.notes].join(' ').toLowerCase().includes(q)) && (!cf || (cf === NONE ? !custOf(it) : custOf(it) === cf)));
  };
  function showUpd() { const it = openedId && items.find((i) => i.id === openedId); $('lbUpdate').hidden = !it; if (it) $('lbUpdate').textContent = `Update "${it.name}" with the drawing`; }
  async function updateOpened() {
    const it = items.find((i) => i.id === openedId); if (!it) { showUpd(); return; }
    const ents = sourceEnts(); if (!ents.length) { toast('Nothing in the drawing to save yet.'); return; }
    if (!window.confirm(`Replace the saved shape of "${it.name}" with what is in the drawing now? Its name, customer, notes and picture stay.`)) return;
    const b = S.bbox(ents), sp = SH.shapePoints(ents);
    await store.put('library', { ...it, ents: ents.map(({ id, ...e }) => e), units: units(), w: b.w, h: b.h, thumb: thumbSvg(ents, S), pts: sp ? sp.pts : null, updated: Date.now() });
    toast(`Updated "${it.name}" in the library.`); await load();
  }
  function render() {
    showUpd(); refreshCustomers();
    let list = filtered();
    if (scores) list = list.filter((it) => scores.has(it.id)).sort((a, b) => scores.get(b.id).pct - scores.get(a.id).pct);
    else list.sort($('lbSort').value === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.created - a.created);
    $('lbCount').textContent = items.length ? `${list.length} of ${items.length} profile${items.length === 1 ? '' : 's'}` : '';
    $('lbEmpty').hidden = items.length > 0;
    const many = new Set(items.map(custOf)).size > 1;
    if (scores || !many || $('lbCust').value) { $('lbGrid').innerHTML = list.map(card).join(''); return; }
    // all customers: group under a heading for each
    const groups = new Map(); for (const it of list) { const c = custOf(it) || ''; (groups.get(c) || groups.set(c, []).get(c)).push(it); }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    $('lbGrid').innerHTML = keys.map((k) => `<h3 class="lbHead">${esc(k || 'No customer')} <span class="hint">(${groups.get(k).length})</span></h3>` + groups.get(k).map(card).join('')).join('');
  }

  function formValues() {
    return { name: $('lbName').value.trim(), customer: $('lbCustomer').value.trim(), tags: $('lbTags').value.split(',').map((t) => t.trim()).filter(Boolean), notes: $('lbNotes').value.trim() };
  }
  function showPic() { const has = !!pic; $('lbPicPrev').hidden = !has; $('lbPicNone').hidden = has; $('lbPicClear').hidden = !has; if (has) $('lbPicPrev').src = pic; else $('lbPicPrev').removeAttribute('src'); }
  async function setPicFrom(src) { try { pic = await shrinkImage(src); showPic(); toast('Picture added. Press Save to keep it with the profile.'); } catch (e) { toast(e.message || 'Could not use that picture.'); } }
  function snipSvg(ents) {   // the drawing as a clean picture: dark lines on white, with its size written underneath
    const svg = thumbSvg(ents, S); if (!svg) return '';
    const b = S.bbox(ents), k = TO_IN[units()], lab = `${fmt(b.w * k)} x ${fmt(b.h * k)} in`;
    const m = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number), fs = Math.max(m[2], m[3]) / 22;
    const vb = `${m[0]} ${m[1]} ${m[2]} ${m[3] + fs * 2.2}`;
    return svg.replace(/viewBox="[^"]+"/, `viewBox="${vb}" width="900" height="${Math.round(900 * (m[3] + fs * 2.2) / m[2])}"`).replace('currentColor', '#111').replace('</svg>', `<text x="${m[0] + m[2] / 2}" y="${m[1] + m[3] + fs * 1.5}" font-family="Arial,sans-serif" font-size="${fs}" fill="#444" text-anchor="middle">${lab}</text></svg>`).replace('<svg ', '<svg style="background:#fff" ');
  }
  function clearForm() { pic = null; showPic(); editId = null; for (const id of ['lbName', 'lbCustomer', 'lbTags', 'lbNotes']) $(id).value = ''; $('lbSave').textContent = 'Save to library'; $('lbReshape').parentElement.hidden = true; $('lbReshape').checked = false; $('lbCancelEdit').hidden = true; }

  async function save() {
    const f = formValues();
    if (!f.name) { toast('Give the profile a name first.'); $('lbName').focus(); return; }
    const makeShape = !editId || $('lbReshape').checked;
    const rec = editId ? { ...items.find((i) => i.id === editId) } : { created: Date.now() };
    Object.assign(rec, f);
    if (pic) rec.photo = pic; else delete rec.photo;
    if (makeShape) {
      const ents = sourceEnts();
      if (!ents.length) { toast('Nothing in the drawing to save yet.'); return; }
      const b = S.bbox(ents), sp = SH.shapePoints(ents);
      rec.ents = ents.map(({ id, ...e }) => e); rec.units = units(); rec.w = b.w; rec.h = b.h; rec.thumb = thumbSvg(ents, S); rec.pts = sp ? sp.pts : null;
    }
    await store.put('library', rec);
    toast(editId ? `Updated "${f.name}".` : `Saved "${f.name}" to the library.`);
    clearForm(); await load();
  }

  async function saveAll() {
    const ents = sourceEnts(); if (!ents.length) { toast('Nothing in the drawing to save yet.'); return; }
    const k = 1 / TO_IN[units()], f = formValues(), base = f.name || 'Style';
    const chains = chain(S.toSegments(ents), 0.003 * k).filter((c) => { const b = S.bbox(S.fromSegments(c)); return b && Math.max(b.w, b.h) > 0.05 * k; });
    if (!chains.length) { toast('Could not find separate pieces in this drawing.'); return; }
    if (!window.confirm(`Found ${chains.length} separate piece${chains.length === 1 ? '' : 's'}. Save ${chains.length === 1 ? 'it' : 'each one'} as its own profile${f.customer ? ' for ' + f.customer : ''}, named "${base} 1"${chains.length > 1 ? ' to "' + base + ' ' + chains.length + '"' : ''}?`)) return;
    chains.sort((a, b) => { const A = S.bbox(S.fromSegments(a)), B = S.bbox(S.fromSegments(b)); return A.x0 - B.x0 || B.y1 - A.y1; });   // left to right
    let n = 0; const t0 = Date.now();
    for (const c of chains) {
      const pe = S.fromSegments(c).map((e, i) => ({ ...e, id: i + 1 })), b = S.bbox(pe), sp = SH.shapePoints(pe);
      await store.put('library', { id: 'lib' + Date.now().toString(36) + (n + Math.random()).toString(36).slice(2, 6), created: t0 - n, name: `${base} ${++n}`, customer: f.customer, tags: f.tags, notes: f.notes, ents: pe.map(({ id, ...e }) => e), units: units(), w: b.w, h: b.h, thumb: thumbSvg(pe, S), pts: sp ? sp.pts : null });
    }
    toast(`Saved ${n} profile${n === 1 ? '' : 's'}${f.customer ? ' under ' + f.customer : ''}. Rename any of them with Edit.${pic ? ' The picture was not attached; open each with Edit to give it its own.' : ''}`);
    clearForm(); await load();
  }
  $('lbSaveAll').addEventListener('click', saveAll);
  $('lbCust').addEventListener('change', render);

  const find = (id) => items.find((i) => i.id === id);
  $('lbGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const it = find(b.closest('.lbCard').dataset.id); if (!it) return;
    if (b.dataset.act === 'big') { bigView(it); return; }
    const act = b.dataset.act;
    if (act === 'insert') addEnts(it.ents.map((x) => ({ ...x })), it.units, `"${it.name}"`);
    else if (act === 'open') { openedId = it.id; showUpd(); replaceWith(it.ents.map((x) => ({ ...x })), it.units, it.name); }
    else if (act === 'edit') {
      editId = it.id; $('lbName').value = it.name; $('lbCustomer').value = it.customer || ''; $('lbTags').value = (it.tags || []).join(', '); $('lbNotes').value = it.notes || ''; pic = it.photo || null; showPic();
      $('lbSave').textContent = 'Save changes'; $('lbReshape').parentElement.hidden = false; $('lbCancelEdit').hidden = false; $('lbName').focus();
    } else if (act === 'del') {
      if (confirm(`Delete "${it.name}" from the library?`)) { await store.del('library', it.id); if (editId === it.id) clearForm(); toast(`Deleted "${it.name}".`); await load(); }
    }
  });
  function bigView(it) {
    const d = document.createElement('div'); d.id = 'lbBig';
    d.innerHTML = (it.photo ? `<img src="${it.photo}" alt="">` : '') + `<div class="lbBigDraw">${it.thumb || ''}</div><div class="cap">${esc(it.name)}${it.customer ? ' &middot; ' + esc(it.customer) : ''} &middot; ${esc(fmt(it.w) + ' x ' + fmt(it.h) + ' ' + it.units)}</div>`;
    const close = () => { d.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    d.addEventListener('click', close); document.addEventListener('keydown', onKey, true); document.body.appendChild(d);
  }
  // reference picture: file, camera, paste, drop, or a snip of the drawing
  $('lbPicAdd').addEventListener('click', () => $('lbPicFile').click());
  $('lbPicFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await setPicFrom(await readFile(f)); });
  $('lbPicClear').addEventListener('click', () => { pic = null; showPic(); });
  $('lbPicSnip').addEventListener('click', async () => {
    const ents = sourceEnts(); if (!ents.length) { toast('Nothing in the drawing to snip yet.'); return; }
    await setPicFrom('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(snipSvg(ents)));
  });
  const imgOf = (dt) => [...(dt && dt.files || [])].find((f) => f.type.startsWith('image/'));
  $('tab-library').addEventListener('paste', async (e) => { const f = imgOf(e.clipboardData); if (f) { e.preventDefault(); await setPicFrom(await readFile(f)); } });
  const box = $('lbPicBox');
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', async (e) => { e.preventDefault(); box.classList.remove('drop'); const f = imgOf(e.dataTransfer); if (f) await setPicFrom(await readFile(f)); else toast('That was not a picture.'); });
  $('lbSave').addEventListener('click', save);
  $('lbUpdate').addEventListener('click', updateOpened);
  $('libSide').addEventListener('pointerenter', showUpd);
  $('lbCancelEdit').addEventListener('click', clearForm);
  $('lbSearch').addEventListener('input', render);
  $('lbSort').addEventListener('change', render);

  // closest match to the drawing (or the selection)
  $('lbMatch').addEventListener('click', () => {
    const ents = sourceEnts();
    if (!ents.length) { toast('Draw or open something first, then find what it matches.'); return; }
    if (!items.length) { toast('The library is empty. Save some profiles first.'); return; }
    const b = S.bbox(ents), mine = `${fmt(b.w * TO_IN[units()])} x ${fmt(b.h * TO_IN[units()])} in`;
    const rk = SH.rankMatches(ents, items);
    scores = new Map(rk.filter((r) => r.pct >= 40).slice(0, 12).map((r) => {
      const it = find(r.id);
      return [r.id, { pct: r.pct, how: r.how, mine, theirs: `${fmt(it.w * TO_IN[it.units])} x ${fmt(it.h * TO_IN[it.units])} in` }];
    }));
    $('lbClearMatch').hidden = false;
    if (!scores.size) toast('Nothing in the library looks close to this one.');
    else toast(`Best match: ${find(rk[0].id).name} (${rk[0].pct}%).`);
    render();
  });
  $('lbClearMatch').addEventListener('click', () => { scores = null; $('lbClearMatch').hidden = true; render(); });

  // backup / move to another computer
  $('lbExport').addEventListener('click', () => {
    const cf = $('lbCust').value, out = cf ? items.filter((it) => (cf === NONE ? !custOf(it) : custOf(it) === cf)) : items;
    if (!out.length) { toast('The library is empty.'); return; }
    download((cf && cf !== NONE ? cf.replace(/[^\w\- ]+/g, '') + ' ' : '') + 'clouds-cad-library.cloudlib', JSON.stringify({ format: 'cloudlib', version: 1, items: out.map(({ pts, ...r }) => r) }), 'application/json');
  });
  $('lbImport').addEventListener('click', () => $('lbImportFile').click());
  $('lbImportFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (p.format !== 'cloudlib' || !Array.isArray(p.items)) throw new Error('That is not a Cloud\'s CAD library file.');
      let n = 0, skip = 0; const have = new Set(items.map((i) => i.id));
      for (const r of p.items) {
        if (!r || !Array.isArray(r.ents) || !r.name) continue;
        if (have.has(r.id)) { skip++; continue; }
        const sp = SH.shapePoints(r.ents.map((x, i) => ({ ...x, id: i + 1 })));
        await store.put('library', { ...r, pts: sp ? sp.pts : null, created: r.created || Date.now() }); n++;
      }
      toast(`Imported ${n} profile${n === 1 ? '' : 's'}${skip ? ` (${skip} already here)` : ''}.`);
      await load();
    } catch (err) { alert('Could not import: ' + (err.message || err)); }
  });

  clearForm();
  load();
  return { refresh: load };
}
