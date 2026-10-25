// Cloud's CAD - talking to 3D printers. License: GPL v3
//  - SerialPrinter: Marlin-style firmware over USB (Web Serial in Chrome, Edge and the desktop app)
//  - Moonraker (Klipper) and OctoPrint over the network
// Every class takes its connection as an argument, so it can be tested without hardware.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================ USB serial (Marlin and similar)
// transport: { write(text): Promise, close(): Promise, onData(fn) }   fn(text) is called with incoming text
export class SerialPrinter {
  constructor(transport, { log = () => {}, window = 4, pollMs = 3000 } = {}) {
    this.t = transport; this.log = log; this.printWindow = window; this.maxInflight = 1; this.pollMs = pollMs;
    this.buf = ''; this.waiting = []; this.pending = []; this.queue = [];
    this.temps = { hotend: 0, hotendTarget: 0, bed: 0, bedTarget: 0 };
    this.state = 'disconnected'; this.job = null; this.onChange = () => {}; this.halted = false; this.lastError = null;
    this.t.onData((s) => this._data(s));
  }
  async connect() {
    this.state = 'connecting';
    // many boards reset when the port opens: wait for a banner, but do not insist on one
    await Promise.race([this._waitFor(/start|Marlin|ok/i), sleep(this.bannerMs ?? 2500)]);
    this.state = 'idle'; this._change();
    await this.send('M115').catch(() => {});
    await this.send('M105').catch(() => {});
    this._poll();
  }
  _change() { try { this.onChange(this.status()); } catch (e) { /* ui only */ } }
  _waitFor(re) { return new Promise((res) => this.waiting.push({ re, res })); }
  _data(s) {
    this.buf += s;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).replace(/\r/g, '').trim(); this.buf = this.buf.slice(i + 1); if (line) this._line(line); }
  }
  _line(l) {
    this.log('<', l);
    this.waiting = this.waiting.filter((w) => { if (w.re.test(l)) { w.res(l); return false; } return true; });
    const t = /T:\s*(-?[\d.]+)\s*(?:\/\s*(-?[\d.]+))?/.exec(l), b = /B:\s*(-?[\d.]+)\s*(?:\/\s*(-?[\d.]+))?/.exec(l);
    if (t) { this.temps.hotend = +t[1]; if (t[2] !== undefined) this.temps.hotendTarget = +t[2]; }
    if (b) { this.temps.bed = +b[1]; if (b[2] !== undefined) this.temps.bedTarget = +b[2]; }
    if (/^(Error|!!)/i.test(l)) {
      this.lastError = l;
      if (/!!|Halted|kill\(\)/i.test(l)) { this.halted = true; this.state = 'error'; this._dropAll(new Error(l)); }
    }
    if (/^ok\b/i.test(l)) { const it = this.pending.shift(); if (it) it.resolve(); this._pump(); }
    if (t || b || /^ok\b/i.test(l)) this._change();
  }
  _dropAll(err) { for (const it of this.queue.concat(this.pending)) it.reject(err); this.queue = []; this.pending = []; if (this.job) this.job.done = true; }
  // queue one command; the promise resolves when the printer answers "ok" to it
  send(line, { priority = false } = {}) {
    if (this.halted) return Promise.reject(new Error('The printer reported a fatal error. Reset it, then connect again.'));
    return new Promise((resolve, reject) => {
      const item = { line: String(line).trim(), resolve, reject };
      if (priority) this.queue.unshift(item); else this.queue.push(item);
      this._pump();
    });
  }
  _fillJob() {
    const j = this.job;
    while (j && !j.done && !j.paused && j.next < j.lines.length && this.pending.length + this.queue.length < this.maxInflight) this.queue.push({ line: j.lines[j.next++], resolve() {}, reject() {} });
  }
  _pump() {
    this._fillJob();
    while (this.queue.length && this.pending.length < this.maxInflight && !this.halted) {
      const it = this.queue.shift();
      this.pending.push(it);
      this.log('>', it.line);
      this.t.write(it.line + '\n').catch((e) => it.reject(e));
      this._fillJob();
    }
    const j = this.job;
    if (j && !j.done && j.next >= j.lines.length && !this.pending.length && !this.queue.length) { j.done = true; j.finished = true; this.maxInflight = 1; this.state = 'idle'; this._change(); }
  }
  startPrint(gcodeText, name = 'print') {
    if (this.halted) throw new Error('The printer reported a fatal error. Reset it, then connect again.');
    if (this.job && !this.job.done) throw new Error('A print is already running.');
    const lines = String(gcodeText).split(/\r?\n/).map((l) => l.split(';')[0].trim()).filter(Boolean);
    this.job = { name, lines, next: 0, paused: false, done: false, started: Date.now() };
    this.maxInflight = this.printWindow; this.state = 'printing'; this._change();
    this._pump();
  }
  pause() { if (this.job && !this.job.done && !this.job.paused) { this.job.paused = true; this.state = 'paused'; this._change(); } }
  resume() { if (this.job && this.job.paused) { this.job.paused = false; this.state = 'printing'; this._change(); this._pump(); } }
  async cancel() {
    if (this.job) { this.job.done = true; this.job.cancelled = true; }
    this.queue = []; this.maxInflight = 1; this.state = 'idle'; this._change();
    const done = [];
    for (const c of ['M104 S0', 'M140 S0', 'M107', 'G91', 'G1 Z5 F600', 'G90', 'M84 X Y E']) done.push(this.send(c).catch(() => {}));
    await Promise.all(done);
  }
  emergencyStop() {
    this.t.write('M112\n').catch(() => {});
    this.halted = true; this.state = 'error'; this._dropAll(new Error('Emergency stop')); this._change();
  }
  // ---- everyday commands
  home(axes = '') { return this.send('G28' + (axes ? ' ' + axes.toUpperCase().split('').join(' ') : '')); }
  async jog(axis, mm, feed = 3000) { await this.send('G91'); await this.send(`G1 ${axis.toUpperCase()}${mm} F${feed}`); return this.send('G90'); }
  setHotend(c) { return this.send('M104 S' + Math.max(0, Math.min(300, Math.round(c)))); }
  setBed(c) { return this.send('M140 S' + Math.max(0, Math.min(130, Math.round(c)))); }
  async extrude(mm, feed = 150) { await this.send('M83'); return this.send(`G1 E${mm} F${feed}`); }
  fan(percent) { return percent > 0 ? this.send('M106 S' + Math.round((percent / 100) * 255)) : this.send('M107'); }
  motorsOff() { return this.send('M84'); }
  async heatOff() { await this.send('M104 S0'); return this.send('M140 S0'); }
  _poll() {
    clearInterval(this._timer);
    this._timer = setInterval(() => { if (this.state !== 'disconnected' && !this.halted && !this.pending.length && !this.queue.length) this.send('M105').catch(() => {}); }, this.pollMs);
  }
  status() {
    const j = this.job;
    return { kind: 'serial', state: this.state, temps: { ...this.temps }, progress: j && j.lines.length ? j.next / j.lines.length : 0, file: j ? j.name : null, error: this.lastError };
  }
  async disconnect() { clearInterval(this._timer); this.state = 'disconnected'; this._change(); try { await this.t.close(); } catch (e) { /* already closed */ } }
}

// ============================================================ the real USB port (Web Serial)
export async function openWebSerial(baud = 115200, filters = []) {
  if (!('serial' in navigator)) throw new Error('This browser has no USB serial support. Use Chrome or Edge, or the Cloud\'s CAD desktop app.');
  const port = await navigator.serial.requestPort({ filters });
  await port.open({ baudRate: baud });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const writer = port.writable.getWriter(), reader = port.readable.getReader();
  let cb = () => {}, open = true;
  (async () => { try { while (open) { const { value, done } = await reader.read(); if (done) break; if (value) cb(dec.decode(value)); } } catch (e) { /* closed */ } })();
  return {
    onData: (fn) => { cb = fn; },
    write: (s) => writer.write(enc.encode(s)),
    close: async () => { open = false; try { await reader.cancel(); } catch (e) { /* */ } try { writer.releaseLock(); reader.releaseLock(); await port.close(); } catch (e) { /* */ } },
  };
}

// ============================================================ network printers
// http({method, url, headers, json, form}) -> { status, json, text }.  form = { fields:{k:v}, file:{field,name,text} }
export function browserHttp() {
  return async ({ method = 'GET', url, headers = {}, json, form }) => {
    let body;
    const h = { ...headers };
    if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    if (form) { body = new FormData(); for (const [k, v] of Object.entries(form.fields || {})) body.append(k, v); if (form.file) body.append(form.file.field || 'file', new Blob([form.file.text], { type: 'text/plain' }), form.file.name); }
    const res = await fetch(url, { method, headers: h, body });
    const text = await res.text();
    let js = null; try { js = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json: js, text };
  };
}
const need = (r, what) => { if (r.status >= 400 || r.status === 0) throw new Error(`${what} failed (HTTP ${r.status}${r.text ? ': ' + String(r.text).slice(0, 120) : ''})`); return r; };
const trimUrl = (u) => { u = String(u).trim().replace(/\/+$/, ''); return /^https?:\/\//.test(u) ? u : 'http://' + u; };

export class Moonraker {
  constructor(base, http, { apiKey = '' } = {}) { this.base = trimUrl(base); this.http = http; this.key = apiKey; }
  _h() { return this.key ? { 'X-Api-Key': this.key } : {}; }
  _get(p) { return this.http({ method: 'GET', url: this.base + p, headers: this._h() }); }
  _post(p, extra = {}) { return this.http({ method: 'POST', url: this.base + p, headers: this._h(), ...extra }); }
  async connect() { const r = need(await this._get('/printer/info'), 'Connecting'); return r.json && r.json.result; }
  async status() {
    const q = 'extruder&heater_bed&print_stats&virtual_sdcard&display_status';
    const o = need(await this._get('/printer/objects/query?' + q), 'Status').json.result.status;
    const ps = o.print_stats || {};
    return {
      kind: 'moonraker', state: ps.state === 'printing' ? 'printing' : ps.state === 'paused' ? 'paused' : ps.state === 'error' ? 'error' : 'idle',
      temps: { hotend: o.extruder ? o.extruder.temperature : 0, hotendTarget: o.extruder ? o.extruder.target : 0, bed: o.heater_bed ? o.heater_bed.temperature : 0, bedTarget: o.heater_bed ? o.heater_bed.target : 0 },
      progress: o.virtual_sdcard ? o.virtual_sdcard.progress || 0 : 0, file: ps.filename || null, error: ps.message || null,
    };
  }
  async upload(name, text, { print = false } = {}) {
    need(await this._post('/server/files/upload', { form: { fields: { root: 'gcodes', print: print ? 'true' : 'false' }, file: { field: 'file', name, text } } }), 'Upload');
    return name;
  }
  start(name) { return this._post('/printer/print/start?filename=' + encodeURIComponent(name)).then((r) => need(r, 'Start')); }
  pause() { return this._post('/printer/print/pause').then((r) => need(r, 'Pause')); }
  resume() { return this._post('/printer/print/resume').then((r) => need(r, 'Resume')); }
  cancel() { return this._post('/printer/print/cancel').then((r) => need(r, 'Cancel')); }
  emergencyStop() { return this._post('/printer/emergency_stop').then((r) => need(r, 'Emergency stop')); }
  gcode(script) { return this._post('/printer/gcode/script?script=' + encodeURIComponent(script)).then((r) => need(r, 'Command')); }
  home(axes = '') { return this.gcode('G28' + (axes ? ' ' + axes.toUpperCase().split('').join(' ') : '')); }
  async jog(axis, mm, feed = 3000) { return this.gcode(`G91\nG1 ${axis.toUpperCase()}${mm} F${feed}\nG90`); }
  setHotend(c) { return this.gcode('M104 S' + Math.round(c)); }
  setBed(c) { return this.gcode('M140 S' + Math.round(c)); }
  heatOff() { return this.gcode('M104 S0\nM140 S0'); }
  fan(p) { return this.gcode(p > 0 ? 'M106 S' + Math.round((p / 100) * 255) : 'M107'); }
  motorsOff() { return this.gcode('M84'); }
  async disconnect() {}
}

export class OctoPrint {
  constructor(base, http, { apiKey = '' } = {}) { this.base = trimUrl(base); this.http = http; this.key = apiKey; }
  _h() { return { 'X-Api-Key': this.key }; }
  _get(p) { return this.http({ method: 'GET', url: this.base + p, headers: this._h() }); }
  _post(p, extra = {}) { return this.http({ method: 'POST', url: this.base + p, headers: this._h(), ...extra }); }
  async connect() { if (!this.key) throw new Error('OctoPrint needs its API key (OctoPrint > Settings > API).'); const r = need(await this._get('/api/version'), 'Connecting'); return r.json; }
  async status() {
    const pr = await this._get('/api/printer');
    const job = need(await this._get('/api/job'), 'Status').json;
    const t = pr.status < 400 && pr.json && pr.json.temperature ? pr.json.temperature : {};
    const st = (job.state || '').toLowerCase();
    return {
      kind: 'octoprint', state: /printing/.test(st) ? 'printing' : /paus/.test(st) ? 'paused' : /error/.test(st) ? 'error' : /offline/.test(st) ? 'disconnected' : 'idle',
      temps: { hotend: t.tool0 ? t.tool0.actual : 0, hotendTarget: t.tool0 ? t.tool0.target : 0, bed: t.bed ? t.bed.actual : 0, bedTarget: t.bed ? t.bed.target : 0 },
      progress: job.progress && job.progress.completion != null ? job.progress.completion / 100 : 0, file: job.job && job.job.file ? job.job.file.name : null, error: null,
    };
  }
  async upload(name, text, { print = false } = {}) {
    need(await this._post('/api/files/local', { form: { fields: { select: 'true', print: print ? 'true' : 'false' }, file: { field: 'file', name, text } } }), 'Upload');
    return name;
  }
  async start() { return need(await this._post('/api/job', { json: { command: 'start' } }), 'Start'); }
  pause() { return this._post('/api/job', { json: { command: 'pause', action: 'pause' } }).then((r) => need(r, 'Pause')); }
  resume() { return this._post('/api/job', { json: { command: 'pause', action: 'resume' } }).then((r) => need(r, 'Resume')); }
  cancel() { return this._post('/api/job', { json: { command: 'cancel' } }).then((r) => need(r, 'Cancel')); }
  async emergencyStop() { return need(await this._post('/api/printer/command', { json: { commands: ['M112'] } }), 'Emergency stop'); }
  gcode(cmds) { return this._post('/api/printer/command', { json: { commands: [].concat(cmds) } }).then((r) => need(r, 'Command')); }
  home(axes = '') { return this._post('/api/printer/printhead', { json: { command: 'home', axes: (axes || 'xyz').toLowerCase().split('') } }).then((r) => need(r, 'Home')); }
  jog(axis, mm, feed = 3000) { return this._post('/api/printer/printhead', { json: { command: 'jog', [axis.toLowerCase()]: mm, speed: feed } }).then((r) => need(r, 'Move')); }
  setHotend(c) { return this._post('/api/printer/tool', { json: { command: 'target', targets: { tool0: Math.round(c) } } }).then((r) => need(r, 'Heat')); }
  setBed(c) { return this._post('/api/printer/bed', { json: { command: 'target', target: Math.round(c) } }).then((r) => need(r, 'Heat')); }
  heatOff() { return this.gcode(['M104 S0', 'M140 S0']); }
  fan(p) { return this.gcode(p > 0 ? 'M106 S' + Math.round((p / 100) * 255) : 'M107'); }
  motorsOff() { return this.gcode('M84'); }
  async disconnect() {}
}
