# CRM

A standard CRM system covering the essentials of sales — contacts, companies, leads, deals (sales pipeline), activities, and notes — exposed as a JSON REST API.

## Features

- **Authentication** — JWT-based login/register, role-based access (`admin`, `manager`, `sales`).
- **Companies** — accounts you sell to, with industry, size, revenue, owner.
- **Contacts** — people, linked to companies.
- **Leads** — incoming prospects, with source tracking and status (`new` → `contacted` → `qualified` / `unqualified` / `converted`). One-click conversion to contact + deal + company.
- **Deals (sales pipeline)** — opportunities moving through stages: `new` → `qualified` → `proposal` → `negotiation` → `won` / `lost`. Per-deal amount, currency, probability, expected close date. Aggregated pipeline endpoint with weighted value.
- **Activities** — calls, emails, meetings, tasks. Linked to any entity. Upcoming / overdue filters.
- **Notes** — free-form notes attached to any entity.
- **Dashboard** — totals, pipeline value, weighted pipeline, win rate, upcoming/overdue activities.
- **Filtering, search, pagination, sorting** on every list endpoint.
- **SQLite** storage — zero infra, file-based, ships with a default admin user on first run.

## Quick start

```bash
npm install
cp .env.example .env
# (optional) edit .env — change ADMIN_PASSWORD and JWT_SECRET
npm run seed   # optional: populate sample data
npm start
```

The API runs on `http://localhost:3000` and creates `data/crm.sqlite` on first start. A default admin (`admin@example.com` / `admin123`) is seeded if no users exist — change `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` before starting in any non-local environment.

## Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}'
# → { "token": "...", "user": { ... } }

# Use the token for every other call
curl http://localhost:3000/api/contacts \
  -H "Authorization: Bearer $TOKEN"
```

## API overview

All endpoints (except `/health`, `/api`, `/api/auth/login`, `/api/auth/register`) require `Authorization: Bearer <token>`.

| Resource     | Endpoints                                                              |
|--------------|------------------------------------------------------------------------|
| Auth         | `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`   |
| Users        | `GET/POST /api/users`, `GET/PATCH/DELETE /api/users/:id`                |
| Companies    | `GET/POST /api/companies`, `GET/PATCH/DELETE /api/companies/:id`, `GET /api/companies/:id/contacts`, `GET /api/companies/:id/deals` |
| Contacts     | `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`          |
| Leads        | `GET/POST /api/leads`, `GET/PATCH/DELETE /api/leads/:id`, `POST /api/leads/:id/convert` |
| Deals        | `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/:id`, `POST /api/deals/:id/win`, `POST /api/deals/:id/lose`, `GET /api/deals/pipeline` |
| Activities   | `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id`, `POST /api/activities/:id/complete` |
| Notes        | `GET/POST /api/notes`, `GET/PATCH/DELETE /api/notes/:id`                |
| Dashboard    | `GET /api/dashboard/stats`, `GET /api/dashboard/recent`                 |

### List query parameters

Every list endpoint accepts:

- `page` (default `1`), `limit` (default `25`, max `200`) — pagination
- `sort` — column name, prefix with `-` for descending (e.g. `sort=-created_at`)
- `search` — substring match on the most relevant fields
- resource-specific filters (e.g. `?stage=proposal`, `?status=qualified`, `?owner_id=3`, `?company_id=12`)

Response shape:

```json
{
  "data": [ /* items */ ],
  "pagination": { "page": 1, "limit": 25, "total": 137, "total_pages": 6 }
}
```

## Examples

### Create a deal in the pipeline

```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Acme Q3 expansion",
    "amount": 50000,
    "currency": "USD",
    "stage": "qualified",
    "expected_close_date": "2026-09-30",
    "company_id": 1,
    "contact_id": 4
  }'
```

### Move a deal to won/lost

```bash
curl -X POST http://localhost:3000/api/deals/12/win   -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/api/deals/12/lose  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"reason":"Price"}'
```

### View the sales pipeline

```bash
curl http://localhost:3000/api/deals/pipeline -H "Authorization: Bearer $TOKEN"
# {
#   "stages": [
#     {"stage":"new","count":3,"total_amount":15000,"weighted_amount":1500},
#     {"stage":"qualified","count":5,"total_amount":120000,"weighted_amount":30000},
#     ...
#   ],
#   "pipeline_value": 460000,
#   "weighted_pipeline_value": 187500
# }
```

### Convert a lead

```bash
curl -X POST http://localhost:3000/api/leads/7/convert \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"create_deal":true,"deal_stage":"qualified"}'
# Returns the updated lead + newly created contact, deal, company.
```

### Add a note to a deal

```bash
curl -X POST http://localhost:3000/api/notes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"Decision-maker confirmed budget","related_to_type":"deal","related_to_id":12}'
```

### Dashboard

```bash
curl http://localhost:3000/api/dashboard/stats -H "Authorization: Bearer $TOKEN"
# {
#   "totals": { "companies": 24, "contacts": 73, "leads": 18, "deals": 31 },
#   "deals": { "pipeline_value": 460000, "weighted_pipeline_value": 187500, "win_rate": 0.42, ... },
#   "activities": { "upcoming": 5, "overdue": 2 }
# }
```

## Data model

```
users (id, email, password_hash, name, role, active)
companies (id, name, industry, website, phone, email, address, size, annual_revenue, description, owner_id)
contacts (id, first_name, last_name, email, phone, position, company_id, owner_id, notes)
leads (id, first_name, last_name, email, phone, company_name, position, source, status,
       estimated_value, description, owner_id, converted_contact_id, converted_deal_id, converted_at)
deals (id, title, amount, currency, stage, probability, expected_close_date, closed_at, lost_reason,
       contact_id, company_id, owner_id, description)
activities (id, type, subject, description, due_date, completed_at,
            related_to_type, related_to_id, owner_id)
notes (id, content, related_to_type, related_to_id, author_id)
```

## Tests

```bash
npm test
```

Integration tests in `tests/api.test.js` boot the app against a temporary SQLite file and exercise the API end-to-end (auth, CRUD, lead conversion, pipeline, dashboard).

## Configuration (`.env`)

| Variable        | Default                 | Description                              |
|-----------------|-------------------------|------------------------------------------|
| `PORT`          | `3000`                  | HTTP port                                |
| `DATABASE_PATH` | `./data/crm.sqlite`     | SQLite file path                         |
| `JWT_SECRET`    | _(required in prod)_    | JWT signing key                          |
| `JWT_EXPIRES_IN`| `7d`                    | Token TTL                                |
| `ADMIN_EMAIL`   | `admin@example.com`     | Default admin email (first run only)     |
| `ADMIN_PASSWORD`| `admin123`              | Default admin password (first run only)  |
| `ADMIN_NAME`    | `Administrator`         | Default admin display name               |

## Roles

- `admin` — full access, manages users
- `manager` — full data access
- `sales` — full data access (multi-tenant scoping can be added on top via `owner_id`)
