// ВРЕМЕННЫЙ эндпоинт для ежедневного обхода AI. Снести сразу после использования.
// GET /api/diag/daily-run?secret=7f3d9a2c1e&write=<JSON>
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7f3d9a2c1e';

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
            await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, a.id);
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'proposal-update') {
            // Обновить summary/proposed_changes и вернуть в pending (для revision)
            await db.run(
              `UPDATE ai_proposals SET summary = COALESCE(?, summary),
               proposed_changes = COALESCE(?::jsonb, proposed_changes),
               status = 'pending', admin_notes = NULL, updated_at = NOW() WHERE id = ?`,
              a.summary ?? null,
              a.proposed_changes ? JSON.stringify(a.proposed_changes) : null,
              a.id,
            );
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'feedback-status') {
            await db.run(
              `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
              a.status,
              a.reply ?? null,
              a.id,
            );
            results.push({ type: a.type, id: a.id, ok: true });
          } else if (a.type === 'feedback-message') {
            await db.run(
              `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
               VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
              a.feedback_id,
              a.text,
            );
            results.push({ type: a.type, feedback_id: a.feedback_id, ok: true });
          } else if (a.type === 'proposal-message') {
            await db.run(
              `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
               VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
              a.proposal_id,
              a.text,
            );
            results.push({ type: a.type, proposal_id: a.proposal_id, ok: true });
          } else if (a.type === 'create-proposal') {
            const r = await db.run(
              `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
               VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
              a.feedback_id ?? null,
              a.title,
              a.summary,
              a.category ?? 'feature',
              a.risk ?? 'medium',
              a.source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
              a.proposed_changes ? JSON.stringify(a.proposed_changes) : null,
            );
            results.push({ type: a.type, id: r.lastInsertRowid, ok: true });
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

    // Треды proposal-сообщений для approved/revision/pending
    for (const p of [...approved, ...revision, ...pending]) {
      p.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    // Треды feedback-сообщений
    for (const f of feedbackRows) {
      f.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM feedback_messages
         WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
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
