import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, createSessionToken, AUTH_COOKIE_CONFIG } from "@/lib/auth/session";
import { validateUsername, validatePassword } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Rate limit: 15 login attempts per 10 minutes
  const rate = checkRateLimit(req, {
    prefix: "auth_login",
    maxRequests: 15,
    windowMs: 10 * 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userValidation = validateUsername(body.username);
    const passValidation = validatePassword(body.password);

    if (!userValidation.isValid || !passValidation.isValid) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const username = userValidation.value!;
    const password = passValidation.value!;

    const db = getDb();
    const result = await db.execute({
      sql: "SELECT id, username, password_hash, token_version, date_format, mark_watched_on_open_link, mark_watched_on_play, mark_all_watched_scope, feed_filter FROM users WHERE username = ?",
      args: [username],
    });

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const userRow = result.rows[0];
    const passwordHash = userRow.password_hash as string;
    const isValid = await verifyPassword(password, passwordHash);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const userId = userRow.id as string;
    const tokenVersion = Number(userRow.token_version ?? 1);
    const dateFormat = (userRow.date_format as string) || "relative";
    const markWatchedOnOpenLink = Boolean(userRow.mark_watched_on_open_link);
    const markWatchedOnPlay = Boolean(userRow.mark_watched_on_play);
    const markAllWatchedScope = (userRow.mark_all_watched_scope as string) === "all" ? "all" : "loaded";
    const feedFilter = (userRow.feed_filter as string) || "all";

    logger.info("User logged in successfully", { userId, username });

    const sessionToken = await createSessionToken({ id: userId, username, tokenVersion });

    const response = NextResponse.json({
      user: {
        id: userId,
        username,
        dateFormat,
        markWatchedOnOpenLink,
        markWatchedOnPlay,
        markAllWatchedScope,
        feedFilter,
      },
      message: "Logged in successfully",
    });

    response.cookies.set(AUTH_COOKIE_CONFIG.name, sessionToken, AUTH_COOKIE_CONFIG.options);
    return response;
  } catch (err: any) {
    return handleApiError("auth/login", err, "Sign in failed. Please try again.");
  }
}
