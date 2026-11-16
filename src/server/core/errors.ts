export type ErrorCode =
  | 'validation_failed'
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'csrf_invalid'
  | 'not_found'
  | 'version_conflict'
  | 'duplicate'
  | 'setup_complete'
  | 'payload_too_large'
  | 'unsupported_file'
  | 'project_archived'
  | 'rate_limited'
  | 'internal_error'
  | 'ai_unavailable'
  | 'semantic_unavailable'
  | 'provider_error'
  | 'provider_timeout'
  | 'provider_auth'
  | 'provider_rate_limited'
  | 'provider_bad_response'
  | 'budget_exceeded'
  | 'restore_in_progress'
  | 'attachment_missing'
  | 'storage_full'
  | 'storage_quota_exceeded'
  | 'db_busy'
  | 'index_unavailable';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  csrf_invalid: 403,
  not_found: 404,
  version_conflict: 409,
  duplicate: 409,
  setup_complete: 409,
  payload_too_large: 413,
  unsupported_file: 422,
  project_archived: 423,
  rate_limited: 429,
  internal_error: 500,
  ai_unavailable: 503,
  semantic_unavailable: 503,
  provider_error: 502,
  provider_timeout: 504,
  provider_auth: 502,
  provider_rate_limited: 429,
  provider_bad_response: 502,
  budget_exceeded: 429,
  restore_in_progress: 503,
  attachment_missing: 404,
  storage_full: 507,
  storage_quota_exceeded: 413,
  db_busy: 503,
  index_unavailable: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown, status?: number) {
    super(message ?? defaultMessage(code));
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
    this.details = details;
  }
}

function defaultMessage(code: ErrorCode): string {
  switch (code) {
    case 'validation_failed':
      return 'Request body is invalid.';
    case 'unauthenticated':
      return 'Sign in to continue.';
    case 'forbidden':
      return 'You do not have permission to do that.';
    case 'csrf_invalid':
      return 'Security token is missing or invalid. Reload the page and try again.';
    case 'not_found':
      return 'Not found.';
    case 'version_conflict':
      return 'This item was modified elsewhere.';
    case 'duplicate':
      return 'This item already exists.';
    case 'setup_complete':
      return 'Setup has already been completed.';
    case 'payload_too_large':
      return 'The request is too large.';
    case 'unsupported_file':
      return 'This file type is not supported.';
    case 'project_archived':
      return 'This project is archived and is read-only.';
    case 'rate_limited':
      return 'Too many requests. Try again shortly.';
    case 'ai_unavailable':
      return 'No AI provider is configured.';
    case 'semantic_unavailable':
      return 'Semantic search requires an embedding model.';
    case 'provider_error':
      return 'The AI provider returned an error.';
    case 'provider_timeout':
      return 'The AI provider timed out.';
    case 'provider_auth':
      return 'The AI provider rejected the credentials.';
    case 'provider_rate_limited':
      return 'The AI provider is rate limiting requests.';
    case 'provider_bad_response':
      return 'The AI provider returned an unusable response.';
    case 'budget_exceeded':
      return 'The daily AI token budget has been exhausted.';
    case 'restore_in_progress':
      return 'A restore is in progress. Try again when it finishes.';
    case 'attachment_missing':
      return 'The file is missing from storage.';
    case 'storage_full':
      return 'Storage is full.';
    case 'storage_quota_exceeded':
      return 'Storage quota exceeded.';
    case 'db_busy':
      return 'The database is busy. Retry in a moment.';
    case 'index_unavailable':
      return 'The search index is unavailable.';
    default:
      return 'Something went wrong.';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function notFound(what = 'Resource'): AppError {
  return new AppError('not_found', `${what} not found.`);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError('bad_request', message, details);
}

export function ensureFound<T>(value: T | undefined | null, what = 'Resource'): T {
  if (value === undefined || value === null) throw notFound(what);
  return value;
}
