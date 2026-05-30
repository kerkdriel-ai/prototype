const WINDOW_MS = 60 * 60 * 1000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

export function getScriptRateLimit(): number {
  return Number(process.env.SEGMENT_RATE_LIMIT_SCRIPT ?? "50");
}

export function getSegmentRateLimit(quality: "standard" | "premium"): number {
  if (quality === "premium") {
    return Number(process.env.SEGMENT_RATE_LIMIT_PREMIUM ?? "80");
  }
  return Number(process.env.SEGMENT_RATE_LIMIT_STANDARD ?? "100");
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    const resetAt = now + WINDOW_MS;
    return {
      allowed: true,
      remaining: limit - 1,
      limit,
      resetAt,
      retryAfterMs: 0,
    };
  }

  const resetAt = entry.windowStart + WINDOW_MS;
  const retryAfterMs = Math.max(0, resetAt - now);

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfterMs,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: limit - entry.count,
    limit,
    resetAt,
    retryAfterMs: 0,
  };
}

export function rateLimitKeyFromRequest(
  request: Request,
  scope: "standard" | "premium" | "video" | "script"
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local-dev";
  return `segment:${scope}:${ip}`;
}
