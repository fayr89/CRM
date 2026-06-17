// TEMP — diag для ежедневного AI-обхода 2026-06-17-v52.
// Снести сразу после использования отдельным коммитом.
// GET /api/diag/daily?s=dr52kp9wqx
// GET /api/diag/daily/write?s=dr52kp9wqx&action=...
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr52kp9wqx';

// READ: proposals (not done) + feedbacks (open/awaiting_approval) with threads
router.get('/', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const proposals = await db.all(
      `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
              p.feedback_id, p.admin_notes, p.proposed_changes,
              p.created_at, p.updated_at, p.admin_decision_at,
              u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status != 'done'
       ORDER BY p.status, p.created_at DESC`,
    );

    const proposalIds = proposals.map((p) => p.id);
    const allPropMsgs = proposalIds.length
      ? await db.all(
          `SELECT proposal_id, id, user_name, role, text, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ANY(?::int[])
           ORDER BY proposal_id, created_at ASC, id ASC`,
          `{${proposalIds.join(',')}}`,
        )
      : [];
    const propMsgMap = {};
    for (const m of allPropMsgs) {
      if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
      propMsgMap[m.proposal_id].push(m);
    }
    const proposalsWithThreads = proposals.map((p) => ({
      ...p,
      thread: propMsgMap[p.id] || [],
    }));

    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS author_name, u.email AS author_email, u.role AS author_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at ASC`,
    );

    const feedbackIds = feedbacks.map((f) => f.id);
    const allFbMsgs = feedbackIds.length
      ? await db.all(
          `SELECT fm.feedback_id, fm.id, fm.user_name, fm.role, fm.text, fm.created_at
           FROM feedback_messages fm
           WHERE fm.feedback_id = ANY(?::int[])
           ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`,
          `{${feedbackIds.join(',')}}`,
        )
      : [];
    const fbMsgMap = {};
    for (const m of allFbMsgs) {
      if (!fbMsgMap[m.feedback_id]) fbMsgMap[m.feedback_id] = [];
      fbMsgMap[m.feedback_id].push(m);
    }
    const feedbacksWithThreads = feedbacks.map((f) => ({
      ...f,
      thread: fbMsgMap[f.id] || [],
    }));

    res.json({
      ts: new Date().toISOString(),
      proposals: proposalsWithThreads,
      feedbacks: feedbacksWithThreads,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// WRITE: действия для ежедневного обхода AI (GET с секретом, т.к. MCP поддерживает только GET)
// action=proposal_done&id=N
// action=proposal_create&title=T&summary=S&category=C&risk=R&source=X&feedback_id=N&proposed_changes=JSON_encoded
// action=proposal_msg&id=N&text=T
// action=proposal_revision&id=N&summary=S&notes=N
// action=feedback_msg&fid=N&text=T
// action=feedback_status&fid=N&status=S&reply=R
router.get('/write', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const { action, id, fid, text, status, reply, title, summary, category, risk, source, feedback_id, proposed_changes, notes } = req.query;

  try {
    if (action === 'proposal_done') {
      const pid = Number(id);
      if (!pid) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        pid,
      );
      return res.json({ ok: true, action, id: pid });
    }

    if (action === 'proposal_create') {
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      let parsedChanges = null;
      if (proposed_changes) {
        try { parsedChanges = JSON.parse(proposed_changes); } catch { parsedChanges = null; }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        String(title),
        String(summary),
        category ? String(category) : null,
        risk ? String(risk) : 'medium',
        source ? String(source) : null,
        parsedChanges ? JSON.stringify(parsedChanges) : null,
      );
      return res.json({ ok: true, action, id: r.lastInsertRowid });
    }

    if (action === 'proposal_msg') {
      const pid = Number(id);
      if (!pid || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        pid, String(text),
      );
      return res.json({ ok: true, action, id: pid });
    }

    if (action === 'proposal_revision') {
      const pid = Number(id);
      if (!pid || !summary) return res.status(400).json({ error: 'id and summary required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'pending', summary = ?, admin_notes = NULL, updated_at = NOW() WHERE id = ?`,
        String(summary), pid,
      );
      if (notes) {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          pid, String(notes),
        );
      }
      return res.json({ ok: true, action, id: pid });
    }

    if (action === 'feedback_msg') {
      const feedbackId = Number(fid);
      if (!feedbackId || !text) return res.status(400).json({ error: 'fid and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        feedbackId, String(text),
      );
      return res.json({ ok: true, action, fid: feedbackId });
    }

    if (action === 'feedback_status') {
      const feedbackId = Number(fid);
      if (!feedbackId || !status) return res.status(400).json({ error: 'fid and status required' });
      if (reply) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
          String(status), String(reply), feedbackId,
        );
      } else {
        await db.run(
          `UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`,
          String(status), feedbackId,
        );
      }
      return res.json({ ok: true, action, fid: feedbackId, status });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
