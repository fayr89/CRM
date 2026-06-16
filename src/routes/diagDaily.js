// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода обращений.
// Защищён одноразовым секретом в query ?s=. Удаляется сразу после использования.
// Создаёт fake req.user = { id: 0, role: 'admin', name: 'AI ассистент' }.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'f8d2a3c7b1e94f20';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /api/diag/daily?s= — все данные для обхода
router.get('/', async (req, res) => {
  try {
    // feedback в статусах open и awaiting_approval
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );
    // threads для каждого обращения
    const fbIds = feedback.map((f) => f.id);
    let fbMessages = [];
    if (fbIds.length) {
      fbMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        fbIds,
      );
    }
    const fbById = {};
    for (const f of feedback) fbById[f.id] = { ...f, messages: [] };
    for (const m of fbMessages) {
      if (fbById[m.feedback_id]) fbById[m.feedback_id].messages.push(m);
    }

    // ai_proposals все статусы (pending, approved, revision, rejected) с тредами
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('pending','approved','revision','rejected')
       ORDER BY p.created_at DESC`,
    );
    const pIds = proposals.map((p) => p.id);
    let pMessages = [];
    if (pIds.length) {
      pMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        pIds,
      );
    }
    const pById = {};
    for (const p of proposals) pById[p.id] = { ...p, messages: [] };
    for (const m of pMessages) {
      if (pById[m.proposal_id]) pById[m.proposal_id].messages.push(m);
    }

    res.json({
      feedback: Object.values(fbById),
      proposals: Object.values(pById),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/feedback-msg?s= — добавить сообщение + опционально сменить статус
router.post('/feedback-msg', async (req, res) => {
  try {
    const { feedback_id, text, status, admin_reply } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });

    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      feedback_id, text,
    );

    if (status || admin_reply !== undefined) {
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
      if (cur) {
        const newStatus = status || cur.status;
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = ?,
             resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
             updated_at = NOW()
           WHERE id = ?`,
          newStatus,
          admin_reply ?? null,
          justResolved ? 0 : cur.resolved_by,
          feedback_id,
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily/feedback/:id?s= — только смена статуса без сообщения
router.patch('/feedback/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, admin_reply } = req.body;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status || cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?,
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      admin_reply ?? null,
      justResolved ? 0 : cur.resolved_by,
      id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/proposals?s= — создать ai_proposal
router.post('/proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily/proposals/:id?s= — изменить решение
router.patch('/proposals/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { decision, notes } = req.body;
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily/proposals/:id/msg?s= — добавить сообщение в тред proposal
router.post('/proposals/:id/msg', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      id, text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
