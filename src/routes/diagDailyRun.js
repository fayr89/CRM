// ВРЕМЕННЫЙ диаг-роут для ежедневного AI-обхода. УДАЛИТЬ после использования.
// Защищён одноразовым секретом в query-параметре ?secret=
// Все операции через GET (Vercel MCP fetch поддерживает только GET).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const DIAG_SECRET = 'DAILY_06_07_k7NpX9vQ';

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

function b64dec(s) {
  if (!s) return null;
  return Buffer.from(s, 'base64').toString('utf8');
}

router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const op = req.query.op || 'read';

    // ─── READ: все данные для ежедневного обхода ───────────────────────────
    if (op === 'read') {
      const [approved, revision, rejected, pending, allFeedback] = await Promise.all([
        db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
                FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'approved' ORDER BY p.updated_at DESC`),
        db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
                FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'revision' ORDER BY p.updated_at DESC`),
        db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
                FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'rejected' ORDER BY p.updated_at DESC`),
        db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
                FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'pending' ORDER BY p.updated_at DESC`),
        db.all(`SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                       f.created_at, f.updated_at,
                       u.name AS user_name, u.email AS user_email, u.role AS user_role
                FROM feedback f LEFT JOIN users u ON u.id = f.user_id
                WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
                ORDER BY f.created_at DESC`),
      ]);

      // Треды обращений
      const fbIds = allFeedback.map(f => f.id);
      const fbMessages = fbIds.length
        ? await db.all(
            `SELECT feedback_id, id, user_id, user_name, role, text, created_at
             FROM feedback_messages
             WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[])
             ORDER BY created_at ASC, id ASC`,
          )
        : [];

      // Треды proposals (approved + revision + rejected + pending)
      const allProposals = [...approved, ...revision, ...rejected, ...pending];
      const propIds = allProposals.map(p => p.id);
      const propMessages = propIds.length
        ? await db.all(
            `SELECT proposal_id, id, user_id, user_name, role, text, created_at
             FROM ai_proposal_messages
             WHERE proposal_id = ANY(ARRAY[${propIds.join(',')}]::int[])
             ORDER BY created_at ASC, id ASC`,
          )
        : [];

      const fbThreads = {};
      for (const m of fbMessages) {
        if (!fbThreads[m.feedback_id]) fbThreads[m.feedback_id] = [];
        fbThreads[m.feedback_id].push(m);
      }
      const propThreads = {};
      for (const m of propMessages) {
        if (!propThreads[m.proposal_id]) propThreads[m.proposal_id] = [];
        propThreads[m.proposal_id].push(m);
      }

      return res.json({
        ai_proposals: { approved, revision, rejected, pending },
        proposal_threads: propThreads,
        feedback: allFeedback.map(f => ({ ...f, messages: fbThreads[f.id] || [] })),
      });
    }

    // ─── PATCH PROPOSAL STATUS ─────────────────────────────────────────────
    if (op === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      const validDecisions = ['approved', 'rejected', 'revision', 'done'];
      if (!validDecisions.includes(decision)) return res.status(400).json({ error: 'invalid decision' });
      const notes = b64dec(req.query.notes_b64) || null;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes, id,
      );
      return res.json({ ok: true, id, decision });
    }

    // ─── CREATE PROPOSAL ───────────────────────────────────────────────────
    if (op === 'create_proposal') {
      const title = b64dec(req.query.title_b64) || req.query.title || '';
      const summary = b64dec(req.query.summary_b64) || '';
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changesRaw = b64dec(req.query.changes_b64);
      const proposedChanges = changesRaw ? JSON.parse(changesRaw) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
        proposedChanges ? JSON.stringify(proposedChanges) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // ─── POST MESSAGE TO PROPOSAL THREAD ──────────────────────────────────
    if (op === 'post_proposal_msg') {
      const proposalId = Number(req.query.proposal_id);
      const text = b64dec(req.query.text_b64) || req.query.text || '';
      if (!proposalId || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposalId, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // ─── PATCH FEEDBACK STATUS ─────────────────────────────────────────────
    if (op === 'patch_feedback') {
      const id = Number(req.query.feedback_id);
      const status = req.query.status;
      const adminReply = b64dec(req.query.reply_b64) || null;
      if (!id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
      const valid = ['open', 'in_progress', 'awaiting_approval', 'closed'];
      if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        status, adminReply, id,
      );
      return res.json({ ok: true, id, status });
    }

    // ─── POST MESSAGE TO FEEDBACK THREAD ──────────────────────────────────
    if (op === 'post_feedback_msg') {
      const feedbackId = Number(req.query.feedback_id);
      const text = b64dec(req.query.text_b64) || req.query.text || '';
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        feedbackId, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `unknown op: ${op}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
