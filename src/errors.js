export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const BadRequest = (msg, details) => new ApiError(400, msg, details);
export const Unauthorized = (msg = 'Unauthorized') => new ApiError(401, msg);
export const Forbidden = (msg = 'Forbidden') => new ApiError(403, msg);
export const NotFound = (msg = 'Not found') => new ApiError(404, msg);
export const Conflict = (msg) => new ApiError(409, msg);

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Duplicate value', details: err.message });
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
