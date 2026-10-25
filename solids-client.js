// Cloud's CAD - talks to the background worker (or runs directly where there is no worker, like in tests). License: GPL v3
import * as S from './solids.js';
import * as P from './printcheck.js';
const API = { ...S, ...P };
let worker = null, ready = null, pending = new Map(), nid = 1, broken = false;

function hasWorker() { return !broken && typeof Worker !== 'undefined' && typeof document !== 'undefined' && !!document.getElementById('mfWorker'); }
function start() {
  if (ready) return ready;
  ready = (async () => {
    const src = atob(document.getElementById('mfWorker').textContent.trim());
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    const wasm = await S.getWasmBytes();
    await new Promise((res, rej) => {
      w.onmessage = (e) => { if (e.data.ready) res(); };
      w.onerror = (e) => rej(new Error('worker failed'));
      w.postMessage({ init: true, wasm }, [wasm.buffer]);
    });
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data.r) : p.rej(new Error(e.data.e)); };
    w.onerror = () => { for (const p of pending.values()) p.rej(new Error('The 3D engine stopped. Try again.')); pending.clear(); };
    worker = w;
  })();
  ready.catch(() => { broken = true; ready = null; });
  return ready;
}
async function call(fn, ...args) {
  if (hasWorker()) {
    try { await start(); } catch (e) { return API[fn](...args); }
    if (worker) return new Promise((res, rej) => { const id = nid++; pending.set(id, { res, rej }); worker.postMessage({ id, fn, args }); });
  }
  return API[fn](...args);
}
// Stops whatever the engine is doing right now (the engine restarts on the next request)
export function cancelWork() {
  if (worker) { worker.terminate(); worker = null; ready = null; }
  for (const p of pending.values()) p.rej(new Error('Cancelled.'));
  pending.clear();
}
export const revolveLoops = (...a) => call('revolveLoops', ...a);
export const sweepLoops = (...a) => call('sweepLoops', ...a);
export const loftLoops = (...a) => call('loftLoops', ...a);
export const roundEdges = (...a) => call('roundEdges', ...a);
export const chamferEdges = (...a) => call('chamferEdges', ...a);
export const shellModel = (...a) => call('shellModel', ...a);
export const offsetModel = (...a) => call('offsetModel', ...a);
export const addHole = (...a) => call('addHole', ...a);
export const combineModels = (...a) => call('combineModels', ...a);
export const repairModel = (...a) => call('repairModel', ...a);
export const runChecks = (...a) => call('runChecks', ...a);
