import { build } from 'esbuild';
await build({ entryPoints: ['server.mjs'], bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile: 'dist/clouds-cad-mcp.mjs', banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" }, logLevel: 'info' });
