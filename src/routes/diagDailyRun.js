// TEMP: ежедневный AI-обход. Удалить сразу после использования.
// Отдаёт JWT + все нужные данные + write-операции через GET (Vercel MCP только GET).
import { Router } from 'express';
import { db } from '../db.js';
import { signToken } from '../auth.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr-2026-06-11-tvkj8g';

function checkSecret(req, res) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?s=… — JWT + proposals + feedbacks
router.get(
  '/daily-run',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    const admin = await db.get(
      `SELECT id, email, name, role FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1`,
    );
    if (!admin) return res.status(503).json({ error: 'no admin user' });

    const token = signToken(admin);

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const feedbackIds = feedbacks.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    const pmByProposal = {};
    for (const m of proposalMessages) {
      if (!pmByProposal[m.proposal_id]) pmByProposal[m.proposal_id] = [];
      pmByProposal[m.proposal_id].push(m);
    }

    const fmByFeedback = {};
    for (const m of feedbackMessages) {
      if (!fmByFeedback[m.feedback_id]) fmByFeedback[m.feedback_id] = [];
      fmByFeedback[m.feedback_id].push(m);
    }

    res.json({
      token,
      proposals: proposals.map((p) => ({ ...p, messages: pmByProposal[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: fmByFeedback[f.id] || [] })),
    });
  }),
);

// GET /api/diag/feedback-msg?s=…&fid=ID&text=…
// Добавить сообщение в тред обращения от «AI ассистент»
router.get(
  '/feedback-msg',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const fid = Number(req.query.fid);
    const text = String(req.query.text || '').trim();
    if (!fid || !text) return res.status(400).json({ error: 'fid and text required' });

    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fid);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });

    const admin = await db.get(
      `SELECT id FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1`,
    );

    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
      fid,
      admin?.id ?? null,
      text,
    );
    res.json({ ok: true });
  }),
);

// GET /api/diag/feedback-close?s=…&fid=ID&reason=…
// Закрыть обращение + добавить финальное сообщение
router.get(
  '/feedback-close',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const fid = Number(req.query.fid);
    const reason = String(req.query.reason || '').trim();
    if (!fid) return res.status(400).json({ error: 'fid required' });

    const fb = await db.get('SELECT id, status FROM feedback WHERE id = ?', fid);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });

    const admin = await db.get(
      `SELECT id FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1`,
    );

    await db.run(
      `UPDATE feedback SET status = 'closed', updated_at = NOW() WHERE id = ?`,
      fid,
    );

    if (reason) {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        fid,
        admin?.id ?? null,
        reason,
      );
    }

    res.json({ ok: true, closed: fid });
  }),
);

// GET /api/diag/proposal-create?s=…&title=…&summary=…&category=…&risk=…&feedback_id=…
// Создать AI-proposal
router.get(
  '/proposal-create',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const title = String(req.query.title || '').trim();
    const summary = String(req.query.summary || '').trim();
    const category = String(req.query.category || 'feature');
    const risk = String(req.query.risk || 'medium');
    const source = `daily-run-${new Date().toISOString().slice(0, 10)}`;
    const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;

    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });

    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, NULL) RETURNING id`,
      feedbackId,
      title,
      summary,
      category,
      risk,
      source,
    );
    const created = await db.get('SELECT id, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.json({ ok: true, proposal: created });
  }),
);

// GET /api/diag/proposal-msg?s=…&pid=ID&text=…
// Добавить сообщение в тред proposal
router.get(
  '/proposal-msg',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const pid = Number(req.query.pid);
    const text = String(req.query.text || '').trim();
    if (!pid || !text) return res.status(400).json({ error: 'pid and text required' });

    const p = await db.get('SELECT id FROM ai_proposals WHERE id = ?', pid);
    if (!p) return res.status(404).json({ error: 'proposal not found' });

    const admin = await db.get(
      `SELECT id FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1`,
    );

    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
      pid,
      admin?.id ?? null,
      text,
    );
    res.json({ ok: true });
  }),
);

export default router;
