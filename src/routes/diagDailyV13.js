// TEMPORARY DIAG — daily AI run v13 — DELETE AFTER USE
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr13-pW9qL5mZ2cY';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;

    if (op === 'proposals') {
      const st = req.query.status;
      const rows = st
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status, f.user_id AS feedback_user_id FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`,
            st,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id ORDER BY p.created_at DESC LIMIT 100`,
          );
      return res.json({ data: rows });
    }

    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC LIMIT 200`,
      );
      const result = [];
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    if (op === 'create-proposal-fb38') {
      // Preset proposal: FB#38 краткие наименования — CSV был в attachments
      const csvMapping = `30365871 → АНТИЛОП Ножки для стульчика для кормления
90365873 → АНТИЛОП Сиденье для стульчика для кормления
10365872 → АНТИЛОП Столешница для стульчика для кормления
80742963 → БАГИС Плечики белые
40466600 → БАГИС плечики детские
80376216 → ПРУТА зеленая 17шт
80351013 → ПРУТА желтая 3шт
70246471 → РЕДА Набор контейнеров 5шт
1080010212 → РЕДДА СТМ Набор контейнеров 5шт оранжевый
1080010211 → РЕДДА СТМ Набор контейнеров 5шт бирюзовый
20349669 → ЭКТИГ для сыпучих
90375363 → ФНИСС ведро белое
10388963 → ФНИСС ведро черное
00376437 → САМЛА контейнер 5л
80376438 → САМЛА контейнер 11л
60376439 → САМЛА контейнер 22л
40376440 → САМЛА контейнер 45л
20376219 → САМЛА контейнер 55л
40376218 → САМЛА контейнер 65л
20376441 → САМЛА контейнер 130л
10199203 → САМЛА крышка 5л
90199204 → САМЛА крышка 11/22л
30198009 → САМЛА крышка 45/65л
80376443 → САМЛА крышка 55/130л
10206312 → САМЛА контейнер 11л дымчатый
00206317 → САМЛА контейнер 22л дымчатый
20206316 → САМЛА контейнер 45л дымчатый
30213161 → САМЛА крышка 11/22л дымчатый
10213162 → САМЛА крышка 45/65л дымчатый
10366027 → ТРУФАСТ крышка 1 шт
10366032 → ТРУФАСТ 20х30х10 белый
90365967 → ТРУФАСТ 20х30х10 черный
70366029 → ТРУФАСТ 42х30х10 белый
60120541 → ТРУФАСТ 42х30х10 бирюзовый
50366030 → ТРУФАСТ 42х30х10 желтый
00466287 → ТРУФАСТ 42х30х10 зеленый
40466290 → ТРУФАСТ 42х30х10 розовый
70366014 → ТРУФАСТ 42х30х10 серый
50231296 → ТРУФАСТ 42х30х10 черный
70366034 → ТРУФАСТ 42х30х23 белый
00464033 → ТРУФАСТ 42х30х23 бирюзовый
70868033 → ТРУФАСТ 42х30х23 красный
90466283 → ТРУФАСТ 42х30х23 оранжевый
10466277 → ТРУФАСТ 42х30х23 розовый
70539563 → ТРУФАСТ 42х30х23 серый
50365479 → ТРУФАСТ 42х30х23 черный
90386677 → МАММУТ стул белый
00365368 → МАММУТ стул красный
40382323 → МАММУТ стул розовый
20365348 → МАММУТ стул синий
70382326 → МАММУТ табурет желтый
70365360 → МАММУТ табурет оранжевый
40366040 → ВЕССЛА Контейнер белый
80366038 → ВЕССЛА Контейнер зеленый
60366039 → ВЕССЛА Контейнер розовый
00366037 → ВЕССЛА Контейнер синий
109007131 → Комплект «Пруфа» СТМ 4 шт бирюзовый
109003081 → Комплект «Пруфа» СТМ 3 шт зеленый (1,1л)
109003031 → Комплект «Пруфа» СТМ 3 шт черный (1,1л)
109004081 → Комплект «Пруфа» СТМ 3 шт зеленый (1,7л)
109004031 → Комплект «Пруфа» СТМ 3 шт черный (1,7л)
109005081 → Комплект «Пруфа» СТМ 5 шт зеленый
109005031 → Комплект «Пруфа» СТМ 5 шт черный
109006031 → Комплект «Пруфа» СТМ 6 шт черный`;

      const summary = `Обращение FB#38 (Ангелина): просит заменить наименования товаров в CRM по артикулу на «краткие» из прикреплённого файла.

ВАЖНО: предыдущий AI-ассистент ошибочно написал автору «файл не дошёл» — на самом деле CSV был в поле attachments обращения. Автор ещё ждёт ответа.

Файл «Наименования.csv» содержит 64 пары «артикул → краткое имя» (формат АРТИКУЛ;НАЗВАНИЕ):
${csvMapping}

Логика замены (по словам автора): если артикул товара в CRM совпадает с артикулом из файла — ставим имя из файла; если нет — оставляем как есть.

Реализация: UPDATE products SET name = <новое_имя> WHERE external_id = <артикул> — для каждой из 64 строк.
Нужно сначала проверить, сколько артикулов из файла реально найдётся в таблице products (field external_id), и сообщить автору, сколько совпало.

Риск: LOW — меняются только отображаемые имена товаров, данные о ценах/остатках не затрагиваются. DDL не нужен.
Оценка: 1-2 ч (запрос + временный diag-эндпоинт для выполнения UPDATE + отчёт автору).`;

      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        38,
        'Краткие наименования товаров: обновить 64 позиции по CSV из FB#38',
        summary,
        'ui-tweak',
        'low',
        'daily-run-2026-06-04-v13',
        JSON.stringify([
          { file: 'diag-endpoint (временный)', action: 'UPDATE products SET name=... WHERE external_id=... для 64 артикулов из CSV' },
        ]),
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;
    const b = req.body || {};

    if (op === 'patch-proposal') {
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, b.decision, b.id);
      return res.json({ ok: true });
    }

    if (op === 'post-msg') {
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        b.feedback_id, b.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = b;
      const fields = [];
      const vals = [];
      if (status) { fields.push('status = ?'); vals.push(status); }
      if (admin_reply) { fields.push('admin_reply = ?'); vals.push(admin_reply); }
      if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
      fields.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        b.feedback_id ?? null, b.title, b.summary,
        b.category ?? null, b.risk || 'medium', b.source ?? null,
        b.proposed_changes ? JSON.stringify(b.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
