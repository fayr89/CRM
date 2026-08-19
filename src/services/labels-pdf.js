// Генерация PDF с этикетками отгрузки. На каждый заказ — одна страница 75×120мм
// со штрих-кодом (Code 128 из shipment_qr), позициями заказа, менеджером,
// порядковым номером и службой доставки.
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

// orders: [{ id, shipment_qr, delivery_method, reference_number, manager_name, items: [{sku,name,quantity}] }]
// Возвращает Promise<Buffer> готового PDF.
export async function generateLabelsPdf(orders) {
  const PAGE_W = 75 * MM;
  const PAGE_H = 120 * MM;
  const MARGIN = 3 * MM;
  const CONTENT_W = PAGE_W - 2 * MARGIN;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: MARGIN,
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
    let curY = MARGIN;

    // Штрих-код вверху.
    let barcodePng = null;
    try {
      barcodePng = await makeBarcodePng(track);
    } catch (e) {
      doc.fontSize(8).fillColor('red').text(`Не удалось сгенерировать штрих для «${track}»`, MARGIN, curY);
      continue;
    }

    const barcodeW = CONTENT_W * 0.95;
    const barcodeH = 18 * MM;
    const barcodeX = (PAGE_W - barcodeW) / 2;
    doc.image(barcodePng, barcodeX, curY, { width: barcodeW, height: barcodeH });
    curY += barcodeH + 0.5 * MM;

    // Трек-номер под штрихом.
    doc.fillColor('black').fontSize(7)
      .text(track, barcodeX, curY, { width: barcodeW, align: 'center' });
    curY += 5 * MM;

    // Разделитель.
    doc.moveTo(MARGIN, curY).lineTo(PAGE_W - MARGIN, curY).strokeColor('#cccccc').lineWidth(0.5).stroke();
    curY += 1.5 * MM;

    // Таблица позиций заказа.
    const items = order.items || [];
    if (items.length > 0) {
      const colSkuW = 22 * MM;
      const colQtyW = 10 * MM;
      const colNameW = CONTENT_W - colSkuW - colQtyW;

      // Шапка таблицы.
      doc.fontSize(6).fillColor('#888888');
      doc.text('Артикул', MARGIN, curY, { width: colSkuW });
      doc.text('Наименование', MARGIN + colSkuW, curY, { width: colNameW });
      doc.text('Кол.', MARGIN + colSkuW + colNameW, curY, { width: colQtyW, align: 'right' });
      curY += 4 * MM;

      doc.fillColor('black').fontSize(7);
      for (const item of items) {
        const sku = String(item.sku || '—');
        const name = String(item.name || '—');
        const qty = String(item.quantity ?? 1);

        const skuH = doc.heightOfString(sku, { width: colSkuW });
        const nameH = doc.heightOfString(name, { width: colNameW });
        const rowH = Math.max(skuH, nameH, 4 * MM);

        if (curY + rowH > PAGE_H - 18 * MM) break; // защита: не уходить за нижний блок

        doc.text(sku, MARGIN, curY, { width: colSkuW });
        doc.text(name, MARGIN + colSkuW, curY, { width: colNameW });
        doc.text(qty, MARGIN + colSkuW + colNameW, curY, { width: colQtyW, align: 'right' });
        curY += rowH + 1 * MM;
      }
    }

    // Разделитель перед подвалом.
    const footerY = PAGE_H - 16 * MM;
    if (curY < footerY - 1 * MM) {
      doc.moveTo(MARGIN, footerY - 2 * MM).lineTo(PAGE_W - MARGIN, footerY - 2 * MM)
        .strokeColor('#cccccc').lineWidth(0.5).stroke();
    }

    // Менеджер.
    if (order.manager_name) {
      doc.fontSize(7).fillColor('#555555')
        .text(`Менеджер: ${order.manager_name}`, MARGIN, footerY - 1 * MM, {
          width: CONTENT_W,
        });
    }

    // Порядковый номер слева внизу.
    doc.fontSize(18).fillColor('black')
      .text(`№ ${seq}`, MARGIN, PAGE_H - 12 * MM, {
        width: PAGE_W / 2 - MARGIN,
        align: 'left',
      });

    // Способ отправки справа внизу.
    const shipMethod = resolveShipMethod(order);
    doc.fontSize(10).fillColor('black')
      .text(shipMethod, PAGE_W / 2, PAGE_H - 10 * MM, {
        width: PAGE_W / 2 - MARGIN,
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
