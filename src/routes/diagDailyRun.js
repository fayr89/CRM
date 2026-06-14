// TEMPORARY — AI daily run 2026-06-14-s61. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'daily-2026-06-14-s61';

const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action } = req.query;

    // --- READ ALL: feedback + ai_proposals ---
    if (!action || action === 'read_all') {
      const feedbacks = await db.all(
        `SELECT f.id, f.status, f.subject, f.message, f.category,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','in_progress','awaiting_approval')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      const threads = {};
      for (const fb of feedbacks) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        threads[fb.id] = msgs;
      }
      const proposals = {};
      for (const st of ['approved', 'revision', 'rejected', 'pending']) {
        proposals[st] = await db.all(
          `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                  p.status, p.feedback_id, p.admin_notes, p.proposed_changes,
                  p.created_at, p.updated_at
           FROM ai_proposals p WHERE p.status = ?
           ORDER BY p.created_at DESC LIMIT 50`,
          st,
        );
      }
      const proposalThreads = {};
      const allProposalIds = Object.values(proposals).flat().map((p) => p.id);
      for (const pid of allProposalIds) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          pid,
        );
        proposalThreads[pid] = msgs;
      }
      return res.json({ feedbacks, threads, proposals, proposalThreads });
    }

    // --- POST message to feedback thread ---
    if (action === 'post_fb_msg') {
      const fb_id = Number(req.query.fb_id);
      const text = req.query.text ? String(req.query.text) : null;
      const uname = req.query.user_name ? String(req.query.user_name) : 'AI ассистент';
      if (!fb_id || !text) return res.status(400).json({ error: 'fb_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fb_id);
      if (!fb) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
        fb_id, uname, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- PATCH feedback status ---
    if (action === 'update_feedback') {
      const fb_id = Number(req.query.fb_id);
      const status = req.query.status ? String(req.query.status) : null;
      const admin_reply = req.query.admin_reply ? String(req.query.admin_reply) : null;
      if (!fb_id) return res.status(400).json({ error: 'fb_id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fb_id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?, resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW() WHERE id = ?`,
        newStatus, admin_reply, justResolved ? 0 : cur.resolved_by, fb_id,
      );
      return res.json({ ok: true, id: fb_id, status: newStatus });
    }

    // --- CREATE ai_proposal ---
    if (action === 'create_proposal') {
      const title = req.query.title ? String(req.query.title) : null;
      const summary = req.query.summary ? String(req.query.summary) : null;
      const category = req.query.category ? String(req.query.category) : 'feature';
      const risk = req.query.risk ? String(req.query.risk) : 'medium';
      const source = req.query.source ? String(req.query.source) : `daily-run-2026-06-14`;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes ? String(req.query.proposed_changes) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category, risk, source,
        proposed_changes ?? null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- PATCH ai_proposal (decision) ---
    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision ? String(req.query.decision) : null;
      const notes = req.query.notes ? String(req.query.notes) : null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?,
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json({ ok: true, id, status: decision });
    }

    // --- POST message to ai_proposal thread ---
    if (action === 'post_proposal_msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? String(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }),
);

export default router;
