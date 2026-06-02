// TEMP: ежедневный обход AI (сессия 1dq3y). Удалить после обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

const SECRET = '546233a5390ef797079b3f8435354366';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET — выгрузить все данные для обхода
router.get('/', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const [approved, revision, rejected, feedbackRows] = await Promise.all([
    db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC LIMIT 30`),
    db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.status ASC, f.created_at ASC`,
    ),
  ]);

  // Подгружаем треды для каждого feedback
  const feedbackWithThreads = await Promise.all(feedbackRows.map(async (fb) => {
    const messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    return { ...fb, messages };
  }));

  res.json({
    proposals: { approved, revision, rejected },
    feedback: feedbackWithThreads,
  });
}));

// POST — выполнить операцию
router.post('/', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { action, ...data } = req.body || {};

  if (action === 'post_message') {
    // Отправить сообщение в тред обращения
    const { feedback_id, text } = data;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'update_feedback') {
    // Сменить статус обращения + опционально admin_reply
    const { feedback_id, status, admin_reply } = data;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null, feedback_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'create_proposal') {
    // Создать ai_proposal
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = data;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null,
      title,
      summary,
      category ?? null,
      risk ?? 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'patch_proposal') {
    // Обновить статус ai_proposal (done/pending)
    const { proposal_id, decision } = data;
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      decision, proposal_id,
    );
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'unknown action' });
}));

export default router;
