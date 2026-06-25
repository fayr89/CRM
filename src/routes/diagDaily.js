// TEMP — daily AI feedback run diag route. Remove after use.
// Secret: Xk7pZ3mN9vQrT2sW
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'Xk7pZ3mN9vQrT2sW';

function b64(s) {
  try { return s ? Buffer.from(s, 'base64').toString('utf8') : ''; } catch { return s || ''; }
}

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const action = req.query.action || 'read';

  try {
    // --- READ ALL ---
    if (action === 'read') {
      const feedback = await db.all(`
        SELECT f.id, f.subject, f.message, f.status, f.category, f.user_id, f.admin_reply,
               f.created_at, f.updated_at,
               u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.created_at DESC
        LIMIT 50
      `);
      for (const fb of feedback) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      const proposals = await db.all(`
        SELECT p.id, p.title, p.summary, p.category, p.risk, p.status, p.source,
               p.feedback_id, p.admin_notes, p.proposed_changes,
               p.created_at, p.updated_at, u.name AS admin_decision_by_name
        FROM ai_proposals p
        LEFT JOIN users u ON u.id = p.admin_decision_by
        WHERE p.status IN ('approved','revision','rejected','pending')
        ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC
        LIMIT 100
      `);
      for (const p of proposals) {
        p.thread = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      return res.json({ feedback, proposals });
    }

    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    const adminId = adminUser?.id || null;

    // --- POST FEEDBACK MESSAGE ---
    if (action === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = b64(req.query.text);
      const new_status = req.query.new_status || null;
      const admin_reply = req.query.admin_reply ? b64(req.query.admin_reply) : null;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
      if (!fb) return res.status(404).json({ error: 'not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        feedback_id, adminId, text,
      );
      if (new_status || admin_reply !== null) {
        const ups = ['updated_at = NOW()'];
        const ps = [];
        if (new_status) { ups.push('status = ?'); ps.push(new_status); }
        if (admin_reply !== null) { ups.push('admin_reply = ?'); ps.push(admin_reply); }
        ps.push(feedback_id);
        await db.run(`UPDATE feedback SET ${ups.join(', ')} WHERE id = ?`, ...ps);
      }
      return res.json({ ok: true });
    }

    // --- PATCH FEEDBACK STATUS ---
    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply ? b64(req.query.admin_reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const ups = ['updated_at = NOW()'];
      const ps = [];
      if (status) { ups.push('status = ?'); ps.push(status); }
      if (admin_reply !== null) { ups.push('admin_reply = ?'); ps.push(admin_reply); }
      ps.push(id);
      await db.run(`UPDATE feedback SET ${ups.join(', ')} WHERE id = ?`, ...ps);
      return res.json({ ok: true });
    }

    // --- CREATE AI PROPOSAL ---
    if (action === 'create-proposal') {
      const raw = b64(req.query.data);
      if (!raw) return res.status(400).json({ error: 'data required' });
      const data = JSON.parse(raw);
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- PATCH AI PROPOSAL (mark done / revision) ---
    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, adminId, id,
      );
      return res.json({ ok: true });
    }

    // --- POST MESSAGE TO PROPOSAL THREAD ---
    if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = b64(req.query.text);
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        id, adminId, text,
      );
      return res.json({ ok: true });
    }

    // --- PRODUCTS SOLD BUT WITHOUT CURRENT PRICE ---
    if (action === 'products-without-price') {
      // Products that appear in non-cancelled orders but have NO price in product_prices
      // (Общий прайс, any warehouse). Inner NOT EXISTS covers all warehouses.
      const rows = await db.all(`
        SELECT DISTINCT ON (p.id)
          p.sku,
          p.name,
          u.name AS seller,
          o.id AS order_id,
          oi.unit_price AS sale_price,
          oi.quantity AS qty,
          o.warehouse,
          o.created_at AS order_date
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN users u ON u.id = o.manager_id
        WHERE o.status NOT IN ('cancelled')
          AND oi.product_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM product_prices pp
            WHERE pp.product_id = oi.product_id
              AND pp.marketplace = 'Общий прайс'
              AND pp.price IS NOT NULL
              AND pp.price > 0
          )
        ORDER BY p.id, o.id DESC
        LIMIT 200
      `);
      return res.json({ count: rows.length, rows });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
