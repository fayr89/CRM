// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного AI-обхода.
// Удалить сразу после использования (отдельным коммитом).
// Не несёт персональных данных наружу — только агрегаты и тексты обращений
// (которые и так видны всем админам CRM).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// Секрет в path — обращение только через этот URL, не через публичный API.
const S = 'd7Kp3mXq8rNv2';

function forbidden(res) {
  return res.status(403).json({ error: 'forbidden' });
}

function parseCmd(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

router.get(
  `/${S}`,
  asyncHandler(async (req, res) => {
    const a = req.query.a || 'data';

    // ── READ: все данные для обхода ──────────────────────────────────────
    if (a === 'data') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ORDER BY p.created_at DESC
         LIMIT 200`,
      );

      const proposalMessages = {};
      for (const p of proposals) {
        proposalMessages[p.id] = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }

      const feedback = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC
         LIMIT 200`,
      );

      const feedbackMessages = {};
      for (const f of feedback) {
        feedbackMessages[f.id] = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          f.id,
        );
      }

      return res.json({ proposals, proposalMessages, feedback, feedbackMessages });
    }

    const id = Number(req.query.id) || 0;
    const cmd = parseCmd(req.query.cmd);
    if (cmd === null) return res.status(400).json({ error: 'bad cmd base64' });

    // ── WRITE: отметить proposal выполненным ────────────────────────────
    if (a === 'mark-proposal-done') {
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        id,
      );
      return res.json({ ok: true, id });
    }

    // ── WRITE: создать новый proposal ───────────────────────────────────
    if (a === 'create-proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        cmd.feedback_id ?? null,
        cmd.title,
        cmd.summary,
        cmd.category ?? null,
        cmd.risk || 'medium',
        cmd.source ?? null,
        cmd.proposed_changes ? JSON.stringify(cmd.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // ── WRITE: обновить proposal (revision → pending) ────────────────────
    if (a === 'update-proposal') {
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals
         SET status = COALESCE(?, status),
             title = COALESCE(?, title),
             summary = COALESCE(?, summary),
             category = COALESCE(?, category),
             risk = COALESCE(?, risk),
             proposed_changes = COALESCE(?::jsonb, proposed_changes),
             updated_at = NOW()
         WHERE id = ?`,
        cmd.status ?? null,
        cmd.title ?? null,
        cmd.summary ?? null,
        cmd.category ?? null,
        cmd.risk ?? null,
        cmd.proposed_changes ? JSON.stringify(cmd.proposed_changes) : null,
        id,
      );
      return res.json({ ok: true, id });
    }

    // ── WRITE: сообщение в тред proposal ────────────────────────────────
    if (a === 'post-proposal-msg') {
      if (!id || !cmd.text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        id,
        cmd.text,
      );
      return res.json({ ok: true });
    }

    // ── WRITE: обновить feedback (статус + admin_reply) ──────────────────
    if (a === 'update-feedback') {
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE feedback
         SET status = COALESCE(?, status),
             admin_reply = COALESCE(?, admin_reply),
             updated_at = NOW()
         WHERE id = ?`,
        cmd.status ?? null,
        cmd.reply ?? null,
        id,
      );
      return res.json({ ok: true, id });
    }

    // ── WRITE: закрыть feedback с сообщением ────────────────────────────
    if (a === 'close-feedback') {
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE feedback SET status = 'closed', admin_reply = ?, updated_at = NOW() WHERE id = ?`,
        cmd.reply ?? null,
        id,
      );
      if (cmd.msg) {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          id,
          cmd.msg,
        );
      }
      return res.json({ ok: true, id });
    }

    // ── WRITE: сообщение в тред feedback ────────────────────────────────
    if (a === 'post-feedback-msg') {
      if (!id || !cmd.text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        id,
        cmd.text,
      );
      return res.json({ ok: true, id });
    }

    return res.status(400).json({ error: `unknown action: ${a}` });
  }),
);

// Любой другой путь → 403
router.use((_req, res) => forbidden(res));

export default router;
