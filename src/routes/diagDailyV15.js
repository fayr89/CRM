// ВРЕМЕННЫЙ diag-эндпоинт для AI-обхода 2026-06-26-v15. УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-26-v15-q7mwt';

// GET: читаем все данные для обхода
router.get('/daily-v15', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const approved = await db.all(`SELECT * FROM ai_proposals WHERE status='approved' ORDER BY updated_at DESC`);
    const revision = await db.all(`SELECT * FROM ai_proposals WHERE status='revision' ORDER BY updated_at DESC`);
    const rejected = await db.all(`SELECT * FROM ai_proposals WHERE status='rejected' ORDER BY updated_at DESC LIMIT 20`);
    const pending  = await db.all(`SELECT * FROM ai_proposals WHERE status='pending'  ORDER BY updated_at DESC LIMIT 30`);

    const allProposalIds = [...approved, ...revision, ...rejected, ...pending].map(p => p.id);
    const proposalMessages = {};
    for (const pid of allProposalIds) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`, pid);
      if (msgs.length) proposalMessages[pid] = msgs;
    }

    const feedback = await db.all(
      `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
              f.admin_reply, f.context, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at ASC`
    );

    const feedbackWithThreads = [];
    for (const fb of feedback) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`, fb.id);
      feedbackWithThreads.push({ ...fb, messages: msgs });
    }

    res.json({
      run: 'daily-2026-06-26-v15',
      proposals: { approved, revision, rejected, pending },
      proposalMessages,
      feedback: feedbackWithThreads,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: выполняем write-действия
// action: 'post_feedback_msg' | 'patch_feedback' | 'create_proposal' | 'patch_proposal'
router.post('/daily-v15/act', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const { action, ...payload } = req.body || {};
  try {
    if (action === 'post_feedback_msg') {
      // { feedback_id, text }
      const { feedback_id, text } = payload;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'patch_feedback') {
      // { feedback_id, status?, admin_reply? }
      const { feedback_id, status, admin_reply } = payload;
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
      // { title, summary, category, risk, source, proposed_changes, feedback_id }
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = payload;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk ?? 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'patch_proposal') {
      // { proposal_id, decision }  decision: approved|rejected|revision|done
      const { proposal_id, decision } = payload;
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, proposal_id,
      );
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
