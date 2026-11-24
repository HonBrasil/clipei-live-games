// Gera a prévia interativa como UM arquivo HTML (JS, CSS e logo embutidos).
// Uso: npm run build:demo   →   dist-demo/index.html
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps/web');

const result = await build({
  entryPoints: [resolve(web, 'src/demo.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: 'out',
  loader: { '.png': 'dataurl' },
  logLevel: 'warning',
});

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;

let html = readFileSync(resolve(web, 'demo.html'), 'utf8');
html = html.replace('</head>', `<style>${css}</style>\n  </head>`);
html = html.replace(/<script type="module" src="\/src\/demo.ts"><\/script>/, () => `<script>${js}</script>`);

const outDir = resolve(root, 'dist-demo');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'index.html'), html);
console.log(`dist-demo/index.html  ${(html.length / 1024).toFixed(0)} KB`);
