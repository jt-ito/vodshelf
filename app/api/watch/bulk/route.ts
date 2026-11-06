import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { sanitizeVodId, sanitizeLogin, sanitizeNumber } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import { getAllChannelVods } from "@/lib/twitch/gql";

export const dynamic = "force-dynamic";

interface BulkWatchItem {
  vodId: string;
  streamerLogin: string;
  totalSeconds?: number;
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "watch_bulk_post",
    maxRequests: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. Please sign in to update watch status." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const isWatched = body.isWatched !== false; // defaults to true
    const cleanStreamerLogin = sanitizeLogin(body.streamerLogin);

    // Support marking ALL VODs for a streamer as watched
    if (body.allStreamerVods && cleanStreamerLogin) {
      // Optional cutoff: only VODs created strictly before this instant
      let cutoffMs: number | null = null;
      if (body.before !== undefined) {
        cutoffMs = typeof body.before === "string" ? Date.parse(body.before) : NaN;
        if (Number.isNaN(cutoffMs)) {
          return NextResponse.json({ error: "Invalid 'before' date" }, { status: 400 });
        }
      }

      const channelVideos = await getAllChannelVods(cleanStreamerLogin);
      const allVideos =
        cutoffMs === null
          ? channelVideos
          : channelVideos.filter((v) => {
              const created = Date.parse(String(v.createdAt || v.publishedAt || ""));
              return !Number.isNaN(created) && created < cutoffMs!;
            });
      if (allVideos.length === 0) {
        return NextResponse.json({
          message: cutoffMs === null ? "No VODs found for channel" : "No VODs found before that date",
          updatedCount: 0,
          allStreamerVods: true,
          isWatched,
        });
      }

      const db = getDb();
      const chunkSize = 150;
      for (let i = 0; i < allVideos.length; i += chunkSize) {
        const chunk = allVideos.slice(i, i + chunkSize);
        const batchStatements = chunk.map((v) => {
          const id = randomUUID();
          const progressSeconds = isWatched ? (v.lengthSeconds || 0) : 0;
          const watchedFlag = isWatched ? 1 : 0;
          return {
            sql: `INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, vod_id) DO UPDATE SET
                    is_watched = excluded.is_watched,
                    progress_seconds = excluded.progress_seconds,
                    total_seconds = COALESCE(excluded.total_seconds, total_seconds),
                    last_watched_at = CURRENT_TIMESTAMP`,
            args: [
              id,
              user.id,
              v.id,
              cleanStreamerLogin,
              watchedFlag,
              progressSeconds,
              v.lengthSeconds || 0,
            ],
          };
        });
        await db.batch(batchStatements, "write");
      }

      logger.info("Bulk watch status updated for all channel VODs", {
        userId: user.id,
        streamer: cleanStreamerLogin,
        count: allVideos.length,
        isWatched,
      });

      return NextResponse.json({
        message: isWatched
          ? `Successfully marked all ${allVideos.length} VODs by ${cleanStreamerLogin} as watched`
          : `Successfully marked all ${allVideos.length} VODs by ${cleanStreamerLogin} as unwatched`,
        updatedCount: allVideos.length,
        allStreamerVods: true,
        isWatched,
      });
    }

    const rawItems: BulkWatchItem[] = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      return NextResponse.json({ error: "No VOD items provided" }, { status: 400 });
    }

    // Limit to max 200 items per request
    const sanitizedItems: Array<{ vodId: string; streamerLogin: string; totalSeconds: number }> = [];
    for (const item of rawItems.slice(0, 200)) {
      const cleanVodId = sanitizeVodId(item.vodId);
      const cleanLogin = sanitizeLogin(item.streamerLogin);
      const totalSec = sanitizeNumber(item.totalSeconds, 0, 864000, 0);

      if (cleanVodId && cleanLogin) {
        sanitizedItems.push({
          vodId: cleanVodId,
          streamerLogin: cleanLogin,
          totalSeconds: totalSec,
        });
      }
    }

    if (sanitizedItems.length === 0) {
      return NextResponse.json({ error: "Valid vodIds and streamerLogins are required" }, { status: 400 });
    }

    const db = getDb();
    const batchStatements = sanitizedItems.map((item) => {
      const id = randomUUID();
      const progressSeconds = isWatched ? item.totalSeconds : 0;
      const watchedFlag = isWatched ? 1 : 0;

      return {
        sql: `INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id, vod_id) DO UPDATE SET
                is_watched = excluded.is_watched,
                progress_seconds = excluded.progress_seconds,
                total_seconds = COALESCE(excluded.total_seconds, total_seconds),
                last_watched_at = CURRENT_TIMESTAMP`,
        args: [
          id,
          user.id,
          item.vodId,
          item.streamerLogin,
          watchedFlag,
          progressSeconds,
          item.totalSeconds,
        ],
      };
    });

    await db.batch(batchStatements, "write");

    logger.info("Bulk watch status updated", {
      userId: user.id,
      count: sanitizedItems.length,
      isWatched,
    });

    return NextResponse.json({
      message: isWatched
        ? `Successfully marked ${sanitizedItems.length} VODs as watched`
        : `Successfully marked ${sanitizedItems.length} VODs as unwatched`,
      updatedCount: sanitizedItems.length,
      isWatched,
    });
  } catch (err: any) {
    return handleApiError("watch/bulk:POST", err, "Failed to bulk update watch status");
  }
}
