export type SegmentErrorCode = "RATE_LIMIT" | "API_ERROR";

export class SegmentApiError extends Error {
  readonly code: SegmentErrorCode;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly limit?: number;

  constructor(opts: {
    message: string;
    code: SegmentErrorCode;
    retryAfterMs?: number;
    status?: number;
    limit?: number;
  }) {
    super(opts.message);
    this.name = "SegmentApiError";
    this.code = opts.code;
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
    this.limit = opts.limit;
  }

  static isRateLimit(err: unknown): err is SegmentApiError {
    return err instanceof SegmentApiError && err.code === "RATE_LIMIT";
  }
}

export function formatRetryAfter(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  if (minutes === 1) return "over ongeveer 1 minuut";
  if (minutes < 60) return `over ongeveer ${minutes} minuten`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "over ongeveer 1 uur" : `over ongeveer ${hours} uur`;
}
