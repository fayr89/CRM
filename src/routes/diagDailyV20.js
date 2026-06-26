// TEMPORARY: daily-review diag endpoint v20. Remove after use.
// Защищён секретом в query-параметре; все операции — GET для совместимости с web_fetch_vercel_url.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'nRv7p61dailyV20';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// action=read — все feedback (open/awaiting_approval/in_progress) с тредами + все ai_proposals
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const action = req.query.action || 'read';

  try {
    if (action === 'read') {
      const feedback = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      const fbIds = feedback.map(f => f.id);
      let threads = [];
      if (fbIds.length) {
        threads = await db.all(
          `SELECT fm.feedback_id, fm.id, fm.user_name, fm.role, fm.text, fm.created_at
           FROM feedback_messages fm
           WHERE fm.feedback_id = ANY(?)
           ORDER BY fm.created_at ASC, fm.id ASC`,
          fbIds,
        );
      }
      const threadMap = {};
      for (const m of threads) {
        if (!threadMap[m.feedback_id]) threadMap[m.feedback_id] = [];
        threadMap[m.feedback_id].push(m);
      }
      const feedbackWithThreads = feedback.map(f => ({ ...f, messages: threadMap[f.id] || [] }));

      const proposals = await db.all(
        `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
                p.feedback_id, p.admin_notes, p.proposed_changes,
                p.created_at, p.updated_at, p.admin_decision_at
         FROM ai_proposals p
         ORDER BY p.created_at DESC
         LIMIT 200`,
      );
      const propIds = proposals.map(p => p.id);
      let propMsgs = [];
      if (propIds.length) {
        propMsgs = await db.all(
          `SELECT pm.proposal_id, pm.id, pm.user_name, pm.role, pm.text, pm.created_at
           FROM ai_proposal_messages pm
           WHERE pm.proposal_id = ANY(?)
           ORDER BY pm.created_at ASC, pm.id ASC`,
          propIds,
        );
      }
      const propMsgMap = {};
      for (const m of propMsgs) {
        if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
        propMsgMap[m.proposal_id].push(m);
      }
      const proposalsWithThreads = proposals.map(p => ({ ...p, messages: propMsgMap[p.id] || [] }));
      return res.json({ feedback: feedbackWithThreads, proposals: proposalsWithThreads });
    }

    if (action === 'post-fb-msg') {
      // params: feedback_id, text, [new_status], [admin_reply]
      const fid = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!fid || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        fid, text,
      );
      if (req.query.new_status || req.query.admin_reply) {
        const updates = [];
        const vals = [];
        if (req.query.new_status) { updates.push('status = ?'); vals.push(req.query.new_status); }
        if (req.query.admin_reply) { updates.push('admin_reply = ?'); vals.push(req.query.admin_reply); }
        updates.push('updated_at = NOW()');
        await db.run(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`, ...vals, fid);
      }
      return res.json({ ok: true, feedback_id: fid });
    }

    if (action === 'update-feedback') {
      // params: feedback_id, new_status, [admin_reply]
      const fid = Number(req.query.feedback_id);
      if (!fid) return res.status(400).json({ error: 'feedback_id required' });
      const updates = ['updated_at = NOW()'];
      const vals = [];
      if (req.query.new_status) { updates.push('status = ?'); vals.push(req.query.new_status); }
      if (req.query.admin_reply) { updates.push('admin_reply = ?'); vals.push(req.query.admin_reply); }
      await db.run(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`, ...vals, fid);
      return res.json({ ok: true, feedback_id: fid });
    }

    if (action === 'create-proposal') {
      // params: title, summary, category, risk, [feedback_id], [source], [changes_json]
      const title = req.query.title;
      const summary = req.query.summary;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        req.query.feedback_id ? Number(req.query.feedback_id) : null,
        title,
        summary,
        req.query.category || 'feature',
        req.query.risk || 'medium',
        req.query.source || 'daily-run-2026-06-26',
        req.query.changes_json || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch-proposal') {
      // params: id, decision, [notes]
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, req.query.notes || null, id,
      );
      return res.json({ ok: true, id });
    }

    if (action === 'post-proposal-msg') {
      // params: id, text
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true, id });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    console.error('[diag-v20]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
