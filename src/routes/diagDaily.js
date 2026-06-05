// TEMP: ежедневный AI-обход. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiDr-2026-06-05-v41';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}
function b64(s) { return s ? Buffer.from(s, 'base64').toString('utf8') : null; }

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || 'read';
  try {
    if (action === 'read') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name
         FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
         WHERE p.status IN ('approved','revision','rejected','pending')
         ORDER BY p.created_at DESC`,
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
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.context, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      for (const fb of feedback) {
        fb.messages = await db.all(
          `SELECT id, role, user_name, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ proposals, feedback, ts: new Date().toISOString() });
    }

    if (action === 'post-message') {
      const text = b64(req.query.text_b64);
      const { feedback_id } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'missing params' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(feedback_id), text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch-feedback') {
      const { id, status } = req.query;
      const admin_reply = b64(req.query.reply_b64);
      if (!id) return res.status(400).json({ error: 'missing id' });
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW()
         WHERE id = ?`,
        status ?? null, admin_reply ?? null, Number(id),
      );
      return res.json({ ok: true });
    }

    if (action === 'close-feedback') {
      const { id } = req.query;
      const message = b64(req.query.message_b64);
      if (!id) return res.status(400).json({ error: 'missing id' });
      if (message) {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          Number(id), message,
        );
      }
      await db.run(`UPDATE feedback SET status='closed', updated_at=NOW() WHERE id=?`, Number(id));
      return res.json({ ok: true });
    }

    if (action === 'create-proposal') {
      const title = b64(req.query.title_b64);
      const summary = b64(req.query.summary_b64);
      const { category, risk, source } = req.query;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.pc_b64 ? JSON.parse(b64(req.query.pc_b64)) : null;
      if (!title || !summary) return res.status(400).json({ error: 'missing params' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary,
        category ?? null, risk ?? 'medium',
        source ?? 'daily-run-2026-06-05',
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'mark-proposal-done') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      await db.run(
        `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, Number(id),
      );
      return res.json({ ok: true });
    }

    if (action === 'post-proposal-msg') {
      const { id } = req.query;
      const text = b64(req.query.text_b64);
      if (!id || !text) return res.status(400).json({ error: 'missing params' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        Number(id), text,
      );
      return res.json({ ok: true });
    }

    if (action === 'exec-names-27') {
      const NAMES = [
        ['30365871','АНТИЛОП Ножки для стульчика для кормления'],
        ['90365873','АНТИЛОП Сиденье для стульчика для кормления'],
        ['10365872','АНТИЛОП Столешница для стульчика для кормления'],
        ['80742963','БАГИС Плечики белые'],
        ['40466600','БАГИС плечики детские'],
        ['80376216','ПРУТА зеленая 17шт'],
        ['80351013','ПРУТА желтая 3шт'],
        ['70246471','РЕДА Набор контейнеров 5шт'],
        ['1080010212','РЕДДА СТМ Набор контейнеров 5шт оранжевый'],
        ['1080010211','РЕДДА СТМ Набор контейнеров 5шт бирюзовый'],
        ['20349669','ЭКТИГ для сыпучих'],
        ['90375363','ФНИСС ведро белое'],
        ['10388963','ФНИСС ведро черное'],
        ['00376437','САМЛА контейнер 5л'],
        ['80376438','САМЛА контейнер 11л'],
        ['60376439','САМЛА контейнер 22л'],
        ['40376440','САМЛА контейнер 45л'],
        ['20376219','САМЛА контейнер 55л'],
        ['40376218','САМЛА контейнер 65л'],
        ['20376441','САМЛА контейнер 130л'],
        ['10199203','САМЛА крышка 5л'],
        ['90199204','САМЛА крышка 11/22л'],
        ['30198009','САМЛА крышка 45/65л'],
        ['80376443','САМЛА крышка 55/130л'],
        ['10206312','САМЛА контейнер 11л дымчатый'],
        ['00206317','САМЛА контейнер 22л дымчатый'],
        ['20206316','САМЛА контейнер 45л дымчатый'],
        ['30213161','САМЛА крышка 11/22л дымчатый'],
        ['10213162','САМЛА крышка 45/65л дымчатый'],
        ['10366027','ТРУФАСТ крышка 1 шт'],
        ['10366032','ТРУФАСТ 20х30х10 белый'],
        ['90365967','ТРУФАСТ 20х30х10 черный'],
        ['70366029','ТРУФАСТ 42х30х10 белый'],
        ['60120541','ТРУФАСТ 42х30х10 бирюзовый'],
        ['50366030','ТРУФАСТ 42х30х10 желтый'],
        ['00466287','ТРУФАСТ 42х30х10 зеленый'],
        ['40466290','ТРУФАСТ 42х30х10 розовый'],
        ['70366014','ТРУФАСТ 42х30х10 серый'],
        ['50231296','ТРУФАСТ 42х30х10 черный'],
        ['70366034','ТРУФАСТ 42х30х23 белый'],
        ['00464033','ТРУФАСТ 42х30х23 бирюзовый'],
        ['70868033','ТРУФАСТ 42х30х23 красный'],
        ['90466283','ТРУФАСТ 42х30х23 оранжевый'],
        ['10466277','ТРУФАСТ 42х30х23 розовый'],
        ['70539563','ТРУФАСТ 42х30х23 серый'],
        ['50365479','ТРУФАСТ 42х30х23 черный'],
        ['90386677','МАММУТ стул белый'],
        ['00365368','МАММУТ стул красный'],
        ['40382323','МАММУТ стул розовый'],
        ['20365348','МАММУТ стул синий'],
        ['70382326','МАММУТ табурет желтый'],
        ['70365360','МАММУТ табурет оранжевый'],
        ['40366040','ВЕССЛА Контейнер белый'],
        ['80366038','ВЕССЛА Контейнер зеленый'],
        ['60366039','ВЕССЛА Контейнер розовый'],
        ['00366037','ВЕССЛА Контейнер синий'],
        ['109007131','Комплект «Пруфа» СТМ 4 шт бирюзовый'],
        ['109003081','Комплект «Пруфа» СТМ 3 шт зеленый (1,1л)'],
        ['109003031','Комплект «Пруфа» СТМ 3 шт черный (1,1л)'],
        ['109004081','Комплект «Пруфа» СТМ 3 шт зеленый (1,7л)'],
        ['109004031','Комплект «Пруфа» СТМ 3 шт черный (1,7л)'],
        ['109005081','Комплект «Пруфа» СТМ 5 шт зеленый'],
        ['109005031','Комплект «Пруфа» СТМ 5 шт черный'],
        ['109006031','Комплект «Пруфа» СТМ 6 шт черный'],
      ];
      let matched = 0;
      const notFound = [];
      for (const [eid, name] of NAMES) {
        const r = await db.run(
          `UPDATE products SET name = ?, updated_at = NOW() WHERE external_id = ? OR sku = ?`,
          name, eid, eid,
        );
        if ((r.changes || 0) > 0) matched++;
        else notFound.push(eid);
      }
      return res.json({ ok: true, total: NAMES.length, matched, notFound });
    }

    if (action === 'update-product-names') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const proposal = await db.get(`SELECT proposed_changes FROM ai_proposals WHERE id = ?`, Number(id));
      if (!proposal) return res.status(404).json({ error: 'proposal not found' });
      const raw = proposal.proposed_changes;
      const changes = Array.isArray(raw) ? raw : (raw?.updates ?? null);
      if (!Array.isArray(changes)) return res.status(400).json({ error: 'proposed_changes has no array' });
      let matched = 0;
      const notFound = [];
      for (const item of changes) {
        const { external_id, sku, name } = item || {};
        if (!name) continue;
        const lookup = external_id || sku || null;
        const r = await db.run(
          `UPDATE products SET name = ?, updated_at = NOW() WHERE external_id = ? OR sku = ?`,
          name, lookup, lookup,
        );
        if ((r.changes || 0) > 0) matched++;
        else notFound.push(lookup);
      }
      return res.json({ ok: true, total: changes.length, matched, notFound });
    }

    if (action === 'patch-proposal') {
      const { id, status } = req.query;
      const summary = b64(req.query.summary_b64);
      const title = b64(req.query.title_b64);
      if (!id || !status) return res.status(400).json({ error: 'missing params' });
      await db.run(
        `UPDATE ai_proposals SET
           status = ?,
           summary = COALESCE(?, summary),
           title = COALESCE(?, title),
           updated_at = NOW()
         WHERE id = ?`,
        status, summary ?? null, title ?? null, Number(id),
      );
      return res.json({ ok: true });
    }

    res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
