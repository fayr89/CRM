// TEMP: диагностический эндпоинт для AI daily run 2026-06-25-v12 — УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiday-v12-Jx8Rk3mN';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v12/data — вернуть все proposals + feedback с тредами
router.get('/data', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;

    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.status AS feedback_status
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      ORDER BY p.created_at DESC
    `);

    const proposalMessages = await db.all(`
      SELECT m.* FROM ai_proposal_messages m
      INNER JOIN ai_proposals p ON p.id = m.proposal_id
      ORDER BY m.created_at ASC, m.id ASC
    `);

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
             r.name AS resolved_by_name
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.resolved_by
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY
        (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
        f.created_at DESC
    `);

    const feedbackMessages = await db.all(`
      SELECT fm.* FROM feedback_messages fm
      INNER JOIN feedback f ON f.id = fm.feedback_id
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY fm.created_at ASC, fm.id ASC
    `);

    res.json({ adminId, proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-v12/write — выполнить операцию записи через GET (action + params в query)
router.get('/write', async (req, res) => {
  if (!guard(req, res)) return;
  const { action } = req.query;
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;
    let result = { ok: true };

    if (action === 'update_proposal') {
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        req.query.status, Number(req.query.id),
      );
    } else if (action === 'post_proposal_msg') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        Number(req.query.proposal_id), adminId, req.query.text,
      );
    } else if (action === 'update_feedback') {
      const fbId = Number(req.query.id);
      const newStatus = req.query.status;
      if (newStatus) {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fbId);
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = COALESCE(?, resolved_by),
             resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
             updated_at = NOW()
           WHERE id = ?`,
          newStatus,
          req.query.admin_reply ?? null,
          justResolved ? adminId : null,
          fbId,
        );
      }
    } else if (action === 'post_feedback_msg') {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, ?, 'AI ассистент', 'admin', ?, NULL::jsonb)`,
        Number(req.query.feedback_id), adminId, req.query.text,
      );
    } else if (action === 'create_proposal') {
      // Данные берутся из query (для небольших proposals). Длинные summary — через /batch.
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        req.query.feedback_id ? Number(req.query.feedback_id) : null,
        req.query.title,
        req.query.summary,
        req.query.category ?? null,
        req.query.risk || 'medium',
        req.query.source ?? null,
        req.query.proposed_changes ? JSON.stringify(JSON.parse(req.query.proposed_changes)) : null,
      );
      result = { id: r.lastInsertRowid };
    } else {
      return res.status(400).json({ error: 'unknown action: ' + action });
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-v12/batch — выполнить все нужные операции этого обхода за один вызов
router.get('/batch', async (req, res) => {
  if (!guard(req, res)) return;
  const log = [];
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;

    // 1. Создать ai_proposal для FB#59 (Ангелина — доработка архива отгрузок)
    const proposalTitle = 'Архив отгрузок: фильтр по датам + выгрузка только выделенных';
    const existing = await db.get(
      `SELECT id FROM ai_proposals WHERE title = ? AND status != 'done'`,
      proposalTitle,
    );
    let proposalId;
    if (existing) {
      proposalId = existing.id;
      log.push(`proposal already exists: #${proposalId}`);
    } else {
      const summary =
        `Ангелина (feedback #59) прислала три уточнения к уже реализованному архиву отгрузок:\n\n` +
        `1. Фильтр по диапазону дат: добавить два поля «с» / «по» над таблицей архива. По умолчанию даты не выбраны — показывается весь архив. При выборе дат — перезагружать данные с сервера.\n\n` +
        `2. Выгрузка Excel и печать PDF этикеток — работать только с выделенными чекбоксами строками, если хоть одна выбрана.\n\n` +
        `3. Если ни одна строка не выбрана — выгружать все строки с учётом фильтра по датам (если дата задана — только за этот период; если нет — весь архив).\n\n` +
        `Текущий баг: кнопка «Выгрузить в Excel» игнорирует чекбоксы и скачивает все completed-заказы через общий экспорт (/api/orders/export.csv?status=completed). Кнопка PDF-этикеток уже корректно берёт выделенные.\n\n` +
        `Что нужно сделать:\n` +
        `— Бэкенд (orders.js): добавить query-параметры shipped_from / shipped_to к /shipped-archive и /export.csv (фильтр по shipped_at).\n` +
        `— Фронтенд (views.js): добавить два date-input над архивом, при изменении — перезапрашивать данные.\n` +
        `— Фронтенд (views.js): кнопку «Выгрузить в Excel» исправить: брать выделенные id (или все загруженные при пустой выборке), передавать в export.csv через &ids=1,2,3.\n` +
        `— api.js: обновить shippedArchive() чтобы принимал from/to параметры.\n\n` +
        `Оценка: ~2 часа, риск средний (затрагивает экспорт заказов и загрузку архива).`;
      const proposed_changes = [
        { file: 'src/routes/orders.js', action: 'add shipped_from/shipped_to filter to /shipped-archive; add ids param + shipped_from/shipped_to to /export.csv', reason: 'date filter and per-id export' },
        { file: 'public/js/views.js', action: 'add date pickers above archive; reload on change; fix Excel button to use archiveSelected IDs', reason: 'UI for new filter + fix export bug' },
        { file: 'public/js/api.js', action: 'update shippedArchive(from,to) to pass date params', reason: 'API method update' },
      ];
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        59,
        proposalTitle,
        summary,
        'feature',
        'medium',
        'daily-run-2026-06-25',
        JSON.stringify(proposed_changes),
      );
      proposalId = r.lastInsertRowid;
      log.push(`created proposal #${proposalId} for FB#59`);
    }

    // 2. Отправить сообщение в тред FB#59
    const fbMsgText =
      `Здравствуйте, Ангелина! Спасибо за уточнения — все три пункта получены:\n` +
      `1. Фильтр по диапазону дат в архиве\n` +
      `2. Excel и PDF — только выделенные, если что-то отмечено\n` +
      `3. Если ничего не выбрано — всё с учётом фильтра дат\n\n` +
      `Передала задание на рассмотрение администратора. Сделаем после одобрения. Ctrl+F5 для актуальной версии.`;

    // Проверим, не отправляли ли уже это сообщение
    const lastMsg = await db.get(
      `SELECT text FROM feedback_messages WHERE feedback_id = 59 ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    if (lastMsg && lastMsg.text === fbMsgText) {
      log.push('feedback msg already sent, skipping');
    } else {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (59, ?, 'AI ассистент', 'admin', ?, NULL::jsonb)`,
        adminId, fbMsgText,
      );
      log.push('sent message to FB#59 thread');
    }

    res.json({ ok: true, log });
  } catch (e) {
    res.status(500).json({ error: e.message, log });
  }
});

export default router;
