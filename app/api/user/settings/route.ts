import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

const USERNAME_COOLDOWN_DAYS = 15;
const COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_settings",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();

    // Query user profile
    const userRes = await db.execute({
      sql: "SELECT id, username, created_at, username_changed_at, date_format, mark_watched_on_open_link, mark_watched_on_play, mark_all_watched_scope FROM users WHERE id = ?",
      args: [currentUser.id],
    });

    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userRow = userRes.rows[0];
    const usernameChangedAt = userRow.username_changed_at as string | null;
    const dateFormat = (userRow.date_format as string) || "relative";
    const markWatchedOnOpenLink = Boolean(userRow.mark_watched_on_open_link);
    const markWatchedOnPlay = Boolean(userRow.mark_watched_on_play);
    const markAllWatchedScope = (userRow.mark_all_watched_scope as string) === "all" ? "all" : "loaded";

    let canChangeUsername = true;
    let daysRemaining = 0;
    let nextAvailableDate: string | null = null;

    if (usernameChangedAt) {
      const lastChangedTime = new Date(usernameChangedAt).getTime();
      const elapsed = Date.now() - lastChangedTime;

      if (elapsed < COOLDOWN_MS) {
        canChangeUsername = false;
        const remainingMs = COOLDOWN_MS - elapsed;
        daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
        nextAvailableDate = new Date(lastChangedTime + COOLDOWN_MS).toISOString();
      }
    }

    // Query account stats
    const [pinnedRes, watchedRes] = await Promise.all([
      db.execute({
        sql: "SELECT COUNT(*) as count FROM pinned_streamers WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT COUNT(*) as count FROM watch_status WHERE user_id = ? AND is_watched = 1",
        args: [currentUser.id],
      }),
    ]);

    const pinnedCount = Number(pinnedRes.rows[0]?.count || 0);
    const watchedCount = Number(watchedRes.rows[0]?.count || 0);

    return NextResponse.json({
      user: {
        id: userRow.id,
        username: userRow.username,
        createdAt: userRow.created_at,
        usernameChangedAt,
        canChangeUsername,
        daysRemaining,
        nextAvailableDate,
        cooldownDays: USERNAME_COOLDOWN_DAYS,
        dateFormat,
        markWatchedOnOpenLink,
        markWatchedOnPlay,
        markAllWatchedScope,
        stats: {
          pinnedCount,
          watchedCount,
        },
      },
    });
  } catch (err: any) {
    return handleApiError("user/settings", err, "Failed to load user settings");
  }
}

export async function PATCH(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_settings_update",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: string[] = [];
    const args: any[] = [];

    if (body.dateFormat !== undefined) {
      if (body.dateFormat !== "relative" && body.dateFormat !== "exact") {
        return NextResponse.json(
          { error: "Invalid date format. Supported values: 'relative', 'exact'" },
          { status: 400 }
        );
      }
      updates.push("date_format = ?");
      args.push(body.dateFormat);
    }

    if (body.markWatchedOnOpenLink !== undefined) {
      updates.push("mark_watched_on_open_link = ?");
      args.push(body.markWatchedOnOpenLink ? 1 : 0);
    }

    if (body.markWatchedOnPlay !== undefined) {
      updates.push("mark_watched_on_play = ?");
      args.push(body.markWatchedOnPlay ? 1 : 0);
    }

    if (body.markAllWatchedScope !== undefined) {
      if (body.markAllWatchedScope !== "loaded" && body.markAllWatchedScope !== "all") {
        return NextResponse.json(
          { error: "Invalid scope. Supported values: 'loaded', 'all'" },
          { status: 400 }
        );
      }
      updates.push("mark_all_watched_scope = ?");
      args.push(body.markAllWatchedScope);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No valid settings provided to update" }, { status: 400 });
    }

    const db = getDb();
    args.push(currentUser.id);
    await db.execute({
      sql: `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });

    return NextResponse.json({
      success: true,
      updated: body,
    });
  } catch (err: any) {
    return handleApiError("user/settings/patch", err, "Failed to update user settings");
  }
}

