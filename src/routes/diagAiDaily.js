// TEMP-2: ежедневный AI-обход 2026-06-19 t4f2v8b — удалить после использования
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 't4f2v8b';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action } = req.query;

    if (action === 'create-proposal') {
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const title = req.query.title ? decodeURIComponent(req.query.title) : '';
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : '';
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    return res.status(400).json({ error: 'unknown action' });
  }),
);

export default router;
