// Генерация PDF с этикетками отгрузки. На каждый заказ — одна страница 58×40мм
// со штрих-кодом (Code 128 из shipment_qr), порядковым номером и службой
// доставки.
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(__dirname, '../../assets/fonts/Roboto-Regular.ttf');

// 1 мм = 2.834645669 точек PDF (72 dpi / 25.4).
const MM = 2.8346;

// Сгенерировать штрих-код Code 128 как PNG-буфер.
async function makeBarcodePng(text) {
  return await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 12,   // мм для bwip-js (он умеет в мм)
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

// orders: [{ id, shipment_qr, delivery_method, reference_number }]
// Возвращает Promise<Buffer> готового PDF.
export async function generateLabelsPdf(orders) {
  const PAGE_W = 58 * MM;
  const PAGE_H = 40 * MM;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: 2 * MM,
    autoFirstPage: false,
  });

  // Регистрируем Roboto (кириллица). Должен лежать в assets/fonts/.
  try {
    const fontBuf = readFileSync(FONT_PATH);
    doc.registerFont('Roboto', fontBuf);
    doc.font('Roboto');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[labels-pdf] font not found, using default:', e.message);
  }

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));

  for (const [i, order] of orders.entries()) {
    const seq = i + 1;
    const track = String(order.shipment_qr || '').trim();
    if (!track) continue; // пропускаем заказы без трек-номера

    doc.addPage();

    // Штрих-код вверху, на всю ширину минус поля.
    let barcodePng = null;
    try {
      barcodePng = await makeBarcodePng(track);
    } catch (e) {
      doc.fontSize(8).fillColor('red').text(`Не удалось сгенерировать штрих для «${track}»`, 2 * MM, 2 * MM);
      continue;
    }

    // -5% от полной ширины (был 4mm отступа, теперь чуть больше).
    const barcodeW = (PAGE_W - 4 * MM) * 0.95;
    const barcodeH = 16 * MM * 0.95;
    const barcodeX = (PAGE_W - barcodeW) / 2; // центрируем по горизонтали
    const barcodeY = 2 * MM;
    doc.image(barcodePng, barcodeX, barcodeY, { width: barcodeW, height: barcodeH });

    // Текст самого трек-номера под штрихом (мелким шрифтом).
    doc.fillColor('black')
      .fontSize(7)
      .text(track, barcodeX, barcodeY + barcodeH + 0.5 * MM, {
        width: barcodeW,
        align: 'center',
      });

    // Порядковый номер крупно слева внизу.
    doc.fontSize(20)
      .text(`№ ${seq}`, 2 * MM, PAGE_H - 12 * MM, {
        width: PAGE_W / 2 - 2 * MM,
        align: 'left',
      });

    // Способ отправки справа внизу: приоритет delivery_method, иначе marketplace.
    const shipMethod = resolveShipMethod(order);
    doc.fontSize(11)
      .text(shipMethod, PAGE_W / 2, PAGE_H - 10 * MM, {
        width: PAGE_W / 2 - 2 * MM,
        align: 'right',
      });
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// Способ отправки на этикетке: предпочтительно delivery_method, иначе marketplace
// (если у заказа delivery_method пуст). Маппинг кодов на человеческие названия.
function resolveShipMethod(order) {
  const dm = String(order.delivery_method || '').trim().toLowerCase();
  if (dm) {
    const map = {
      sdek: 'СДЭК',
      cdek: 'СДЭК',
      pochta: 'Почта России',
      'pochta_russia': 'Почта России',
      boxberry: 'Boxberry',
      yandex: 'Я.Доставка',
      avito_delivery: 'Avito Доставка',
      avito: 'Avito Доставка',
      pickup: 'Самовывоз',
      courier: 'Курьер',
    };
    return map[dm] || order.delivery_method;
  }
  const mp = String(order.marketplace || '').trim();
  if (mp) {
    const lower = mp.toLowerCase();
    if (lower === 'avito') return 'Avito';
    if (lower === 'wildberries' || lower === 'wb') return 'Wildberries';
    if (lower === 'ozon') return 'Ozon';
    if (lower === 'yandex' || lower === 'yandex_market') return 'Я.Маркет';
    return mp;
  }
  return '—';
}
