import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { sanitizeVodId, sanitizeLogin, sanitizeNumber } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import { upsertWatchStatus } from "@/lib/watch/upsert";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "watch_progress_get",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ progress: null });
    }

    const { searchParams } = new URL(req.url);
    const rawVodIds = searchParams.get("vodIds");
    if (rawVodIds) {
      const splitIds = rawVodIds
        .split(",")
        .map((id) => sanitizeVodId(id.trim()))
        .filter((id): id is string => Boolean(id));

      if (splitIds.length === 0) {
        return NextResponse.json({ progressMap: {} });
      }

      const { getWatchStatusMapForUser } = await import("@/lib/watch/merge");
      const map = await getWatchStatusMapForUser(user.id, splitIds);
      return NextResponse.json({ progressMap: map });
    }

    const vodId = sanitizeVodId(searchParams.get("vodId"));

    if (!vodId) {
      return NextResponse.json({ error: "Valid vodId or vodIds is required" }, { status: 400 });
    }

    const db = getDb();
    // Row-Level Security: strictly scope by authenticated user.id
    const result = await db.execute({
      sql: `SELECT vod_id, stream_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at 
            FROM watch_status 
            WHERE user_id = ? AND vod_id = ?`,
      args: [user.id, vodId],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ progress: null });
    }

    const row = result.rows[0];
    return NextResponse.json({
      progress: {
        vodId: row.vod_id,
        streamId: row.stream_id,
        streamerLogin: row.streamer_login,
        isWatched: Boolean(row.is_watched),
        progressSeconds: row.progress_seconds,
        totalSeconds: row.total_seconds,
        lastWatchedAt: row.last_watched_at,
      },
    });
  } catch (err: any) {
    return handleApiError("watch/progress:GET", err, "Failed to retrieve watch progress");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "watch_progress_post",
    maxRequests: 120,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const vodId = sanitizeVodId(body.vodId);
    let streamerLogin = sanitizeLogin(body.streamerLogin);

    const db = getDb();

    // If streamerLogin was not provided, attempt defensive resolution from existing user records
    if (vodId && !streamerLogin) {
      const existing = await db.execute({
        sql: "SELECT streamer_login FROM watch_status WHERE user_id = ? AND vod_id = ? LIMIT 1",
        args: [user.id, vodId],
      });
      if (existing.rows.length > 0 && existing.rows[0].streamer_login) {
        streamerLogin = sanitizeLogin(String(existing.rows[0].streamer_login));
      }
    }

    if (!vodId || !streamerLogin) {
      return NextResponse.json(
        { error: "Valid vodId and streamerLogin are required" },
        { status: 400 }
      );
    }

    const progressSeconds = sanitizeNumber(body.progressSeconds, 0, 864000, 0);
    const totalSeconds = sanitizeNumber(body.totalSeconds, 0, 864000, 0);

    let finalIsWatched: number;
    if (body.isWatched !== undefined) {
      finalIsWatched = body.isWatched ? 1 : 0;
    } else if (totalSeconds > 0 && progressSeconds > 0) {
      finalIsWatched = progressSeconds / totalSeconds >= 0.95 ? 1 : 0;
    } else {
      finalIsWatched = 0;
    }

    // Row-Level Security: always bind authenticated user.id. Explicit toggles overwrite;
    // implicit heartbeats may only raise is_watched, never un-watch.
    const saved = await upsertWatchStatus(db, {
      userId: user.id,
      vodId,
      streamId: body.streamId ? String(body.streamId).slice(0, 50) : null,
      streamerLogin,
      isWatched: finalIsWatched as 0 | 1,
      progressSeconds,
      totalSeconds,
      explicit: body.isWatched !== undefined,
    });

    logger.info("Watch progress updated", { userId: user.id, vodId, isWatched: saved.isWatched });

    return NextResponse.json({
      message: "Watch progress saved",
      vodId,
      progressSeconds: saved.progressSeconds,
      isWatched: saved.isWatched,
    });
  } catch (err: any) {
    return handleApiError("watch/progress:POST", err, "Failed to save watch progress");
  }
}
