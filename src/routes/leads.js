import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'first_name', 'status', 'estimated_value', 'created_at', 'updated_at'];

const SOURCES = ['website', 'referral', 'cold_call', 'social', 'event', 'advertisement', 'other'];
const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];

const baseSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  source: z.enum(SOURCES).optional().nullable(),
  status: z.enum(STATUSES).optional(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  description: z.string().optional().nullable(),
  owner_id: z.number().int().positive().optional().nullable(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'created_at', 'DESC');
    const db = getDb();

    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR company_name LIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s, s, s);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.source) {
      where.push('source = ?');
      params.push(req.query.source);
    }
    if (req.query.owner_id) {
      where.push('owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT * FROM leads ${whereSql} ORDER BY ${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM leads ${whereSql}`)
      .get(...params);
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw NotFound('Lead not found');
    res.json(lead);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO leads
         (first_name, last_name, email, phone, company_name, position, source, status,
          estimated_value, description, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.first_name,
        data.last_name ?? null,
        data.email || null,
        data.phone ?? null,
        data.company_name ?? null,
        data.position ?? null,
        data.source ?? null,
        data.status ?? 'new',
        data.estimated_value ?? null,
        data.description ?? null,
        data.owner_id ?? req.user.id,
      );
    res
      .status(201)
      .json(db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Lead not found');

    const updates = [];
    const params = [];
    for (const key of [
      'first_name',
      'last_name',
      'email',
      'phone',
      'company_name',
      'position',
      'source',
      'status',
      'estimated_value',
      'description',
      'owner_id',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    if (result.changes === 0) throw NotFound('Lead not found');
    res.status(204).send();
  }),
);

// Convert a lead to a contact (+ optional deal and company).
const convertSchema = z.object({
  create_deal: z.boolean().optional().default(true),
  deal_title: z.string().optional(),
  deal_amount: z.number().nonnegative().optional(),
  deal_stage: z.enum(['new', 'qualified', 'proposal', 'negotiation']).optional().default('qualified'),
  create_company: z.boolean().optional().default(true),
});

router.post(
  '/:id/convert',
  asyncHandler(async (req, res) => {
    const opts = convertSchema.parse(req.body || {});
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw NotFound('Lead not found');
    if (lead.status === 'converted') throw BadRequest('Lead already converted');

    const tx = db.transaction(() => {
      let companyId = null;
      if (opts.create_company && lead.company_name) {
        const companyResult = db
          .prepare(`INSERT INTO companies (name, owner_id) VALUES (?, ?)`)
          .run(lead.company_name, lead.owner_id ?? req.user.id);
        companyId = companyResult.lastInsertRowid;
      }
      const contactResult = db
        .prepare(
          `INSERT INTO contacts (first_name, last_name, email, phone, position, company_id, owner_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          lead.first_name,
          lead.last_name,
          lead.email,
          lead.phone,
          lead.position,
          companyId,
          lead.owner_id ?? req.user.id,
        );
      const contactId = contactResult.lastInsertRowid;

      let dealId = null;
      if (opts.create_deal) {
        const title =
          opts.deal_title ||
          `${lead.first_name}${lead.last_name ? ' ' + lead.last_name : ''} - ${
            lead.company_name || 'New Deal'
          }`;
        const dealResult = db
          .prepare(
            `INSERT INTO deals (title, amount, stage, contact_id, company_id, owner_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            title,
            opts.deal_amount ?? lead.estimated_value ?? 0,
            opts.deal_stage,
            contactId,
            companyId,
            lead.owner_id ?? req.user.id,
          );
        dealId = dealResult.lastInsertRowid;
      }

      db.prepare(
        `UPDATE leads SET status = 'converted', converted_contact_id = ?, converted_deal_id = ?,
         converted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(contactId, dealId, lead.id);

      return { contactId, dealId, companyId };
    });

    const result = tx();
    res.json({
      lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id),
      contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.contactId),
      deal: result.dealId ? db.prepare('SELECT * FROM deals WHERE id = ?').get(result.dealId) : null,
      company: result.companyId
        ? db.prepare('SELECT * FROM companies WHERE id = ?').get(result.companyId)
        : null,
    });
  }),
);

export default router;
