// TEMP: диагностический эндпоинт для AI-ежедневного обхода.
// Секрет в query ?secret=... исключает случайный доступ.
// Удалить отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'ai-daily-20260601-NdAHT';

const router = Router();

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?secret=... — читаем все proposals по всем статусам + feedback
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    const [approved, revision, rejected, pending] = await Promise.all([
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'approved' ORDER BY p.created_at`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'revision' ORDER BY p.created_at`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'rejected' ORDER BY p.created_at`),
      db.all(`SELECT p.*, f.subject AS feedback_subject
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'pending' ORDER BY p.created_at`),
    ]);

    const feedbackRows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at`,
    );

    const fbWithThreads = await Promise.all(feedbackRows.map(async (fb) => {
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      return { ...fb, thread: messages };
    }));

    res.json({
      proposals: { approved, revision, rejected, pending },
      feedback: fbWithThreads,
    });
  }),
);

// GET /api/diag/daily-run/run?secret=...&op=patch_proposal&id=5&decision=done
// GET /api/diag/daily-run/run?secret=...&op=create_proposal&data=BASE64
// GET /api/diag/daily-run/run?secret=...&op=patch_feedback&id=10&status=awaiting_approval&reply=BASE64
// GET /api/diag/daily-run/run?secret=...&op=post_message&feedback_id=10&text=BASE64
router.get(
  '/run',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    const { op } = req.query;
    const decodeB64 = (s) => (s ? Buffer.from(s, 'base64').toString('utf8') : null);

    if (op === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = decodeB64(req.query.notes) || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes, id,
      );
      const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
      return res.json(row);
    }

    if (op === 'create_proposal') {
      const raw = decodeB64(req.query.data);
      if (!raw) return res.status(400).json({ error: 'data required' });
      const d = JSON.parse(raw);
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        d.feedback_id ?? null, d.title, d.summary,
        d.category ?? null, d.risk || 'medium', d.source ?? null,
        d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (op === 'patch_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const reply = decodeB64(req.query.reply) || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status ?? cur.status;
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        newStatus, reply, id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
    }

    if (op === 'post_message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = decodeB64(req.query.text);
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', feedbackId);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedbackId, text,
      );
      const created = await db.get(
        'SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE id = ?',
        r.lastInsertRowid,
      );
      return res.status(201).json(created);
    }

    res.status(400).json({ error: 'unknown op', allowed: ['patch_proposal','create_proposal','patch_feedback','post_message'] });
  }),
);

export default router;
