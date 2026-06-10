// TEMP: ежедневный AI-обход обращений 2026-06-10-v11. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const S = 'd611-xQP9-daily';

function ok(req, res) {
  if (req.query.s !== S) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET /api/diag/daily-rd-v11?s=... — читать все данные одним запросом
router.get('/daily-rd-v11', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      proposals[status] = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC LIMIT 50`,
        status,
      );
    }
    const allIds = [
      ...proposals.approved,
      ...proposals.revision,
      ...proposals.rejected,
      ...proposals.pending,
    ].map((p) => p.id);
    const proposalMessages = {};
    for (const id of allIds) {
      proposalMessages[id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
    }
    const feedback = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.updated_at DESC LIMIT 100`,
    );
    const feedbackMessages = {};
    for (const fb of feedback) {
      feedbackMessages[fb.id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }
    res.json({ proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// GET /api/diag/daily-wr-v11?s=...&actions=BASE64 — пакет записей
// actions = base64(JSON) — массив action-объектов
router.get('/daily-wr-v11', async (req, res) => {
  if (!ok(req, res)) return;
  let actions;
  try {
    actions = JSON.parse(Buffer.from(req.query.actions || '', 'base64').toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid actions param' });
  }
  const results = [];
  for (const act of actions) {
    try {
      let r = {};
      if (act.type === 'patch_proposal') {
        await db.run(
          `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
           updated_at = NOW() WHERE id = ?`,
          act.status, act.admin_notes ?? null, act.id,
        );
        r = { ok: true };
      } else if (act.type === 'post_proposal_msg') {
        const ins = await db.get(
          `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
           VALUES (?, ?, 'admin', ?) RETURNING id`,
          act.proposal_id, act.user_name || 'AI ассистент', act.text,
        );
        r = { ok: true, id: ins?.id };
      } else if (act.type === 'post_feedback_msg') {
        const ins = await db.get(
          `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
           VALUES (?, ?, 'admin', ?) RETURNING id`,
          act.feedback_id, act.user_name || 'AI ассистент', act.text,
        );
        r = { ok: true, id: ins?.id };
      } else if (act.type === 'patch_feedback') {
        const sets = ['updated_at = NOW()'];
        const params = [];
        if (act.status) { sets.push('status = ?'); params.push(act.status); }
        if (act.admin_reply !== undefined) { sets.push('admin_reply = ?'); params.push(act.admin_reply); }
        await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params, act.id);
        r = { ok: true };
      } else if (act.type === 'create_proposal') {
        const ins = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          act.feedback_id ?? null, act.title, act.summary,
          act.category ?? null, act.risk ?? 'medium',
          act.source ?? 'daily-run-2026-06-10',
          act.proposed_changes ? JSON.stringify(act.proposed_changes) : null,
        );
        r = { ok: true, id: ins.lastInsertRowid };
      } else {
        r = { error: `unknown type: ${act.type}` };
      }
      results.push({ type: act.type, ...r });
    } catch (e) {
      results.push({ type: act.type, error: e.message });
    }
  }
  res.json({ results });
});

export default router;
