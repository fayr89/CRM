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

// Стампуем service-worker уникальной версией: при каждом деплое контент sw.js
// отличается → браузер видит обновление и шлёт клиенту 'updatefound'.
// Версия = timestamp деплоя (читабельно при отладке, гарантированно уникально).
const buildVersion = new Date().toISOString();

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
