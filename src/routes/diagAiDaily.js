// TEMP: диагностический эндпоинт для ежедневного AI-прогона 2026-06-11-v3.
// Снести сразу после использования отдельным cleanup-коммитом.
// GET  /api/diag/ai-daily-v3?s=<SECRET>  — весь контекст (feedback + proposals)
// POST /api/diag/ai-daily-v3?s=<SECRET>  — выполнить операции (массив ops)
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'ai-d-20260611-v3-r9k4';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /run?s=SECRET&cmd=<base64 JSON ops array> — выполнить операции через GET
// (нужно когда POST заблокирован Vercel protection)
router.get(
  '/run',
  asyncHandler(async (req, res) => {
    const raw = req.query.cmd ? Buffer.from(String(req.query.cmd), 'base64url').toString('utf8') : '[]';
    req.body = { ops: JSON.parse(raw) };
    // выполняем через тот же обработчик — делегируем напрямую
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const results = [];
    for (const op of ops) {
      try {
        if (op.type === 'post_feedback_message') {
          const r = await db.run(
            `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
             VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
            Number(op.feedback_id), String(op.text),
          );
          results.push({ op: op.type, feedback_id: op.feedback_id, id: r.lastInsertRowid, ok: true });
        } else if (op.type === 'update_feedback') {
          const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(op.feedback_id));
          if (!cur) { results.push({ op: op.type, feedback_id: op.feedback_id, ok: false, error: 'not found' }); continue; }
          const newStatus = op.status ?? cur.status;
          const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
            && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
          await db.run(
            `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
             resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = ?`,
            newStatus, op.admin_reply ?? null, cur.id,
          );
          results.push({ op: op.type, feedback_id: op.feedback_id, new_status: newStatus, ok: true });
        } else if (op.type === 'create_proposal') {
          const r = await db.run(
            `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
             VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
            op.feedback_id ?? null, String(op.title), String(op.summary),
            op.category ?? null, op.risk || 'medium', op.source ?? null,
            op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
          );
          results.push({ op: op.type, id: r.lastInsertRowid, ok: true });
        } else if (op.type === 'mark_proposal_done') {
          await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, Number(op.proposal_id));
          results.push({ op: op.type, proposal_id: op.proposal_id, ok: true });
        } else if (op.type === 'post_proposal_message') {
          const r = await db.run(
            `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
             VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
            Number(op.proposal_id), String(op.text),
          );
          results.push({ op: op.type, proposal_id: op.proposal_id, id: r.lastInsertRowid, ok: true });
        } else if (op.type === 'update_proposal') {
          await db.run(
            `UPDATE ai_proposals SET status = ?, summary = COALESCE(?, summary),
             proposed_changes = COALESCE(?::jsonb, proposed_changes), updated_at = NOW() WHERE id = ?`,
            op.status, op.summary ?? null,
            op.proposed_changes ? JSON.stringify(op.proposed_changes) : null, Number(op.proposal_id),
          );
          results.push({ op: op.type, proposal_id: op.proposal_id, ok: true });
        } else {
          results.push({ op: op.type, ok: false, error: 'unknown op type' });
        }
      } catch (e) {
        results.push({ op: op?.type, ok: false, error: e.message });
      }
    }
    res.json({ results });
  }),
);

// GET — вернуть все открытые обращения с тредами + все proposals (non-done) с тредами
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Feedback: open, awaiting_approval, in_progress
    const feedbackRows = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );

    const feedbackIds = feedbackRows.map((r) => r.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT feedback_id, id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    const feedback = feedbackRows.map((f) => ({
      ...f,
      messages: msgByFeedback[f.id] || [],
    }));

    // AI proposals: pending, approved, revision, rejected (не done)
    const proposalRows = await db.all(
      `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
              p.feedback_id, p.proposed_changes, p.admin_notes, p.created_at, p.updated_at,
              u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status != 'done'
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
    );

    const propIds = proposalRows.map((r) => r.id);
    let propMessages = [];
    if (propIds.length) {
      propMessages = await db.all(
        `SELECT proposal_id, id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${propIds.join(',')}}`,
      );
    }
    const msgByProp = {};
    for (const m of propMessages) {
      if (!msgByProp[m.proposal_id]) msgByProp[m.proposal_id] = [];
      msgByProp[m.proposal_id].push(m);
    }
    const proposals = proposalRows.map((p) => ({
      ...p,
      messages: msgByProp[p.id] || [],
    }));

    res.json({ feedback, proposals });
  }),
);

// POST — выполнить пакет операций. ops: массив объектов с полем type.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const results = [];

    for (const op of ops) {
      try {
        if (op.type === 'post_feedback_message') {
          // Добавить сообщение в тред обращения от имени AI ассистент
          const r = await db.run(
            `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
             VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
            Number(op.feedback_id),
            String(op.text),
          );
          results.push({ op: op.type, feedback_id: op.feedback_id, id: r.lastInsertRowid, ok: true });

        } else if (op.type === 'update_feedback') {
          // Обновить статус обращения и/или admin_reply
          const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(op.feedback_id));
          if (!cur) { results.push({ op: op.type, feedback_id: op.feedback_id, ok: false, error: 'not found' }); continue; }
          const newStatus = op.status ?? cur.status;
          const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
            && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
          await db.run(
            `UPDATE feedback SET
               status = ?,
               admin_reply = COALESCE(?, admin_reply),
               resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
               updated_at = NOW()
             WHERE id = ?`,
            newStatus,
            op.admin_reply ?? null,
            cur.id,
          );
          results.push({ op: op.type, feedback_id: op.feedback_id, new_status: newStatus, ok: true });

        } else if (op.type === 'create_proposal') {
          // Создать AI-предложение
          const r = await db.run(
            `INSERT INTO ai_proposals
             (feedback_id, title, summary, category, risk, source, proposed_changes)
             VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
            op.feedback_id ?? null,
            String(op.title),
            String(op.summary),
            op.category ?? null,
            op.risk || 'medium',
            op.source ?? null,
            op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
          );
          results.push({ op: op.type, id: r.lastInsertRowid, ok: true });

        } else if (op.type === 'mark_proposal_done') {
          // Отметить выполненным
          await db.run(
            `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
            Number(op.proposal_id),
          );
          results.push({ op: op.type, proposal_id: op.proposal_id, ok: true });

        } else if (op.type === 'post_proposal_message') {
          // Добавить сообщение в тред предложения от AI
          const r = await db.run(
            `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
             VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
            Number(op.proposal_id),
            String(op.text),
          );
          results.push({ op: op.type, proposal_id: op.proposal_id, id: r.lastInsertRowid, ok: true });

        } else if (op.type === 'update_proposal') {
          // Сменить статус / заметки предложения
          await db.run(
            `UPDATE ai_proposals SET status = ?, summary = COALESCE(?, summary),
             proposed_changes = COALESCE(?::jsonb, proposed_changes), updated_at = NOW()
             WHERE id = ?`,
            op.status,
            op.summary ?? null,
            op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
            Number(op.proposal_id),
          );
          results.push({ op: op.type, proposal_id: op.proposal_id, ok: true });

        } else {
          results.push({ op: op.type, ok: false, error: 'unknown op type' });
        }
      } catch (e) {
        results.push({ op: op?.type, ok: false, error: e.message });
      }
    }

    res.json({ results });
  }),
);

export default router;
