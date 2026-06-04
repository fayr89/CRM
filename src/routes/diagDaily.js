// ВРЕМЕННЫЙ диагностический эндпоинт для AI ежедневного обхода.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = '3793976f5a59d8d28759f06592efcdd0';
const router = Router();

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?secret=X
// GET /api/diag/daily-run?secret=X&action=post-msg&feedback_id=N&text=...
// GET /api/diag/daily-run?secret=X&action=patch-feedback&id=N&status=...&admin_reply=...
// GET /api/diag/daily-run?secret=X&action=create-proposal&title=...&summary=...&risk=...&category=...&source=...&feedback_id=...&proposed_changes=...
// GET /api/diag/daily-run?secret=X&action=patch-proposal&id=N&decision=done
router.get('/daily-run', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const action = req.query.action;

    if (action === 'post-msg') {
      const feedbackId = Number(req.query.feedback_id);
      const text = String(req.query.text || '').trim();
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = ?', feedbackId);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedbackId, text,
      );
      const created = await db.get('SELECT * FROM feedback_messages WHERE id = ?', r.lastInsertRowid);
      return res.json({ ok: true, message: created });
    }

    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const status = req.query.status || cur.status;
      const adminReply = req.query.admin_reply ? String(req.query.admin_reply) : null;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, adminReply, id,
      );
      return res.json({ ok: true, feedback: await db.get('SELECT * FROM feedback WHERE id = ?', id) });
    }

    if (action === 'create-proposal') {
      const title = String(req.query.title || '').trim();
      const summary = String(req.query.summary || '').trim();
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
      const category = req.query.category || null;
      const source = req.query.source || null;
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      let proposedChanges = null;
      if (req.query.proposed_changes) {
        try { proposedChanges = JSON.parse(req.query.proposed_changes); } catch {}
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
        proposedChanges ? JSON.stringify(proposedChanges) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json({ ok: true, proposal: created });
    }

    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, proposal: await db.get('SELECT * FROM ai_proposals WHERE id = ?', id) });
    }

    // По умолчанию — возвращаем все данные для обхода
    const [feedbackRows, aiProposalsAll] = await Promise.all([
      db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      ),
      db.all(
        `SELECT * FROM ai_proposals
         WHERE status IN ('approved', 'revision', 'rejected')
         ORDER BY created_at DESC
         LIMIT 50`,
      ),
    ]);

    // Подгружаем треды для каждого обращения
    const feedbackWithThreads = await Promise.all(feedbackRows.map(async (fb) => {
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      // eslint-disable-next-line no-unused-vars
      const { attachments, ...fbSafe } = fb;
      return { ...fbSafe, messages };
    }));

    const byStatus = { approved: [], revision: [], rejected: [] };
    for (const p of aiProposalsAll) {
      if (byStatus[p.status]) byStatus[p.status].push(p);
    }

    return res.json({
      feedback: feedbackWithThreads,
      ai_proposals: byStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
