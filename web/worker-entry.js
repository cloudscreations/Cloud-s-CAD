// Cloud's CAD - background worker for the solid-modelling engine, so the window never freezes. License: GPL v3
import ManifoldModule from 'manifold-3d';
import * as S from './solids.js';
import * as P from './printcheck.js';
const API = { ...S, ...P };
self.onmessage = async (e) => {
  const m = e.data;
  if (m.init) { S.setKernelLoader(async () => { const w = await ManifoldModule({ wasmBinary: m.wasm }); w.setup(); return w; }); self.postMessage({ ready: true }); return; }
  try { const r = await API[m.fn](...m.args); self.postMessage({ id: m.id, ok: true, r }); }
  catch (err) { self.postMessage({ id: m.id, ok: false, e: (err && err.message) || String(err) }); }
};
