// Минификация public/js/*.js на месте: для прода (Vercel buildCommand).
// Используется esbuild — быстрый и без bundling (сохраняет import-пути для ES-модулей).
import { build } from 'esbuild';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// Версия = ХЕШ СОДЕРЖИМОГО фронта (js+css+html), НЕ timestamp. Почему:
// daily-run автоматика коммитит ~5-10 раз в час (docs/diag-эндпоинты) — с
// timestamp'ом каждый деплой давал новый sw.js → браузер каждый раз показывал
// «Доступно обновление», хотя фронт не менялся. С хешем sw.js меняется ТОЛЬКО
// при реальных правках фронта, баннер появляется только когда действительно надо.
import { createHash } from 'node:crypto';
const HASH_DIRS = ['public/js', 'public/css'];
const HASH_FILES = ['public/index.html', 'public/manifest.webmanifest'];
const hashInput = createHash('sha256');
const hashPaths = [];
for (const dir of HASH_DIRS) {
  try {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isFile()) hashPaths.push(p);
    }
  } catch { /* директории может не быть */ }
}
for (const f of HASH_FILES) {
  try { if (statSync(f).isFile()) hashPaths.push(f); } catch { /* ignore */ }
}
for (const p of hashPaths.sort()) {
  // sw.js в хеш не включаем — иначе циклическая зависимость (штамп в sw.js
  // меняет его контент, что меняет хеш → бесконечно).
  if (p.endsWith('sw.js')) continue;
  hashInput.update(readFileSync(p));
}
const buildVersion = hashInput.digest('hex').slice(0, 16);

const SW_PATH = 'public/sw.js';
try {
  const sw = readFileSync(SW_PATH, 'utf8');
  const stamped = sw.replace('__BUILD_VERSION__', buildVersion);
  writeFileSync(SW_PATH, stamped);
  console.log(`[sw] stamped version ${buildVersion}`);
} catch (e) {
  console.warn('[sw] не удалось стамп-нуть версию:', e.message);
}

// Кэш-бастер для index.html: к ссылке на /js/app.js (entry-точка ES-модулей)
// добавляем ?v=<buildVersion>. Браузер видит новый URL → не отдаёт старый
// бандл из кеша. Раньше при `<script src="/js/app.js">` Chrome/Safari могли
// сидеть на закэшированном app.js даже после деплоя, и пользователь не
// видел свежий код в браузере.
const HTML_PATH = 'public/index.html';
try {
  const html = readFileSync(HTML_PATH, 'utf8');
  const tag = encodeURIComponent(buildVersion);
  // Только entry-точка — модули, которые она импортирует, дёрнутся свежими
  // потому что относительные импорты резолвятся относительно URL родителя
  // (а у родителя сменился запрос → кеш проиграл).
  const stamped = html.replace('src="/js/app.js"', `src="/js/app.js?v=${tag}"`);
  if (stamped !== html) {
    writeFileSync(HTML_PATH, stamped);
    console.log(`[html] cache-buster v=${buildVersion}`);
  } else {
    console.warn('[html] не нашёл <script src="/js/app.js"> для стэмпа');
  }
} catch (e) {
  console.warn('[html] не удалось стамп-нуть:', e.message);
}
