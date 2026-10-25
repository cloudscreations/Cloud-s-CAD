import http from 'node:http';
import { SerialPrinter, Moonraker, OctoPrint, browserHttp } from './printer.js';
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- a pretend Marlin printer on the other end of the USB cable
class MockMarlin {
  constructor() { this.rx = []; this.unacked = 0; this.maxUnacked = 0; this.cb = () => {}; this.target = { h: 0, b: 0 }; this.temp = { h: 21, b: 20 }; this.out = []; this.stall = false; this.closed = false; this.pos = { x: 0, y: 0, z: 0 }; }
  onData(fn) { this.cb = fn; setTimeout(() => this.cb('start\necho:Marlin 2.0.9\n'), 5); }
  async write(s) {
    for (const line of s.split('\n').filter(Boolean)) {
      this.rx.push(line); this.unacked++; this.maxUnacked = Math.max(this.maxUnacked, this.unacked);
      this.q = (this.q || Promise.resolve()).then(async () => {
        while (this.stall) await sleep(5);
        await sleep(1);
        const m = /^M104 S(\d+)/.exec(line), b = /^M140 S(\d+)/.exec(line);
        if (m) this.target.h = +m[1]; if (b) this.target.b = +b[1];
        let reply = 'ok';
        if (/^M105/.test(line)) reply = `ok T:${this.temp.h.toFixed(1)} /${this.target.h.toFixed(1)} B:${this.temp.b.toFixed(1)} /${this.target.b.toFixed(1)} @:0 B@:0`;
        if (/^M109|^M190/.test(line)) { this.temp.h = this.target.h || this.temp.h; this.temp.b = this.target.b || this.temp.b; }
        if (/^G1 .*X(-?[\d.]+)/.test(line)) this.pos.x = +/X(-?[\d.]+)/.exec(line)[1];
        this.unacked--; this.cb(reply + '\n');
      });
    }
  }
  async close() { this.closed = true; }
}
{
  const mm = new MockMarlin(), logs = [];
  const p = new SerialPrinter(mm, { log: (d, l) => logs.push(d + l), pollMs: 50 });
  let last = null; p.onChange = (s) => { last = s; };
  p.bannerMs = 100;
  await p.connect();
  ok('connects and goes idle', p.state === 'idle', p.state);
  await p.send('M104 S200'); await p.send('M140 S60');
  await sleep(120);
  ok('reads temperatures and targets from M105 replies', p.temps.hotendTarget === 200 && p.temps.bedTarget === 60 && Math.abs(p.temps.hotend - 21) < 1, JSON.stringify(p.temps));
  await p.jog('x', 10, 3000);
  ok('jog sends relative move then back to absolute', mm.rx.slice(-3).join('|') === 'G91|G1 X10 F3000|G90', mm.rx.slice(-3).join('|'));
  await p.home('xy'); ok('home with axes', mm.rx.at(-1) === 'G28 X Y');
  // a print: 300 moves
  const g = ['; comment', 'G28', ...Array.from({ length: 300 }, (_, i) => `G1 X${i} Y${i} E${i * 0.1} F1200 ; c`), 'M84'].join('\n');
  mm.rx = []; mm.maxUnacked = 0;
  p.startPrint(g, 'cube.gcode');
  ok('state is printing after start', p.state === 'printing');
  for (let i = 0; i < 400 && p.state === 'printing'; i++) await sleep(5);
  ok('print finished and returned to idle', p.state === 'idle' && p.job.finished, p.state);
  { const f = mm.rx.filter((l) => !/^M105/.test(l)); ok('every line was sent in order, comments stripped', f.length === 302 && f[0] === 'G28' && f[1] === 'G1 X0 Y0 E0 F1200' && f.at(-1) === 'M84'); }
  ok('never more than 4 lines in the printer buffer at once', mm.maxUnacked <= 4 + 1, String(mm.maxUnacked));
  // pause / resume
  mm.rx = [];
  p.startPrint(g, 'cube2.gcode');
  await sleep(40); p.pause();
  await sleep(60); const cnt = () => mm.rx.filter((l) => !/^M105/.test(l)).length; const n1 = cnt(); await sleep(80);
  ok('pause stops sending new lines', p.state === 'paused' && cnt() === n1 && n1 < 300, `${n1}`);
  p.resume();
  for (let i = 0; i < 400 && p.state !== 'idle'; i++) await sleep(5);
  ok('resume finishes the job', p.state === 'idle' && p.job.finished);
  // cancel
  mm.rx = [];
  p.startPrint(g, 'cube3.gcode'); await sleep(30);
  await p.cancel();
  ok('cancel turns heaters and fan off and stops', p.state === 'idle' && ['M104 S0', 'M140 S0', 'M107'].every((c) => mm.rx.includes(c)));
  const sentBefore = mm.rx.length; await sleep(60);
  ok('nothing more from the old job after cancel', mm.rx.filter((l) => /^G1 X/.test(l)).length < 300 && mm.rx.length - sentBefore < 3);
  // a second print cannot start over a running one
  p.startPrint(g, 'a'); let threw = false; try { p.startPrint(g, 'b'); } catch (e) { threw = true; }
  ok('refuses to start a second print while one is running', threw); await p.cancel();
  // emergency stop
  p.emergencyStop();
  ok('emergency stop writes M112 and blocks everything after', mm.rx.at(-1) === 'M112' && p.state === 'error');
  let rej = false; await p.send('G28').catch(() => { rej = true; }); ok('commands are refused after an emergency stop', rej);
  await p.disconnect(); ok('disconnect closes the port', mm.closed && p.state === 'disconnected');
}
{ // a firmware fatal error stops the job
  const mm = new MockMarlin(); const p = new SerialPrinter(mm, { pollMs: 1000 }); p.bannerMs = 50; await p.connect();
  p.startPrint(Array.from({ length: 100 }, (_, i) => `G1 X${i}`).join('\n'));
  await sleep(10); mm.cb('Error:Printer halted. kill() called!\n'); await sleep(20);
  ok('firmware "halted" error stops the print and shows the error', p.state === 'error' && /halted/.test(p.status().error));
}
{ // a printer that pauses (heating) holds the stream and does not overflow
  const mm = new MockMarlin(); const p = new SerialPrinter(mm, { pollMs: 1000 }); p.bannerMs = 50; await p.connect();
  mm.stall = true; mm.rx = []; mm.maxUnacked = 0;
  p.startPrint(Array.from({ length: 50 }, (_, i) => `G1 X${i}`).join('\n'));
  await sleep(60);
  ok('while the printer is busy only 4 lines are outstanding', mm.rx.length <= 4, String(mm.rx.length));
  mm.stall = false; for (let i = 0; i < 300 && p.state !== 'idle'; i++) await sleep(5);
  ok('then the rest flows once it catches up', p.state === 'idle' && mm.rx.length === 50);
}

// ---------------- network printers
async function startServer(handler) {
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x');
    let form = null;
    if ((req.headers['content-type'] || '').startsWith('multipart/')) { const r = new Response(body, { headers: { 'content-type': req.headers['content-type'] } }); form = await r.formData(); }
    const out = handler({ method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, json: /json/.test(req.headers['content-type'] || '') ? JSON.parse(body.toString() || 'null') : null, form });
    res.writeHead(out.status || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: `127.0.0.1:${srv.address().port}` };
}
{
  const log = [];
  const { srv, url } = await startServer((q) => {
    log.push(q);
    if (q.path === '/printer/info') return { body: { result: { state: 'ready', hostname: 'ender' } } };
    if (q.path === '/printer/objects/query') return { body: { result: { status: { extruder: { temperature: 201.3, target: 205 }, heater_bed: { temperature: 59.8, target: 60 }, print_stats: { state: 'printing', filename: 'cube.gcode' }, virtual_sdcard: { progress: 0.42 }, display_status: {} } } } };
    if (q.path === '/server/files/upload') return { body: { result: 'ok', item: { path: q.form.get('file').name } } };
    return { body: { result: 'ok' } };
  });
  const k = new Moonraker(url, browserHttp());
  const info = await k.connect(); ok('moonraker connects', info.hostname === 'ender');
  const st = await k.status(); ok('moonraker status: printing 42%, temps', st.state === 'printing' && Math.abs(st.progress - 0.42) < 1e-9 && st.temps.hotendTarget === 205 && st.file === 'cube.gcode', JSON.stringify(st));
  await k.upload('cube.gcode', 'G28\nM84\n', { print: true });
  const up = log.find((l) => l.path === '/server/files/upload');
  ok('moonraker upload sends the file and print flag', up.form.get('file').name === 'cube.gcode' && (await up.form.get('file').text()) === 'G28\nM84\n' && up.form.get('print') === 'true' && up.form.get('root') === 'gcodes');
  await k.start('a b.gcode'); ok('moonraker start encodes the name', log.at(-1).path === '/printer/print/start' && log.at(-1).query.get('filename') === 'a b.gcode');
  await k.pause(); await k.resume(); await k.cancel(); await k.emergencyStop();
  ok('moonraker pause/resume/cancel/emergency endpoints', ['/printer/print/pause', '/printer/print/resume', '/printer/print/cancel', '/printer/emergency_stop'].every((p, i) => log.at(-4 + i).path === p));
  await k.jog('x', 5); ok('moonraker jog is relative and restores absolute', /G91\nG1 X5 F3000\nG90/.test(log.at(-1).query.get('script')));
  await k.setHotend(200); ok('moonraker heater command', log.at(-1).query.get('script') === 'M104 S200');
  srv.close();
  const k2 = new Moonraker('127.0.0.1:1', browserHttp()); let err = ''; await k2.connect().catch((e) => { err = e.message; });
  ok('unreachable printer gives an error, not a hang', /fetch failed|ECONNREFUSED|failed/i.test(err), err);
}
{
  const log = [];
  const { srv, url } = await startServer((q) => {
    log.push(q);
    if (q.headers['x-api-key'] !== 'SECRET') return { status: 403, body: { error: 'bad key' } };
    if (q.path === '/api/version') return { body: { server: '1.9.0' } };
    if (q.path === '/api/printer') return { body: { temperature: { tool0: { actual: 210, target: 215 }, bed: { actual: 60, target: 60 } } } };
    if (q.path === '/api/job') return q.method === 'GET' ? { body: { state: 'Printing', progress: { completion: 12.5 }, job: { file: { name: 'x.gcode' } } } } : { status: 204, body: {} };
    return { status: 200, body: {} };
  });
  const o = new OctoPrint(url, browserHttp(), { apiKey: 'SECRET' });
  await o.connect(); const st = await o.status();
  ok('octoprint status mapped', st.state === 'printing' && Math.abs(st.progress - 0.125) < 1e-9 && st.temps.hotend === 210 && st.temps.bedTarget === 60 && st.file === 'x.gcode', JSON.stringify(st));
  await o.upload('x.gcode', 'G28\n', { print: false });
  const up = log.find((l) => l.path === '/api/files/local'); ok('octoprint upload multipart', up.form.get('file').name === 'x.gcode' && up.form.get('print') === 'false');
  await o.start(); ok('octoprint start job', log.at(-1).json.command === 'start');
  await o.pause(); ok('octoprint pause', log.at(-1).json.action === 'pause');
  await o.jog('z', 2); ok('octoprint jog', log.at(-1).json.command === 'jog' && log.at(-1).json.z === 2);
  await o.setBed(60); ok('octoprint bed target', log.at(-1).json.target === 60);
  const bad = new OctoPrint(url, browserHttp(), { apiKey: 'nope' }); let e2 = ''; await bad.connect().catch((e) => { e2 = e.message; });
  ok('wrong API key is reported clearly', /403/.test(e2), e2);
  let e3 = ''; await new OctoPrint(url, browserHttp(), {}).connect().catch((e) => { e3 = e.message; });
  ok('missing API key explained', /API key/.test(e3));
  srv.close();
}
console.log(fail ? `\n${fail} FAILED` : '\nALL PRINTER TESTS PASSED'); process.exit(fail ? 1 : 0);
