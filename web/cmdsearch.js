// Cloud's CAD - command search: press / or Ctrl+K, type what you want, press Enter. License: GPL v3
export function initCmdSearch() {
  const dlg = document.createElement('dialog'); dlg.id = 'cmdDlg';
  dlg.innerHTML = '<input id="cmdIn" type="text" placeholder="Type a command, like mirror, nest, shell, flat pattern…" autocomplete="off"><div id="cmdList"></div><div class="small hint">Up/Down to choose, Enter to run, Esc to close. Click the star (or press Ctrl+D) to pin a favourite.</div>';
  document.body.appendChild(dlg);
  const st = document.createElement('style');
  st.textContent = '#cmdDlg{border:1px solid var(--line);border-radius:12px;background:var(--panel,#161b22);color:inherit;padding:12px;width:min(520px,92vw);top:12vh;margin:0 auto}#cmdDlg::backdrop{background:rgba(0,0,0,.45)}#cmdIn{width:100%;font-size:16px;padding:10px;box-sizing:border-box}#cmdList div{padding:7px 10px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:10px}#cmdList div.on{background:var(--accent);color:var(--accent-ink)}#cmdList small{opacity:.7;margin-left:auto}#cmdList .pin{cursor:pointer;padding:0 4px;font-size:16px}';
  document.head.appendChild(st);
  const inp = dlg.querySelector('#cmdIn'), list = dlg.querySelector('#cmdList');
  let items = [], sel = 0;
  const KEY = 'cloudcad-pins';
  const pins = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const setPins = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* ignore */ } };
  const togglePin = (t) => { const p = pins(); const i = p.indexOf(t); if (i >= 0) p.splice(i, 1); else p.push(t); setPins(p); };
  const label = (b) => (b.getAttribute('data-cmd') || b.textContent || b.title || '').replace(/\s+/g, ' ').trim();
  function collect() {
    const out = [], seen = new Set();
    for (const b of document.querySelectorAll('button, [role=button]')) {
      if (dlg.contains(b) || b.disabled) continue;
      const r = b.getBoundingClientRect(); if (!r.width && !r.height) continue;
      const t = label(b); if (t.length < 2 || t.length > 60 || seen.has(t)) continue;
      seen.add(t); out.push({ t, hint: (b.title || '').slice(0, 70), b });
    }
    return out;
  }
  function draw() {
    const q = inp.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), pinned = pins();
    let scored = items.map((c) => { const h = (c.t + ' ' + c.hint).toLowerCase(); if (!words.every((w) => h.includes(w))) return null; const pi = pinned.indexOf(c.t); return { c, s: pi >= 0 ? -1 : c.t.toLowerCase().startsWith(q) ? 0 : c.t.toLowerCase().includes(q) ? 1 : 2 }; }).filter(Boolean).sort((a, b) => a.s - b.s);
    scored = scored.slice(0, q ? 8 : 10);
    list.innerHTML = ''; sel = Math.min(sel, Math.max(0, scored.length - 1));
    scored.forEach((x, i) => {
      const d = document.createElement('div'); if (i === sel) d.className = 'on';
      d.innerHTML = '<span></span><small></small><b class="pin" title="Pin as favourite"></b>';
      d.children[0].textContent = x.c.t; d.children[1].textContent = x.c.hint;
      const star = d.children[2]; star.textContent = pinned.includes(x.c.t) ? '\u2605' : '\u2606';
      star.addEventListener('click', (e) => { e.stopPropagation(); togglePin(x.c.t); draw(); inp.focus(); });
      d.addEventListener('click', () => run(x.c)); list.appendChild(d);
    });
    list._cur = scored.map((x) => x.c);
    if (!scored.length) list.innerHTML = '<div class="small hint">Nothing matches. Try another word.</div>';
  }
  function run(c) { dlg.close(); setTimeout(() => c.b.click(), 30); }
  function open() { const mm = document.getElementById('moreMenu'), was = mm && mm.open; if (mm) mm.open = true; items = collect(); if (mm) mm.open = !!was; inp.value = ''; sel = 0; draw(); if (!dlg.open) dlg.showModal(); inp.focus(); }
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    const n = (list._cur || []).length;
    if (e.key === 'ArrowDown') { sel = Math.min(n - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && n) { togglePin(list._cur[sel].t); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && n) { run(list._cur[sel]); e.preventDefault(); }
  });
  window.addEventListener('keydown', (e) => {
    const typing = e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !dlg.open) { e.preventDefault(); open(); }
  });
  return { open };
}
