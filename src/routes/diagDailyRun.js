// ВРЕМЕННЫЙ эндпоинт для ежедневного обхода AI. Снести сразу после использования.
// GET /api/diag/daily-run?secret=c9f3e82a47b
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'c9f3e82a47b';

router.get(
  '/daily-run',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(403).json({ error: 'Forbidden' });

    // Если есть write-операции — выполнить их и вернуть результаты
    if (req.query.write) {
      let actions;
      try {
        actions = JSON.parse(decodeURIComponent(req.query.write));
      } catch {
        return res.status(400).json({ error: 'Invalid write JSON' });
      }
      const results = [];
      for (const a of actions) {
        try {
          if (a.type === 'proposal-done') {
            await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = $1`, a.id);
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'proposal-update') {
            await db.run(
              `UPDATE ai_proposals SET summary = COALESCE($1, summary),
               proposed_changes = COALESCE($2::jsonb, proposed_changes),
               status = 'pending', admin_notes = NULL, updated_at = NOW() WHERE id = $3`,
              a.summary ?? null,
              a.proposed_changes ? JSON.stringify(a.proposed_changes) : null,
              a.id,
            );
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'feedback-status') {
            await db.run(
              `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply), updated_at = NOW() WHERE id = $3`,
              a.status,
              a.reply ?? null,
              a.id,
            );
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'feedback-message') {
            await db.run(
              `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
               VALUES ($1, 0, 'AI ассистент', 'admin', $2)`,
              a.feedback_id,
              a.text,
            );
            results.push({ type: a.type, feedback_id: a.feedback_id, ok: true });
          } else if (a.type === 'proposal-message') {
            await db.run(
              `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
               VALUES ($1, 0, 'AI ассистент', 'admin', $2)`,
              a.proposal_id,
              a.text,
            );
            results.push({ type: a.type, proposal_id: a.proposal_id, ok: true });
          } else if (a.type === 'create-proposal') {
            const r = await db.run(
              `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
              a.feedback_id ?? null,
              a.title,
              a.summary,
              a.category ?? 'feature',
              a.risk ?? 'medium',
              a.source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
              a.proposed_changes ? JSON.stringify(a.proposed_changes) : null,
            );
            results.push({ type: a.type, id: r.rows?.[0]?.id, ok: true });
          } else {
            results.push({ type: a.type, ok: false, error: 'Unknown action' });
          }
        } catch (e) {
          results.push({ type: a.type, ok: false, error: e.message });
        }
      }
      return res.json({ write_results: results });
    }

    // Иначе — вернуть все данные для анализа
    const [approved, revision, rejected, pending, feedbackRows] = await Promise.all([
      db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC LIMIT 20`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC`),
      db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      ),
    ]);

    for (const p of [...approved, ...revision, ...pending]) {
      p.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = $1 ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    for (const f of feedbackRows) {
      f.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM feedback_messages
         WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
        f.id,
      );
    }

    res.json({
      proposals: { approved, revision, rejected, pending },
      feedback: feedbackRows,
    });
  }),
);

export default router;
