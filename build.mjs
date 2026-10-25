import { build } from 'esbuild';
import fs from 'fs';

const r = await build({ entryPoints: ['app.js'], bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2019', inject: ['./buffer-shim.js'], alias: { 'browserify-aes/browser.js': './stub-aes.js', 'create-hash': './stub-hash.js' }, external: ['module', 'node:module', 'node:fs', 'node:path', 'node:url', 'fs', 'path', 'url'], define: { global: 'globalThis', 'import.meta.url': '"http://localhost/dwg.js"' } });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
import zlib from 'zlib';
const wr = await build({ entryPoints: ['worker-entry.js'], bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2019', inject: ['./buffer-shim.js'], external: ['module', 'node:module', 'node:fs', 'node:path', 'node:url', 'fs', 'path', 'url'], define: { global: 'globalThis', 'import.meta.url': '"http://localhost/w.js"' } });
const workerB64 = Buffer.from(wr.outputFiles[0].text).toString('base64');
const wasmB64 = zlib.gzipSync(fs.readFileSync('node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm'), { level: 9 }).toString('base64');
const mfB64 = zlib.gzipSync(fs.readFileSync('node_modules/manifold-3d/manifold.wasm'), { level: 9 }).toString('base64');
const html = fs.readFileSync('template.html', 'utf8').replace('/*APP*/', () => js).replace('<!--DWGWASM-->', () => '<script type="application/octet-stream" id="dwgWasm">' + wasmB64 + '</script><script type="application/octet-stream" id="mfWasm">' + mfB64 + '</script><script type="application/octet-stream" id="mfWorker">' + workerB64 + '</script>');
fs.writeFileSync('../clouds-cad.html', html);
// installable phone/tablet version (same app; opens in the phone layout; works offline after the first visit)
const ver = Date.now().toString(36);
fs.mkdirSync('../mobile', { recursive: true });
const headTag = '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png"><script>window.CLOUD_MOBILE_DEFAULT=true</script>';
const swTag = '<script>if("serviceWorker"in navigator&&location.protocol.startsWith("http"))addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})})</script>';
const hi = html.indexOf('</head>'), bi = html.lastIndexOf('</body>');
const mob = html.slice(0, hi) + headTag + html.slice(hi, bi) + swTag + html.slice(bi);
fs.writeFileSync('../mobile/index.html', mob);
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'firebase.json']) fs.copyFileSync('pwa/' + f, '../mobile/' + f);
fs.writeFileSync('../mobile/sw.js', fs.readFileSync('pwa/sw.js', 'utf8').replace('__VERSION__', 'cloudscad-' + ver));
console.log('built ../clouds-cad.html', (html.length / 1024).toFixed(0) + ' KB');
