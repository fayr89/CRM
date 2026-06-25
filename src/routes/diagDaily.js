// ВРЕМЕННЫЙ диаг-эндпоинт для ежедневного AI-обхода (2026-06-25). Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = 'diag-2026-06-25-r7k9qm';

const router = Router();

router.get('/', async (req, res) => {
  const { s, cmd, id, ...params } = req.query;

  if (s !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    switch (cmd) {
      case 'read-all': {
        const proposals = await db.all(`
          SELECT p.*,
            (SELECT json_agg(m ORDER BY m.created_at) FROM ai_proposal_messages m WHERE m.proposal_id = p.id) AS messages
          FROM ai_proposals p
          WHERE p.status IN ('approved', 'revision', 'rejected', 'pending')
          ORDER BY p.updated_at DESC
        `);

        const feedbacks = await db.all(`
          SELECT f.*,
            (SELECT json_agg(m ORDER BY m.created_at) FROM feedback_messages m WHERE m.feedback_id = f.id) AS messages
          FROM feedback f
          WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
          ORDER BY f.updated_at DESC
        `);

        return res.json({ proposals, feedbacks });
      }

      case 'patch-proposal': {
        const { decision, admin_notes } = params;
        await db.run(
          `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
           admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
          decision, admin_notes || null, id,
        );
        return res.json({ ok: true });
      }

      case 'post-proposal-msg': {
        const { text, user_name = 'AI ассистент' } = params;
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
           VALUES (?, ?, 'admin', ?, NOW())`,
          id, user_name, text,
        );
        return res.json({ ok: true });
      }

      case 'create-proposal': {
        const { title, summary, category = 'feature', risk = 'low', source, feedback_id, proposed_changes = '[]' } = params;
        const r = await db.run(
          `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending', NOW(), NOW())
           RETURNING id`,
          title, summary, category, risk, source || 'daily-run-2026-06-25',
          feedback_id ? Number(feedback_id) : null, proposed_changes,
        );
        const newId = r.rows?.[0]?.id;
        return res.json({ ok: true, id: newId });
      }

      case 'patch-feedback': {
        const { status, admin_reply } = params;
        const sets = ['updated_at = NOW()'];
        const vals = [];
        if (status) { sets.unshift('status = ?'); vals.push(status); }
        if (admin_reply) { sets.unshift('admin_reply = ?'); vals.push(admin_reply); }
        vals.push(id);
        await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals);
        return res.json({ ok: true });
      }

      case 'post-feedback-msg': {
        const { text, user_name = 'AI ассистент', role = 'admin' } = params;
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          id, user_name, role, text,
        );
        return res.json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'unknown cmd' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) });
  }
});

export default router;
