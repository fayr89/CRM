// ВРЕМЕННЫЙ диагностический эндпоинт для AI-ежедневного обхода.
// Удалить сразу после использования!
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-07-v9';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const proposals_approved = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = 'approved'
       ORDER BY p.created_at DESC`,
    );
    const proposals_revision = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = 'revision'
       ORDER BY p.created_at DESC`,
    );
    const proposals_rejected = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = 'rejected'
       ORDER BY p.created_at DESC`,
    );
    const proposals_pending = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC`,
    );
    // Треды всех предложений (кроме done)
    const allProposalIds = [
      ...proposals_approved,
      ...proposals_revision,
      ...proposals_rejected,
      ...proposals_pending,
    ].map(p => p.id);
    let proposal_messages = [];
    if (allProposalIds.length > 0) {
      proposal_messages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${allProposalIds.join(',')}]::int[])
         ORDER BY proposal_id, created_at ASC`,
      );
    }
    // Все открытые и awaiting_approval обращения с тредами
    const feedback = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const feedbackIds = feedback.map(f => f.id);
    let feedback_messages = [];
    if (feedbackIds.length > 0) {
      feedback_messages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY feedback_id, created_at ASC`,
      );
    }
    res.json({
      proposals_approved,
      proposals_revision,
      proposals_rejected,
      proposals_pending,
      proposal_messages,
      feedback,
      feedback_messages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
