import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// Maximum number of tracked IPs to prevent memory exhaustion from IP rotation attacks
const MAX_RATE_LIMIT_ENTRIES = 50_000;

const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup stale records periodically
// unref(): housekeeping must never keep the process alive (blocks graceful shutdown and test runs)
setInterval(() => {
  const now = Date.now();
  rateLimitStore.forEach((record, key) => {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  });
}, 60000).unref?.();

/**
 * Extracts the client IP from request headers.
 *
 * IMPORTANT: This trusts X-Forwarded-For and X-Real-IP headers, which are only reliable
 * when the application runs behind a trusted reverse proxy (e.g., Nginx, Cloudflare, Vercel)
 * that strips/overwrites client-supplied forwarding headers. If running without a trusted
 * proxy, attackers can rotate their apparent IP by setting these headers manually.
 */
export function getClientIp(req: NextRequest): string {
  let rawIp = "127.0.0.1";
  // Set TRUST_PROXY=false when not behind a trusted reverse proxy so spoofed headers are ignored
  if (process.env.TRUST_PROXY === "false") return rawIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    rawIp = forwarded.split(",")[0].trim();
  } else {
    const realIp = req.headers.get("x-real-ip");
    if (realIp) {
      rawIp = realIp.trim();
    }
  }
  // Sanitize IP to valid IPv4 / IPv6 character set and length to prevent memory abuse
  const cleanIp = rawIp.replace(/[^a-fA-F0-9.:%]/g, "").slice(0, 45);
  return cleanIp || "127.0.0.1";
}

export function checkRateLimit(
  req: NextRequest,
  options: {
    prefix: string;
    maxRequests: number;
    windowMs: number;
  }
): { success: boolean; remaining: number; reset: number } {
  const ip = getClientIp(req);
  const key = `${options.prefix}:${ip}`;
  const now = Date.now();

  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    // Evict oldest entry if at capacity to prevent memory exhaustion
    if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitStore.has(key)) {
      const oldestKey = rateLimitStore.keys().next().value;
      if (oldestKey !== undefined) {
        rateLimitStore.delete(oldestKey);
      }
    }
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + options.windowMs,
    });
    return {
      success: true,
      remaining: options.maxRequests - 1,
      reset: Math.ceil(options.windowMs / 1000),
    };
  }

  if (record.count >= options.maxRequests) {
    const secondsRemaining = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
    return {
      success: false,
      remaining: 0,
      reset: secondsRemaining,
    };
  }

  record.count += 1;
  return {
    success: true,
    remaining: options.maxRequests - record.count,
    reset: Math.ceil((record.resetTime - now) / 1000),
  };
}
