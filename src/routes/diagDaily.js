// TEMP — ежедневный AI-обход 2026-06-06-v54. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-06-v54';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

// GET /api/diag/daily-run?secret=... — всё что нужно для обхода
router.get('/daily-run', checkSecret, async (req, res) => {
  try {
    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.user_id AS feedback_user_id,
             fu.name AS feedback_author_name
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      LEFT JOIN users fu ON fu.id = f.user_id
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(`
        SELECT * FROM ai_proposal_messages
        WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
        ORDER BY created_at ASC, id ASC
      `);
    }

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
             r.name AS resolved_by_name
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.resolved_by
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY f.created_at DESC
      LIMIT 100
    `);

    const feedbackIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(`
        SELECT * FROM feedback_messages
        WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
        ORDER BY created_at ASC, id ASC
      `);
    }

    res.json({
      proposals,
      proposalMessages,
      feedback,
      feedbackMessages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/proposal-msg?secret=... — добавить сообщение к proposal
router.post('/daily-run/proposal-msg', checkSecret, async (req, res) => {
  try {
    const { proposal_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 1, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      proposal_id, text,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/proposal-patch?secret=... — обновить статус proposal
router.post('/daily-run/proposal-patch', checkSecret, async (req, res) => {
  try {
    const { id, status, summary, title, proposed_changes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET
         status = COALESCE(?, status),
         summary = COALESCE(?, summary),
         title = COALESCE(?, title),
         proposed_changes = COALESCE(?::jsonb, proposed_changes),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, summary ?? null, title ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
      id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/create-proposal?secret=... — создать новый proposal
router.post('/daily-run/create-proposal', checkSecret, async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk ?? 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/feedback-msg?secret=... — добавить сообщение в тред обращения
router.post('/daily-run/feedback-msg', checkSecret, async (req, res) => {
  try {
    const { feedback_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       SELECT id, user_id, 'AI ассистент', 'admin', ?
       FROM feedback WHERE id = ? RETURNING id`,
      text, feedback_id,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/feedback-patch?secret=... — обновить статус обращения
router.post('/daily-run/feedback-patch', checkSecret, async (req, res) => {
  try {
    const { id, status, admin_reply } = req.body;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
