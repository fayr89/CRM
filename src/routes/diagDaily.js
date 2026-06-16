// TEMP — daily AI run v31 (2026-06-16). Remove after use.
// Одноразовый эндпоинт для AI-обхода: читает feedback+треды+ai_proposals,
// постит сообщения, меняет статусы, создаёт proposals.
// Секрет в ?secret=... — без него 403.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr31-f9a2c84e';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 1, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /api/diag/daily?secret=... — все feedback open/awaiting + треды + ai_proposals
router.get('/', async (req, res) => {
  try {
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    // Треды для каждого обращения
    for (const fb of feedbacks) {
      fb.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM feedback_messages
         WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    // AI proposals по статусам
    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      proposals[status] = await db.all(
        `SELECT p.*, f.subject AS feedback_subject
         FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 50`,
        status,
      );
      for (const p of proposals[status]) {
        p.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
           WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
    }

    res.json({ feedbacks, proposals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/fb-message — добавить сообщение в тред обращения
router.post('/fb-message', async (req, res) => {
  try {
    const { feedback_id, text, user_name } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
      feedback_id, 1, user_name || 'AI ассистент', text,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/fb-status — изменить статус обращения + admin_reply
router.post('/fb-status', async (req, res) => {
  try {
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      status, admin_reply || null, feedback_id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/proposal — создать ai_proposal
router.post('/proposal', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id || null, title, summary, category || null, risk || 'medium', source || null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/proposal-status — изменить статус ai_proposal
router.post('/proposal-status', async (req, res) => {
  try {
    const { proposal_id, status } = req.body;
    if (!proposal_id || !status) return res.status(400).json({ error: 'proposal_id and status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, proposal_id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/proposal-message — добавить сообщение в тред ai_proposal
router.post('/proposal-message', async (req, res) => {
  try {
    const { proposal_id, text, user_name } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?)`,
      proposal_id, 1, user_name || 'AI ассистент', text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
