// ВРЕМЕННЫЙ ДИАГНОСТИЧЕСКИЙ ЭНДПОИНТ — удалить сразу после использования!
// Создан для AI daily-run 2026-06-19. Секрет: r8k2mx9p7885
// Все операции через GET + query params, без auth middleware (секрет в URL).

import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'r8k2mx9p7885';

function checkSecret(req, res) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// action=proposals&status=approved|pending|revision|rejected
// action=feedback-full  — все feedback open/awaiting_approval с треда
// action=proposal-messages&id=N  — тред proposal
// action=feedback-msg&id=N&text=...&user_name=AI+ассистент  — добавить сообщение в feedback
// action=feedback-status&id=N&status=closed|awaiting_approval&reply=...  — сменить статус feedback
// action=proposal-decision&id=N&decision=done  — PATCH ai_proposal
// action=proposal-create&title=...&summary=...&category=...&risk=...&source=...&feedback_id=N&changes=JSON  — создать proposal
// action=proposal-msg&id=N&text=...  — добавить в тред proposal
router.get('/daily-r8k2mx9p7885', async (req, res) => {
  try {
    if (!checkSecret(req, res)) return;
    const action = req.query.action || 'feedback-full';

    // --- Список proposals по статусу ---
    if (action === 'proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC`,
        status,
      );
      return res.json({ data: rows, count: rows.length });
    }

    // --- Тред сообщений proposal ---
    if (action === 'proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // --- Все feedback open/awaiting_approval с тредами ---
    if (action === 'feedback-full') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      const result = [];
      for (const row of rows) {
        const messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          row.id,
        );
        result.push({ ...row, attachments: undefined, messages });
      }
      return res.json({ data: result, count: result.length });
    }

    // --- Добавить сообщение в тред feedback ---
    if (action === 'feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      const user_name = req.query.user_name || 'AI ассистент';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', id);
      if (!fb) return res.status(404).json({ error: 'not found' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const adminId = adminUser?.id || null;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?)`,
        id, adminId, user_name, text,
      );
      return res.json({ ok: true, feedback_id: id });
    }

    // --- Сменить статус feedback ---
    if (action === 'feedback-status') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply || null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const adminId = adminUser?.id || null;
      const justResolved = (status === 'awaiting_approval' || status === 'closed') &&
        cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?,
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        status, reply, justResolved ? adminId : cur.resolved_by, id,
      );
      return res.json({ ok: true, id, new_status: status });
    }

    // --- Отметить proposal выполненным (или другое решение) ---
    if (action === 'proposal-decision') {
      const id = Number(req.query.id);
      const decision = req.query.decision || 'done';
      if (!id) return res.status(400).json({ error: 'id required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const adminId = adminUser?.id || null;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_by = ?,
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, adminId, id,
      );
      return res.json({ ok: true, id, new_status: decision });
    }

    // --- Создать новый proposal ---
    if (action === 'proposal-create') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || `daily-run-2026-06-19`;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changes = req.query.changes ? JSON.parse(req.query.changes) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        changes ? JSON.stringify(changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- Добавить сообщение в тред proposal ---
    if (action === 'proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const adminId = adminUser?.id || null;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        id, adminId, text,
      );
      return res.json({ ok: true, proposal_id: id });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
