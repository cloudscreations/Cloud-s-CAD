// DWG -> DXF text using LibreDWG (GPL-3.0, WebAssembly), fully offline.
// The wasm file is stored gzip-compressed inside the page and only unpacked when a .dwg is opened.
import { LibreDwg, createModule } from '@mlightcad/libredwg-web';

let libP = null;
async function wasmBytes() {
  const el = document.getElementById('dwgWasm');
  if (!el) throw new Error('The DWG reader is not included in this copy of the app.');
  const bin = atob(el.textContent.trim());
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function lib() {
  if (!libP) {
    libP = (async () => {
      const wasmBinary = await wasmBytes();
      return LibreDwg.createByWasmInstance(await createModule({ wasmBinary }));
    })();
    libP.catch(() => { libP = null; });
  }
  return libP;
}

export async function dwgToDxfText(arrayBuffer) {
  let l;
  try { l = await lib(); }
  catch (e) {
    throw new Error('This device could not start the DWG reader (' + (e.message || e) + '). On a phone, open the file on a PC, or save it as DXF from AutoCAD (File > Save As > DXF).');
  }
  const bytes = new Uint8Array(arrayBuffer);
  const head = String.fromCharCode(...bytes.slice(0, 6));
  if (!/^AC10/.test(head)) throw new Error('That does not look like a DWG file.');
  const out = l.dwg_write_dxf(arrayBuffer);
  if (!out || !out.length) throw new Error('Could not read that DWG. Try saving it as DXF from your CAD program (an older DXF version such as 2007 or 2000 works best).');
  return new TextDecoder('utf-8').decode(out);
}
