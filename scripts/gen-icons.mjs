// Генератор иконок PWA для iOS/Android. Запускается вручную через
// `node scripts/gen-icons.mjs` — результат коммитим в репо как статика
// под /public/. Рисует фирменный синий квадрат с белой сеткой 2×2 в
// центре (намекает на «карточки» CRM-канбана).
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

function makePng(width, height, drawPixel) {
  const bytesPerRow = 1 + width * 4; // filter byte + RGBA
  const raw = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    raw[y * bytesPerRow] = 0; // filter type "None"
    for (let x = 0; x < width; x++) {
      const i = y * bytesPerRow + 1 + x * 4;
      const [r, g, b, a] = drawPixel(x, y, width, height);
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Линейная интерполяция цветов (для градиента фона).
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function drawIcon(size, { maskable = false } = {}) {
  // Для maskable-иконок Android добавляем safe-zone отступ ~10% по краям —
  // OS обрезает их в маску (круг/«сквиркл»), а контент должен быть в центре.
  const inset = maskable ? Math.floor(size * 0.1) : 0;
  const usable = size - inset * 2;
  // Цвета фирмы: верх — глубокий синий, низ — primary.
  const top = [30, 58, 138];   // #1e3a8a
  const bot = [37, 99, 235];   // #2563eb
  // Сетка 2×2 «карточек» в центре: квадратная область со стороной ~48% от usable.
  const gridSize = Math.floor(usable * 0.48);
  const gap = Math.max(2, Math.floor(gridSize * 0.08));
  const cell = Math.floor((gridSize - gap) / 2);
  const gridX0 = inset + Math.floor((usable - gridSize) / 2);
  const gridY0 = inset + Math.floor((usable - gridSize) / 2);

  // Скруглённые углы карточек (приближённое — пиксельное «без anti-aliasing»).
  const cellRadius = Math.max(2, Math.floor(cell * 0.18));
  const cards = [
    [gridX0, gridY0],
    [gridX0 + cell + gap, gridY0],
    [gridX0, gridY0 + cell + gap],
    [gridX0 + cell + gap, gridY0 + cell + gap],
  ];
  function inCard(x, y) {
    for (const [cx, cy] of cards) {
      const dx = x - cx, dy = y - cy;
      if (dx < 0 || dy < 0 || dx >= cell || dy >= cell) continue;
      // Скругление: углы — четверти круга радиуса cellRadius.
      const insideX = dx >= cellRadius && dx < cell - cellRadius;
      const insideY = dy >= cellRadius && dy < cell - cellRadius;
      if (insideX || insideY) return true;
      // Угол: проверяем дистанцию до центра ближайшего скруглённого угла.
      const ax = dx < cellRadius ? cellRadius : cell - cellRadius - 1;
      const ay = dy < cellRadius ? cellRadius : cell - cellRadius - 1;
      const ex = dx - ax, ey = dy - ay;
      if (ex * ex + ey * ey <= cellRadius * cellRadius) return true;
    }
    return false;
  }

  return makePng(size, size, (x, y) => {
    // Фон: вертикальный градиент top→bot.
    const t = y / size;
    const bgR = lerp(top[0], bot[0], t);
    const bgG = lerp(top[1], bot[1], t);
    const bgB = lerp(top[2], bot[2], t);
    // Maskable: за пределами safe-zone тоже фон — иначе ОС покажет дыру.
    if (inCard(x, y)) return [255, 255, 255, 255];
    return [bgR, bgG, bgB, 255];
  });
}

const targets = [
  { name: 'icon-32.png', size: 32 },
  { name: 'icon-64.png', size: 64 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
];

const generated = new Map();
for (const t of targets) {
  const buf = drawIcon(t.size, { maskable: t.maskable });
  const path = resolve(PUBLIC_DIR, t.name);
  writeFileSync(path, buf);
  generated.set(t.size, buf);
  console.log(`written ${t.name} (${buf.length} bytes)`);
}

// favicon.ico — браузеры авто-запрашивают /favicon.ico (особенно при добавлении
// в закладки). Внутри ICO лежит готовая 32×32 PNG (формат это поддерживает).
{
  const png32 = generated.get(32);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type=1 (ICO)
  header.writeUInt16LE(1, 4);     // count=1
  const entry = Buffer.alloc(16);
  entry[0] = 32;                  // width (0 means 256)
  entry[1] = 32;                  // height
  entry[2] = 0;                   // palette colors (0 for ≥8bpp)
  entry[3] = 0;                   // reserved
  entry.writeUInt16LE(1, 4);      // color planes
  entry.writeUInt16LE(32, 6);     // bpp
  entry.writeUInt32LE(png32.length, 8);  // image size
  entry.writeUInt32LE(6 + 16, 12);       // offset to image data
  const ico = Buffer.concat([header, entry, png32]);
  writeFileSync(resolve(PUBLIC_DIR, 'favicon.ico'), ico);
  console.log(`written favicon.ico (${ico.length} bytes)`);
}
