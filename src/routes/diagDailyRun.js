// ВРЕМЕННЫЙ эндпоинт для AI-daily-обхода. Снести отдельным коммитом после использования.
// GET /api/diag/daily-run?secret=DAILY_SECRET_2306A&mode=read
// GET /api/diag/daily-run?secret=DAILY_SECRET_2306A&mode=exec&ops=BASE64_JSON
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { notify, notifyAdmins } from '../services/notifications.js';

const router = Router();
const SECRET = 'DAILY_SECRET_2306A';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

    const mode = req.query.mode || 'read';

    if (mode === 'read') {
      const proposals = await db.all(`
        SELECT p.id, p.title, p.summary, p.category, p.risk, p.status, p.source,
               p.feedback_id, p.admin_notes, p.proposed_changes,
               p.created_at, p.updated_at, p.admin_decision_at,
               COALESCE(
                 json_agg(
                   json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,
                                     'text',m.text,'created_at',m.created_at)
                   ORDER BY m.created_at ASC, m.id ASC
                 ) FILTER (WHERE m.id IS NOT NULL), '[]'::json
               ) AS messages
        FROM ai_proposals p
        LEFT JOIN ai_proposal_messages m ON m.proposal_id = p.id
        WHERE p.status IN ('approved','revision','rejected','pending')
        GROUP BY p.id
        ORDER BY CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'rejected' THEN 2 ELSE 3 END, p.created_at DESC
      `);

      const feedback = await db.all(`
        SELECT f.id, f.subject, f.message, f.category, f.status, f.admin_reply,
               f.created_at, f.updated_at, f.user_id,
               u.name AS user_name, u.email AS user_email, u.role AS user_role,
               COALESCE(
                 json_agg(
                   json_build_object('id',m.id,'user_id',m.user_id,'user_name',m.user_name,
                                     'role',m.role,'text',m.text,'created_at',m.created_at)
                   ORDER BY m.created_at ASC, m.id ASC
                 ) FILTER (WHERE m.id IS NOT NULL), '[]'::json
               ) AS messages
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        LEFT JOIN feedback_messages m ON m.feedback_id = f.id
        WHERE f.status IN ('open','awaiting_approval')
        GROUP BY f.id, u.name, u.email, u.role
        ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.created_at ASC
      `);

      return res.json({ proposals, feedback, ts: new Date().toISOString() });
    }

    if (mode === 'exec') {
      const opsRaw = req.query.ops;
      if (!opsRaw) return res.status(400).json({ error: 'ops required' });
      let ops;
      try {
        ops = JSON.parse(Buffer.from(opsRaw, 'base64').toString('utf8'));
      } catch (e) {
        return res.status(400).json({ error: 'invalid ops: ' + e.message });
      }

      const results = [];
      for (const op of ops) {
        try {
          if (op.type === 'proposal_patch') {
            await db.run(
              `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
              op.decision, op.id,
            );
            results.push({ op: op.type, id: op.id, ok: true });
          } else if (op.type === 'proposal_create') {
            const d = op.data;
            const r = await db.run(
              `INSERT INTO ai_proposals
               (feedback_id, title, summary, category, risk, source, proposed_changes)
               VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
              d.feedback_id ?? null, d.title, d.summary, d.category ?? null,
              d.risk ?? 'medium', d.source ?? null,
              d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
            );
            results.push({ op: op.type, id: r.lastInsertRowid, ok: true });
          } else if (op.type === 'proposal_message') {
            await db.run(
              `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
               VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
              op.proposal_id, op.text,
            );
            results.push({ op: op.type, proposal_id: op.proposal_id, ok: true });
          } else if (op.type === 'feedback_message') {
            const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = ?', op.feedback_id);
            if (!fb) { results.push({ op: op.type, feedback_id: op.feedback_id, ok: false, error: 'not found' }); continue; }
            const r = await db.run(
              `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
               VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
              op.feedback_id, op.text,
            );
            if (fb.user_id) {
              try {
                await notify(fb.user_id, 'feedback.message',
                  `💬 Вопрос по обращению: ${fb.subject}`,
                  op.text.slice(0, 300),
                  `#/my-feedback?id=${fb.id}`,
                );
              } catch { /* non-critical */ }
            }
            results.push({ op: op.type, feedback_id: op.feedback_id, message_id: r.lastInsertRowid, ok: true });
          } else if (op.type === 'feedback_status') {
            const cur = await db.get('SELECT * FROM feedback WHERE id = ?', op.feedback_id);
            if (!cur) { results.push({ op: op.type, feedback_id: op.feedback_id, ok: false, error: 'not found' }); continue; }
            const newStatus = op.status;
            const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
              && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
            await db.run(
              `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
               resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
               WHERE id = ?`,
              newStatus, op.admin_reply ?? null, op.feedback_id,
            );
            if (newStatus === 'awaiting_approval' && cur.status !== 'awaiting_approval' && cur.user_id) {
              try {
                await notify(cur.user_id, 'feedback.awaiting_approval',
                  `📮 Подтвердите выполнение: ${cur.subject}`,
                  (op.admin_reply || 'AI отметил задачу как выполненную. Проверьте и подтвердите.').slice(0, 300),
                  `#/my-feedback?id=${cur.id}`,
                );
              } catch { /* non-critical */ }
            }
            results.push({ op: op.type, feedback_id: op.feedback_id, ok: true });
          } else {
            results.push({ op: op.type, ok: false, error: 'unknown op type' });
          }
        } catch (e) {
          results.push({ op: op.type, ok: false, error: e.message });
        }
      }
      return res.json({ executed: results.length, results });
    }

    return res.status(400).json({ error: 'unknown mode' });
  }),
);

export default router;
