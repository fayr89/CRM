// TEMP diag endpoint for AI daily run 2026-07-10-v252. Remove after use.
// v252 note: previous meta query only tracked ai_proposals.updated_at and
// feedback_messages.created_at; it does NOT catch new ai_proposal_messages
// rows (posting a thread message doesn't touch ai_proposals.updated_at).
// Checking pending proposal #62 thread directly before trusting "nothing changed".
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'd4a7c1e9f3b6082a5d1c7e9f3b6082a5';

router.use(async (req, res, next) => {
  const secret = req.query.secret || req.body?.secret;
  if (secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', async (req, res) => {
  const op = req.query.op;
  const p = (key) => (req.query[key] !== undefined ? req.query[key] : req.body?.[key]);
  try {
    if (op === 'get-proposals') {
      const status = p('status');
      const rows = status
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                    f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             WHERE p.status = $1
             ORDER BY p.created_at DESC`,
            status,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                    f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             ORDER BY p.created_at DESC`,
          );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'get-proposal-messages') {
      const id = Number(p('id'));
      if (!id) return res.json({ ok: false, error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'meta') {
      const branches = await db.get(
        `SELECT
           (SELECT COUNT(*) FROM ai_proposals) AS proposals_total,
           (SELECT MAX(updated_at) FROM ai_proposals) AS proposals_last_update,
           (SELECT MAX(created_at) FROM feedback_messages) AS feedback_last_msg,
           (SELECT MAX(created_at) FROM ai_proposal_messages) AS proposal_msg_last,
           (SELECT COUNT(*) FROM feedback WHERE status IN ('open','awaiting_approval')) AS feedback_open_count
        `,
      );
      return res.json({ ok: true, data: branches });
    }

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
