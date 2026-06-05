// TEMP: ежедневный AI-обход. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiDr-2026-06-05-v40';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}
function b64(s) { return s ? Buffer.from(s, 'base64').toString('utf8') : null; }

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || 'read';
  try {
    if (action === 'read') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name
         FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
         ORDER BY p.status, p.created_at DESC`,
      );
      const feedback = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.context, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      for (const fb of feedback) {
        fb.messages = await db.all(
          `SELECT id, role, user_name, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ proposals, feedback, ts: new Date().toISOString() });
    }

    if (action === 'post-message') {
      const text = b64(req.query.text_b64);
      const { feedback_id } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'missing params' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(feedback_id), text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch-feedback') {
      const { id, status } = req.query;
      const admin_reply = b64(req.query.reply_b64);
      if (!id) return res.status(400).json({ error: 'missing id' });
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW()
         WHERE id = ?`,
        status ?? null, admin_reply ?? null, Number(id),
      );
      return res.json({ ok: true });
    }

    if (action === 'close-feedback') {
      const { id } = req.query;
      const message = b64(req.query.message_b64);
      if (!id) return res.status(400).json({ error: 'missing id' });
      if (message) {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          Number(id), message,
        );
      }
      await db.run(`UPDATE feedback SET status='closed', updated_at=NOW() WHERE id=?`, Number(id));
      return res.json({ ok: true });
    }

    if (action === 'create-proposal') {
      const title = b64(req.query.title_b64);
      const summary = b64(req.query.summary_b64);
      const { category, risk, source } = req.query;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.pc_b64 ? JSON.parse(b64(req.query.pc_b64)) : null;
      if (!title || !summary) return res.status(400).json({ error: 'missing params' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary,
        category ?? null, risk ?? 'medium',
        source ?? 'daily-run-2026-06-05',
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'mark-proposal-done') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      await db.run(
        `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, Number(id),
      );
      return res.json({ ok: true });
    }

    res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
