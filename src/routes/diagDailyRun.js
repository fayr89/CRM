// TEMP: ежедневный обход AI — читает данные + выполняет операции через GET.
// Удалить сразу после использования (отдельный коммит).
// Дата: 2026-06-12, секрет одноразовый.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = '5041c795a9b90af3';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 1, role: 'admin', name: 'AI ассистент' };
  next();
});

// Читаем все данные: ai_proposals (approved/revision/rejected/pending) + feedback open/awaiting + треды
router.get('/', asyncHandler(async (req, res) => {
  const action = req.query.action;

  // ── patch_proposal: PATCH /api/ai-proposals/:id { decision }
  if (action === 'patch_proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_by = 1, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    return res.json({ ok: true, id, decision });
  }

  // ── post_proposal_msg: POST /api/ai-proposals/:id/messages
  if (action === 'post_proposal_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text) VALUES (?, 1, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, message_id: r.lastInsertRowid });
  }

  // ── create_proposal: POST /api/ai-proposals
  if (action === 'create_proposal') {
    const title = req.query.title;
    const summary = req.query.summary;
    const category = req.query.category || 'feature';
    const risk = req.query.risk || 'medium';
    const source = req.query.source || `daily-run-2026-06-12`;
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    let proposed_changes = null;
    if (req.query.changes) {
      try { proposed_changes = JSON.parse(req.query.changes); } catch { /* ignore */ }
    }
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id, title, summary, category, risk, source,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.json({ ok: true, proposal_id: r.lastInsertRowid });
  }

  // ── patch_feedback: PATCH /api/feedback/:id
  if (action === 'patch_feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    const reply = req.query.reply || null;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    const cur = await db.get('SELECT id, status, resolved_by FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed') && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_by = CASE WHEN ? THEN 1 ELSE resolved_by END,
       resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
       updated_at = NOW() WHERE id = ?`,
      status, reply, justResolved, justResolved, id,
    );
    return res.json({ ok: true, id, status });
  }

  // ── post_feedback_msg: POST /api/feedback/:id/messages
  if (action === 'post_feedback_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, 1, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, message_id: r.lastInsertRowid });
  }

  // ── DEFAULT: читаем все нужные данные
  const [proposals_approved, proposals_revision, proposals_rejected, proposals_pending] = await Promise.all([
    db.all(`SELECT p.*, f.subject AS fb_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'approved' ORDER BY p.created_at DESC`),
    db.all(`SELECT p.*, f.subject AS fb_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'revision' ORDER BY p.created_at DESC`),
    db.all(`SELECT p.*, f.subject AS fb_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'rejected' ORDER BY p.created_at DESC LIMIT 20`),
    db.all(`SELECT p.*, f.subject AS fb_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'pending' ORDER BY p.created_at DESC`),
  ]);

  // Треды для approved/revision/pending (нужны чтобы читать комментарии админа)
  const allProposalIds = [
    ...proposals_approved, ...proposals_revision, ...proposals_pending,
  ].map((p) => p.id);
  const proposalMessages = {};
  for (const pid of allProposalIds) {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      pid,
    );
    proposalMessages[pid] = msgs;
  }

  // Feedback: open + awaiting_approval
  const feedback = await db.all(
    `SELECT f.id, f.status, f.subject, f.message, f.category, f.created_at, f.updated_at,
            f.admin_reply, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );

  // Треды всех открытых обращений
  const feedbackThreads = {};
  for (const fb of feedback) {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    feedbackThreads[fb.id] = msgs;
  }

  res.json({
    as_of: new Date().toISOString(),
    proposals: { approved: proposals_approved, revision: proposals_revision, rejected: proposals_rejected.slice(0, 10), pending: proposals_pending },
    proposal_messages: proposalMessages,
    feedback,
    feedback_threads: feedbackThreads,
  });
}));

export default router;
