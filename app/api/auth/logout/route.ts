import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_CONFIG, getCurrentUser, revokeUserSessions } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "auth_logout",
    maxRequests: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (user) {
      await revokeUserSessions(user.id);
      logger.info("User logged out and session revoked", { userId: user.id, username: user.username });
    }
  } catch (err) {
    // Still clear the cookie below so logout always succeeds client-side
    logger.error("Logout revocation failed", err);
  }

  const response = NextResponse.json({ message: "Logged out successfully" });
  response.cookies.set(AUTH_COOKIE_CONFIG.name, "", {
    ...AUTH_COOKIE_CONFIG.options,
    maxAge: 0,
  });
  return response;
}
