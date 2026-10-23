// Small in-page "type a number" box. (The browser prompt() does not exist inside the desktop app.)
export function ask(message, def = '') {
  if (typeof window !== 'undefined' && window.__ask) return Promise.resolve(window.__ask(message, def));
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.style.minWidth = '300px';
    const form = document.createElement('form');
    form.method = 'dialog';
    const p = document.createElement('p'); p.textContent = message; p.style.marginTop = '0';
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = def; inp.setAttribute('inputmode', 'decimal');
    inp.style.cssText = 'width:100%;padding:8px;font:inherit;margin:6px 0 14px;box-sizing:border-box';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const ok = document.createElement('button'); ok.textContent = 'OK'; ok.value = 'ok'; ok.className = 'primary';
    const no = document.createElement('button'); no.textContent = 'Cancel'; no.value = 'cancel'; no.type = 'button';
    no.onclick = () => d.close('cancel');
    row.append(no, ok); form.append(p, inp, row); d.append(form); document.body.append(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? inp.value : null; d.remove(); resolve(v); });
    d.showModal(); inp.focus(); inp.select();
  });
}

// Pop-up "what about the original?" Resolves 'delete', 'keep' or null (cancelled).
export function askKeep(title = 'What about the original?') {
  if (typeof window !== 'undefined' && window.__askKeep) return Promise.resolve(window.__askKeep(title));
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.style.minWidth = '300px';
    const p = document.createElement('p'); p.textContent = title; p.style.cssText = 'margin-top:0;font-weight:600';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
    const mk = (t, v, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; if (cls) b.className = cls; b.onclick = () => d.close(v); return b; };
    const del = mk('Delete original', 'delete', 'primary');
    row.append(mk('Cancel', 'cancel'), mk('Keep original', 'keep'), del);
    d.append(p, row); document.body.append(d);
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v === 'delete' || v === 'keep' ? v : null); });
    d.showModal(); del.focus();
  });
}

// Pop-up for a file that already exists. Resolves 'replace', 'new' or null (cancelled).
export function askReplace(title) {
  if (typeof window !== 'undefined' && window.__askReplace) return Promise.resolve(window.__askReplace(title));
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.style.minWidth = '300px';
    const p = document.createElement('p'); p.textContent = title; p.style.cssText = 'margin-top:0;font-weight:600';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
    const mk = (t, v, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; if (cls) b.className = cls; b.onclick = () => d.close(v); return b; };
    const rep = mk('Replace it', 'replace', 'primary');
    row.append(mk('Cancel', 'cancel'), mk('Keep both', 'new'), rep);
    d.append(p, row); document.body.append(d);
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v === 'replace' || v === 'new' ? v : null); });
    d.showModal(); rep.focus();
  });
}
