// TEMP: daily AI run diag endpoint 2026-06-11-v4. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr_20260611_v4_9kx2m7';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const { action } = req.query;
  try {
    // --- SNAPSHOT: вернуть все предложения + открытые обращения с тредами ---
    if (action === 'snapshot') {
      const [approvedP, revisionP, rejectedP, pendingP] = await Promise.all([
        db.all(`SELECT * FROM ai_proposals WHERE status='approved' ORDER BY created_at DESC`),
        db.all(`SELECT * FROM ai_proposals WHERE status='revision' ORDER BY created_at DESC`),
        db.all(`SELECT * FROM ai_proposals WHERE status='rejected' ORDER BY created_at DESC LIMIT 20`),
        db.all(`SELECT * FROM ai_proposals WHERE status='pending' ORDER BY created_at DESC LIMIT 30`),
      ]);

      const pMsgs = {};
      for (const p of [...approvedP, ...revisionP, ...rejectedP, ...pendingP]) {
        pMsgs[p.id] = await db.all(
          `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
           WHERE proposal_id=? ORDER BY created_at ASC`,
          p.id,
        );
      }

      const feedbacks = await db.all(`
        SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
               f.created_at, f.updated_at,
               u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.created_at DESC LIMIT 60
      `);

      const fMsgs = {};
      for (const fb of feedbacks) {
        fMsgs[fb.id] = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id=? ORDER BY created_at ASC`,
          fb.id,
        );
      }

      return res.json({
        proposals: { approved: approvedP, revision: revisionP, rejected: rejectedP, pending: pendingP },
        pMsgs,
        feedbacks,
        fMsgs,
        ts: new Date().toISOString(),
      });
    }

    // --- BATCH: массовое выполнение операций записи ---
    if (action === 'batch') {
      const base64 = (req.query.b64 || '').replace(/-/g, '+').replace(/_/g, '/');
      const ops = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      const results = [];

      for (const op of ops) {
        try {
          switch (op.t) {
            case 'mark_done':
              await db.run(
                `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`,
                op.id,
              );
              results.push({ t: op.t, id: op.id, ok: true });
              break;

            case 'proposal_msg':
              await db.run(
                `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
                 VALUES (?, NULL, ?, 'admin', ?)`,
                op.id, 'AI ассистент', op.text,
              );
              results.push({ t: op.t, id: op.id, ok: true });
              break;

            case 'feedback_msg':
              await db.run(
                `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
                 VALUES (?, NULL, ?, 'admin', ?)`,
                op.id, 'AI ассистент', op.text,
              );
              results.push({ t: op.t, id: op.id, ok: true });
              break;

            case 'feedback_update': {
              const sets = ['updated_at=NOW()'];
              const params = [];
              if (op.status) { sets.push('status=?'); params.push(op.status); }
              if (op.reply != null) { sets.push('admin_reply=?'); params.push(op.reply); }
              if (op.status === 'awaiting_approval' || op.status === 'closed') {
                sets.push('resolved_at=NOW()');
              }
              params.push(op.id);
              await db.run(`UPDATE feedback SET ${sets.join(',')} WHERE id=?`, ...params);
              results.push({ t: op.t, id: op.id, ok: true });
              break;
            }

            case 'create_proposal': {
              const r = await db.run(
                `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
                 VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
                op.feedback_id ?? null,
                op.title,
                op.summary,
                op.category ?? null,
                op.risk || 'medium',
                op.source ?? null,
                op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
              );
              results.push({ t: op.t, ok: true, new_id: r.lastInsertRowid });
              break;
            }

            default:
              results.push({ t: op.t, ok: false, error: 'unknown op type' });
          }
        } catch (e) {
          results.push({ t: op?.t, id: op?.id, ok: false, error: e.message });
        }
      }
      return res.json({ results });
    }

    res.status(400).json({ error: 'unknown action. use snapshot or batch' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
