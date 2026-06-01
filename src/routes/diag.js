// Временный диаг-роут для AI-ежедневного обхода (сессия C2YoD).
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DIAG_SECRET = '4bcb04170376f6e7cfdb62f5b37c732341d4430286bc096d';

function checkSecret(req, res) {
  if (req.query.token !== DIAG_SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/ai-daily — proposals + открытые feedback с тредами
router.get(
  '/ai-daily',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.created_at DESC LIMIT 100`,
    );
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.subject, f.message, f.category, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 50`,
    );
    const fbIds = feedbacks.map((f) => f.id);
    const messages = fbIds.length > 0
      ? await db.all(
          `SELECT id, feedback_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ANY(?)
           ORDER BY feedback_id, created_at ASC, id ASC`,
          fbIds,
        )
      : [];
    res.json({ proposals, feedbacks, messages });
  }),
);

// GET /api/diag/ai-daily/post-msg?token=&fid=&text= — добавить сообщение в тред
router.get(
  '/ai-daily/post-msg',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const fid = Number(req.query.fid);
    const text = String(req.query.text || '').trim();
    if (!fid || !text) return res.status(400).json({ error: 'fid and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      fid, text,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);

// GET /api/diag/ai-daily/patch-feedback?token=&id=&status=&reply= — обновить статус обращения
router.get(
  '/ai-daily/patch-feedback',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const id = Number(req.query.id);
    const status = String(req.query.status || '');
    const reply = req.query.reply ? String(req.query.reply) : null;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      status, reply, id,
    );
    res.json({ ok: true });
  }),
);

// GET /api/diag/ai-daily/create-proposal?token=&title=&summary=&category=&risk=&fid= — создать proposal
router.get(
  '/ai-daily/create-proposal',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const title = String(req.query.title || '').trim();
    const summary = String(req.query.summary || '').trim();
    const category = req.query.category ? String(req.query.category) : null;
    const risk = req.query.risk || 'medium';
    const fid = req.query.fid ? Number(req.query.fid) : null;
    const proposed_changes = req.query.changes ? String(req.query.changes) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      fid, title, summary, category, risk, 'daily-run-2026-06-01',
      proposed_changes ? proposed_changes : null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);

// GET /api/diag/ai-daily/patch-proposal?token=&id=&decision= — обновить статус proposal
router.get(
  '/ai-daily/patch-proposal',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const id = Number(req.query.id);
    const decision = String(req.query.decision || '');
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    res.json({ ok: true });
  }),
);

export default router;
