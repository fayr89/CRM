// Helpers for parsing pagination, sorting, and filtering from query strings.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function parseSort(query, allowed, defaultColumn = 'created_at', defaultDir = 'DESC') {
  let column = defaultColumn;
  let dir = defaultDir;
  if (query.sort) {
    const raw = String(query.sort);
    const desc = raw.startsWith('-');
    const name = desc ? raw.slice(1) : raw;
    if (allowed.includes(name)) {
      column = name;
      dir = desc ? 'DESC' : 'ASC';
    }
  }
  return { column, dir };
}

export function buildWhere(filters) {
  const clauses = [];
  const params = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const [op, val] = value;
      clauses.push(`${key} ${op} ?`);
      params.push(val);
    } else {
      clauses.push(`${key} = ?`);
      params.push(value);
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function paginated(items, total, page, limit) {
  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 1,
    },
  };
}
