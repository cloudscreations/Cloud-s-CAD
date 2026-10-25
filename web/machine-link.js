// Cloud's CAD - send the finished .tap straight to the machine's folder (the one the DNC program watches). License: GPL v3
// Desktop app: plain folder access. Chrome / Edge: asks once for the folder and remembers it. Other browsers: normal download.
import { askReplace } from './ask.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clean = (n) => (String(n || 'part').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/\.(tap|nc|gcode)$/i, '').trim() || 'part');

// remember the folder handle (browser version) in its own tiny database
function hdb() { return new Promise((res) => { try { const r = indexedDB.open('cloudcad-machine', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); }
async function hGet() { const db = await hdb(); if (!db) return null; return new Promise((res) => { const q = db.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function hPut(v) { const db = await hdb(); if (!db) return; await new Promise((res) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, 'dir'); t.oncomplete = t.onerror = () => res(); }); }

export function initMachineLink({ $, toast, getTap, getName, fallbackDownload }) {
  const D = window.cloudDesktop && window.cloudDesktop.machine;
  const canPick = !!D || typeof window.showDirectoryPicker === 'function';
  let handle = null;

  async function listBrowser() {
    const out = []; try { for await (const [n, h] of handle.entries()) if (h.kind === 'file' && /\.(tap|nc|gcode)$/i.test(n)) out.push({ name: n }); } catch (e) { /* ignore */ }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function refresh() {
    let dir = null, files = [];
    if (D) { const i = await D.info(); dir = i.dir; files = i.files; }
    else if (handle) { dir = handle.name; files = await listBrowser(); }
    $('mcFolder').innerHTML = dir ? `Machine folder: <b>${esc(dir)}</b>` : (canPick ? 'No machine folder chosen yet. Press Choose folder and pick the one your DNC program watches.' : 'This browser cannot write to a folder, so Send will download the file. Use the desktop app, or Chrome / Edge, to send straight to the machine.');
    $('mcFiles').innerHTML = dir ? (files.length ? `In the folder now (${files.length}): ` + files.slice(0, 12).map((f) => esc(f.name)).join(', ') + (files.length > 12 ? ', ...' : '') : 'No .tap files in the folder yet.') : '';
    if ($('mcSetup') && !dir) $('mcSetup').open = true;
    $('mcOpen').hidden = !D || !dir;
    $('mcPick').hidden = !canPick;
  }
  async function pick() {
    if (D) { await D.choose(); await refresh(); return; }
    try { handle = await window.showDirectoryPicker({ id: 'cloudcad-machine', mode: 'readwrite' }); await hPut(handle); } catch (e) { /* cancelled */ }
    await refresh();
  }
  async function send() {
    const tap = getTap(); if (!tap) { toast('There is no G-code to send yet. Finish the drawing first.'); return; }
    const base = clean(getName());
    if (D) {
      let r = await D.send(base, tap);
      if (r.error && /No machine folder/.test(r.error)) { await pick(); r = await D.send(base, tap); }
      if (r.exists) { const c = await askReplace(`"${r.name}" is already in the machine folder.`); if (!c) return; r = await D.send(base, tap, c); }
      if (r.error) { toast(r.error); return; }
      toast(`Sent "${r.name}" to ${r.dir}. It should show on the pendant.`); await refresh(); return;
    }
    if (!handle) { if (canPick) { await pick(); } if (!handle) { fallbackDownload(); return; } }
    try {
      if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') { toast('Permission to use that folder was not given.'); return; }
      let name = base + '.tap', exists = false;
      try { await handle.getFileHandle(name); exists = true; } catch (e) { /* new file */ }
      if (exists) { const c = await askReplace(`"${name}" is already in the machine folder.`); if (!c) return; if (c === 'new') { let n = 2; for (;;) { try { await handle.getFileHandle(`${base} ${n}.tap`); n++; } catch (e) { break; } } name = `${base} ${n}.tap`; } }
      const w = await (await handle.getFileHandle(name, { create: true })).createWritable(); await w.write(tap); await w.close();
      toast(`Sent "${name}" to the ${handle.name} folder.`); await refresh();
    } catch (e) { toast('Could not send: ' + (e.message || e)); }
  }
  $('mcSend').addEventListener('click', send);
  $('mcPick').addEventListener('click', pick);
  $('mcOpen').addEventListener('click', () => D && D.open());
  hGet().then(async (h) => { if (h && !D) handle = h; await refresh(); });
  // ---- connection test (desktop app only) ----
  const P = window.cloudDesktop && window.cloudDesktop.machine && window.cloudDesktop.machine.probe;
  const mtGo = $('mtGo');
  if (mtGo) {
    if (!P) { mtGo.disabled = true; mtGo.title = 'Needs the desktop app'; $('mtOut').textContent = 'This test needs the desktop app. A web page cannot open network connections.'; }
    mtGo.addEventListener('click', async () => {
      if (!P) return;
      const out = $('mtOut'); mtGo.disabled = true; out.textContent = 'Testing... this takes up to 20 seconds.';
      try {
        const ports = ($('mtPorts').value.match(/\d+/g) || []).map(Number); if ($('mt99').checked && !ports.includes(99)) ports.push(99);
        if (!ports.length) { out.textContent = 'Type at least one door number, like 23, 29.'; return; }
        const r = await P($('mtIp').value, ports);
        if (r.error) { out.textContent = r.error; return; }
        const lines = [r.ping ? `The machine at ${r.addr} answers a ping. Good: the cable and addresses are right.` : `No answer to a ping from ${r.addr}. Check the cable, the machine is on, this computer's address (192.168.50.1) and that the old program is closed.`];
        const open = r.results.filter((x) => x.open);
        const showHello = (h) => { if (!h) return 'said nothing by itself'; const b = h.match(/../g).map((x) => parseInt(x, 16)); return 'said (hex) ' + h.replace(/(..)/g, '$1 ').trim() + ' | text: ' + b.map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join(''); };
        for (const x of r.results) lines.push(`Door ${x.port}: ${x.open ? 'OPEN, ' + showHello(x.hello) : 'closed (' + x.why + ')'}`);
        lines.push(open.length ? `Open doors: ${open.map((x) => x.port).join(', ')}. Write these down or send them to me.` : (r.ping ? 'It answers but none of these doors opened. Is the old program still connected? The machine takes one connection at a time.' : ''));
        out.innerHTML = lines.filter(Boolean).map(esc).join('<br>');
      } catch (e) { out.textContent = 'The test could not run: ' + (e && e.message ? e.message : e); }
      finally { mtGo.disabled = false; }
    });
  }

  // ---- listen-only recorder (desktop app only) ----
  const L = window.cloudDesktop && window.cloudDesktop.machine && window.cloudDesktop.machine.listen;
  const mlGo = $('mlGo'), mlStop = $('mlStop');
  if (mlGo) {
    if (!L) { mlGo.disabled = true; $('mlOut').textContent = 'Needs the desktop app.'; }
    let tick = null;
    mlStop.addEventListener('click', () => { const S = window.cloudDesktop.machine.listenStop; if (S) S(); });
    mlGo.addEventListener('click', async () => {
      if (!L) return;
      const out = $('mlOut');
      const ports = ($('mtPorts').value.match(/\d+/g) || []).map(Number);
      const secs = Number($('mlSecs').value) || 180;
      mlGo.disabled = true; mlStop.disabled = false;
      let left = Math.max(5, Math.min(600, Math.round(secs)));
      out.textContent = `Listening... ${left}s left. Go to the pedestal now.`;
      tick = setInterval(() => { left--; if (left >= 0) out.textContent = `Listening... ${left}s left. Go to the pedestal now.`; }, 1000);
      try {
        const r = await L($('mtIp').value, ports, secs);
        if (r.error) { out.textContent = r.error; return; }
        const got = r.events.filter((e) => e.kind === 'received');
        const bytes = got.reduce((n, e) => n + e.bytes, 0);
        const head = got.length ? `The machine sent ${bytes} bytes in ${got.length} pieces.` : 'The machine sent nothing while listening.';
        const where = r.file ? `A copy of the log was saved in your Documents folder: ${r.file.split(/[\\/]/).pop()}. Send me that file.` : 'Could not save the log file. Copy the text below instead.';
        out.innerHTML = esc(head + ' ' + where) + '<pre style="white-space:pre-wrap;max-height:260px;overflow:auto;margin:6px 0 0">' + esc(r.log) + '</pre>';
      } catch (e) { out.textContent = 'Could not listen: ' + (e && e.message ? e.message : e); }
      finally { clearInterval(tick); mlGo.disabled = false; mlStop.disabled = true; }
    });
  }

  return { refresh, send };
}
