// TEMP: ежедневный diag-эндпоинт для AI-обхода 2026-06-18-v2 (удалить после use)
// Секрет одноразовый, передаётся в query: ?s=Mn7qVx3pKt9R
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'Mn7qVx3pKt9R';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-run?s=... — все данные для AI-обхода
router.get('/', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending, feedbackOpen] = await Promise.all([
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
            WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 30`),
    db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
            FROM feedback f LEFT JOIN users u ON u.id = f.user_id
            WHERE f.status IN ('open','awaiting_approval')
            ORDER BY f.created_at DESC LIMIT 50`),
  ]);

  const feedbackIds = feedbackOpen.map(f => f.id);
  let feedbackMessages = [];
  if (feedbackIds.length) {
    feedbackMessages = await db.all(
      `SELECT fm.* FROM feedback_messages fm
       WHERE fm.feedback_id = ANY(?::int[])
       ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`,
      `{${feedbackIds.join(',')}}`,
    );
  }

  const proposalIds = [...approved, ...revision, ...pending, ...rejected].map(p => p.id);
  let proposalMessages = [];
  if (proposalIds.length) {
    proposalMessages = await db.all(
      `SELECT m.* FROM ai_proposal_messages m
       WHERE m.proposal_id = ANY(?::int[])
       ORDER BY m.proposal_id, m.created_at ASC, m.id ASC`,
      `{${proposalIds.join(',')}}`,
    );
  }

  res.json({
    ai_proposals: { approved, revision, rejected, pending },
    feedback: feedbackOpen,
    feedback_messages: feedbackMessages,
    proposal_messages: proposalMessages,
  });
}));

// GET /write-fb-msg?s=...&fid=X&text=... — написать в тред обращения от «AI ассистент»
router.get('/write-fb-msg', asyncHandler(async (req, res) => {
  const fid = Number(req.query.fid);
  const text = String(req.query.text || '').trim();
  if (!fid || !text) return res.status(400).json({ error: 'fid and text required' });
  const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fid);
  if (!fb) return res.status(404).json({ error: 'feedback not found' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    fid, text,
  );
  res.json({ ok: true, msg_id: r.lastInsertRowid });
}));

// GET /patch-feedback?s=...&fid=X&status=...&reply=... — обновить статус/ответ обращения
router.get('/patch-feedback', asyncHandler(async (req, res) => {
  const fid = Number(req.query.fid);
  const status = String(req.query.status || '').trim() || null;
  const reply = String(req.query.reply || '').trim() || null;
  if (!fid) return res.status(400).json({ error: 'fid required' });
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fid);
  if (!cur) return res.status(404).json({ error: 'feedback not found' });
  const newStatus = status || cur.status;
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
    newStatus, reply, fid,
  );
  res.json({ ok: true, id: fid, status: newStatus });
}));

// GET /post-proposal?s=...&fid=X&title=...&summary=...&category=...&risk=...&source=... — создать ai_proposal
router.get('/post-proposal', asyncHandler(async (req, res) => {
  const title = String(req.query.title || '').trim();
  const summary = String(req.query.summary || '').trim();
  const category = String(req.query.category || 'feature').trim();
  const risk = String(req.query.risk || 'medium').trim();
  const source = String(req.query.source || 'daily-run-2026-06-18').trim();
  const fid = req.query.fid ? Number(req.query.fid) : null;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    fid, title, summary, category, risk, source,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// GET /patch-proposal?s=...&pid=X&decision=done — обновить статус proposal
router.get('/patch-proposal', asyncHandler(async (req, res) => {
  const pid = Number(req.query.pid);
  const decision = String(req.query.decision || '').trim();
  if (!pid || !decision) return res.status(400).json({ error: 'pid and decision required' });
  const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', pid);
  if (!cur) return res.status(404).json({ error: 'proposal not found' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
    decision, pid,
  );
  res.json({ ok: true, id: pid, status: decision });
}));

// GET /write-proposal-msg?s=...&pid=X&text=... — написать в тред proposal от «AI ассистент»
router.get('/write-proposal-msg', asyncHandler(async (req, res) => {
  const pid = Number(req.query.pid);
  const text = String(req.query.text || '').trim();
  if (!pid || !text) return res.status(400).json({ error: 'pid and text required' });
  const prop = await db.get('SELECT id FROM ai_proposals WHERE id = ?', pid);
  if (!prop) return res.status(404).json({ error: 'proposal not found' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    pid, text,
  );
  res.json({ ok: true, msg_id: r.lastInsertRowid });
}));

export default router;
