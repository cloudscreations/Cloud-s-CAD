// Runs the built-in slicer in its own process so it can be stopped. GPL v3 (CuraEngine inside is AGPL-3.0)
const { CuraWASM } = require('cura-wasm');
const { resolveDefinition } = require('cura-wasm-definitions');
process.parentPort.once('message', async (e) => {
  const { stl, settings } = e.data;
  try {
    const overrides = (settings || []).map((o) => ({ scope: null, key: String(o.key), value: String(o.value) }));
    const slicer = new CuraWASM({ definition: resolveDefinition('creality_ender3'), overrides, verbose: false });
    slicer.on('progress', (p) => process.parentPort.postMessage({ progress: p }));
    const ab = Uint8Array.from(stl).buffer;
    const r = await slicer.slice(ab, 'stl');
    process.parentPort.postMessage({ ok: true, gcode: Buffer.from(r.gcode).toString('utf8') });
  } catch (err) { process.parentPort.postMessage({ ok: false, log: (err && err.message) || String(err) }); }
  process.exit(0);
});
