// ВРЕМЕННЫЙ эндпоинт для AI daily-run — удалить сразу после использования!
// Секрет: f9k2px7nw4 (одноразовый, не использовать повторно).
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'f9k2px7nw4';
const router = Router();

// GET /api/diag/daily-f9k2px7nw4?s=SECRET          — читает все данные
// GET /api/diag/daily-f9k2px7nw4?s=SECRET&payload=BASE64_JSON — выполняет действия
// payload — base64(JSON): [{action, ...params}] или один объект {action, ...params}
router.get('/daily-f9k2px7nw4', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });

  try {
    if (!req.query.payload) {
      // READ mode
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id, fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status IN ('approved','revision','rejected','pending')
         ORDER BY (CASE p.status
           WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
           WHEN 'rejected' THEN 2 ELSE 3 END), p.created_at DESC`,
      );
      for (const p of proposals) {
        p.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }

      const feedback = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','in_progress','awaiting_approval')
         ORDER BY f.created_at ASC`,
      );
      for (const f of feedback) {
        f.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          f.id,
        );
      }

      return res.json({ proposals, feedback });
    }

    // WRITE mode: decode base64 payload → array of actions
    const raw = Buffer.from(req.query.payload, 'base64').toString('utf8');
    const batch = JSON.parse(raw);
    const actions = Array.isArray(batch) ? batch : [batch];
    const results = [];

    for (const act of actions) {
      const { action } = act;
      try {
        if (action === 'post_fb_msg') {
          const { fb_id, text } = act;
          const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fb_id);
          if (!fb) { results.push({ action, error: 'not found', fb_id }); continue; }
          const r = await db.run(
            `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
             VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
            fb_id, text,
          );
          results.push({ action, ok: true, id: r.lastInsertRowid });

        } else if (action === 'patch_feedback') {
          const { id, status, admin_reply } = act;
          const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
          if (!cur) { results.push({ action, error: 'not found', id }); continue; }
          const newStatus = status || cur.status;
          const sets = ['status = ?', 'updated_at = NOW()'];
          const params = [newStatus];
          if (admin_reply !== undefined && admin_reply !== null) {
            sets.push('admin_reply = ?'); params.push(admin_reply);
          }
          if ((newStatus === 'awaiting_approval' || newStatus === 'closed')
            && cur.status !== 'awaiting_approval' && cur.status !== 'closed') {
            sets.push('resolved_at = NOW()');
          }
          params.push(id);
          await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
          results.push({ action, ok: true, id, status: newStatus });

        } else if (action === 'create_proposal') {
          const { feedback_id, title, summary, category, risk, source, proposed_changes } = act;
          if (!title || !summary) { results.push({ action, error: 'title+summary required' }); continue; }
          const r = await db.run(
            `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
             VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
            feedback_id ?? null,
            title,
            summary,
            category ?? null,
            risk ?? 'medium',
            source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
            proposed_changes ? JSON.stringify(proposed_changes) : null,
          );
          results.push({ action, ok: true, id: r.lastInsertRowid });

        } else if (action === 'patch_proposal') {
          const { id, decision, notes } = act;
          const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
          if (!cur) { results.push({ action, error: 'not found', id }); continue; }
          await db.run(
            `UPDATE ai_proposals SET status = ?,
             admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
            decision, notes ?? null, id,
          );
          results.push({ action, ok: true, id });

        } else if (action === 'post_prop_msg') {
          const { prop_id, text } = act;
          const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', prop_id);
          if (!cur) { results.push({ action, error: 'not found', prop_id }); continue; }
          const r = await db.run(
            `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
             VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
            prop_id, text,
          );
          results.push({ action, ok: true, id: r.lastInsertRowid });

        } else {
          results.push({ action, error: 'unknown action' });
        }
      } catch (e) {
        results.push({ action, error: e.message });
      }
    }

    return res.json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
