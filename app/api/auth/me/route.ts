import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "auth_me",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ user: null });
    }

    const db = getDb();
    const userRes = await db.execute({
      sql: "SELECT date_format, mark_watched_on_open_link, mark_watched_on_play, mark_all_watched_scope, feed_filter FROM users WHERE id = ?",
      args: [user.id],
    });

    const userRow = userRes.rows[0];
    const dateFormat = (userRow?.date_format as string) || "relative";
    const markWatchedOnOpenLink = Boolean(userRow?.mark_watched_on_open_link);
    const markWatchedOnPlay = Boolean(userRow?.mark_watched_on_play);
    const markAllWatchedScope = (userRow?.mark_all_watched_scope as string) === "all" ? "all" : "loaded";
    const feedFilter = (userRow?.feed_filter as string) || "all";

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        dateFormat,
        markWatchedOnOpenLink,
        markWatchedOnPlay,
        markAllWatchedScope,
        feedFilter,
      },
    });
  } catch (err: any) {
    return handleApiError("auth/me", err, "Failed to authenticate session");
  }
}
