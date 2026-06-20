// TEMP: диаг-эндпоинт ежедневного обхода AI (2026-06-20). Снести после использования.
// Секрет: hJ3mN7qR2tY5
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'hJ3mN7qR2tY5';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action } = req.query;

    // --- мутации через GET (web_fetch_vercel_url поддерживает только GET) ---

    if (action === 'proposal_done') {
      const id = Number(req.query.proposal_id);
      await db.run(
        `UPDATE ai_proposals SET status='done', admin_decision_by=0, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
        id,
      );
      return res.json({ ok: true, action, id });
    }

    if (action === 'proposal_message') {
      const id = Number(req.query.proposal_id);
      const text = req.query.text || '';
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text) VALUES (?,0,'AI ассистент','admin',?)`,
        id, text,
      );
      return res.json({ ok: true, action, id });
    }

    if (action === 'proposal_revision') {
      const id = Number(req.query.proposal_id);
      const title = req.query.title || null;
      const summary = req.query.summary || null;
      await db.run(
        `UPDATE ai_proposals SET status='pending', title=COALESCE(?,title), summary=COALESCE(?,summary), updated_at=NOW() WHERE id=?`,
        title, summary, id,
      );
      return res.json({ ok: true, action, id });
    }

    if (action === 'proposal_create') {
      const { title, summary, category, risk, source, feedback_id } = req.query;
      const changesRaw = req.query.proposed_changes || null;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary,
        category || null,
        risk || 'medium',
        source || null,
        changesRaw || null,
      );
      return res.json({ ok: true, action, id: r.lastInsertRowid });
    }

    if (action === 'feedback_message') {
      const id = Number(req.query.feedback_id);
      const text = req.query.text || '';
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?,0,'AI ассистент','admin',?)`,
        id, text,
      );
      return res.json({ ok: true, action, id });
    }

    if (action === 'feedback_update') {
      const id = Number(req.query.feedback_id);
      const status = req.query.status || null;
      const admin_reply = req.query.admin_reply || null;
      const cur = await db.get('SELECT status FROM feedback WHERE id=?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const justResolved = (status === 'awaiting_approval' || status === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status=COALESCE(?,status),
           admin_reply=COALESCE(?,admin_reply),
           resolved_by=CASE WHEN ? THEN 0 ELSE resolved_by END,
           resolved_at=CASE WHEN ? THEN NOW() ELSE resolved_at END,
           updated_at=NOW()
         WHERE id=?`,
        status, admin_reply, justResolved, justResolved, id,
      );
      return res.json({ ok: true, action, id });
    }

    if (action === 'feedback_close') {
      const id = Number(req.query.feedback_id);
      const text = req.query.text || '';
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?,0,'AI ассистент','admin',?)`,
        id, text,
      );
      await db.run(
        `UPDATE feedback SET status='closed', resolved_by=0, resolved_at=NOW(), updated_at=NOW() WHERE id=?`,
        id,
      );
      return res.json({ ok: true, action, id });
    }

    // --- чтение всех данных ---
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','rejected','revision','pending','done')
       ORDER BY p.updated_at DESC LIMIT 50`,
    );
    const pIds = proposals.map((p) => p.id);
    const pMsgs = pIds.length
      ? await db.all(
          `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${pIds.join(',')}]::int[]) ORDER BY created_at ASC`,
        )
      : [];

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email, u.role AS author_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    const fIds = feedbacks.map((f) => f.id);
    const fMsgs = fIds.length
      ? await db.all(
          `SELECT * FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${fIds.join(',')}]::int[]) ORDER BY created_at ASC`,
        )
      : [];

    res.json({ proposals, proposal_messages: pMsgs, feedbacks, feedback_messages: fMsgs });
  }),
);

export default router;
