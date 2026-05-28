// Минификация public/js/*.js на месте: для прода (Vercel buildCommand).
// Используется esbuild — быстрый и без bundling (сохраняет import-пути для ES-модулей).
import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/js';
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

const beforeTotal = files.reduce((s, f) => s + statSync(join(dir, f)).size, 0);

await Promise.all(files.map((f) => {
  const p = join(dir, f);
  return build({
    entryPoints: [p],
    outfile: p,
    minify: true,
    allowOverwrite: true,
    format: 'esm',
    target: 'es2020',
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'error',
  });
}));

const afterTotal = files.reduce((s, f) => s + statSync(join(dir, f)).size, 0);
const kb = (n) => (n / 1024).toFixed(1);
console.log(`[minify] ${files.length} файлов: ${kb(beforeTotal)} КБ → ${kb(afterTotal)} КБ (${Math.round((1 - afterTotal / beforeTotal) * 100)}% меньше)`);
