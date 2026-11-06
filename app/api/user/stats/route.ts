import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_stats",
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

    // 1. Overall stats
    const totalRes = await db.execute({
      sql: `
        SELECT
          COUNT(*) as total_entries,
          SUM(is_watched) as completed_count,
          SUM(progress_seconds) as total_seconds,
          SUM(CASE WHEN progress_seconds > 60 AND is_watched = 0 THEN 1 ELSE 0 END) as in_progress_count
        FROM watch_status
        WHERE user_id = ?
      `,
      args: [currentUser.id],
    });

    const totalRow = totalRes.rows[0];
    const totalSeconds = Number(totalRow?.total_seconds || 0);
    const completedCount = Number(totalRow?.completed_count || 0);
    const inProgressCount = Number(totalRow?.in_progress_count || 0);
    const totalEntries = Number(totalRow?.total_entries || 0);

    // 2. Streamer breakdown
    const streamerRes = await db.execute({
      sql: `
        SELECT
          w.streamer_login,
          p.streamer_display_name,
          p.streamer_avatar_url,
          SUM(w.progress_seconds) as seconds_watched,
          COUNT(w.vod_id) as total_vods,
          SUM(w.is_watched) as completed_vods
        FROM watch_status w
        LEFT JOIN pinned_streamers p ON p.user_id = w.user_id AND p.streamer_login = w.streamer_login
        WHERE w.user_id = ? AND w.streamer_login IS NOT NULL AND w.streamer_login != ''
        GROUP BY w.streamer_login
        ORDER BY seconds_watched DESC
        LIMIT 15
      `,
      args: [currentUser.id],
    });

    const streamers = streamerRes.rows.map((r) => ({
      streamerLogin: r.streamer_login as string,
      displayName: (r.streamer_display_name as string) || (r.streamer_login as string),
      avatarUrl: (r.streamer_avatar_url as string) || null,
      secondsWatched: Number(r.seconds_watched || 0),
      totalVods: Number(r.total_vods || 0),
      completedVods: Number(r.completed_vods || 0),
    }));

    // 3. Pinned creators & categories count
    const [pinnedCountRes, favCountRes, bookmarkCountRes] = await Promise.all([
      db.execute({
        sql: "SELECT COUNT(*) as c FROM pinned_streamers WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT COUNT(*) as c FROM favorite_categories WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ?",
        args: [currentUser.id],
      }),
    ]);

    return NextResponse.json({
      totalSeconds,
      totalHours: (totalSeconds / 3600).toFixed(1),
      completedCount,
      inProgressCount,
      totalEntries,
      pinnedCount: Number(pinnedCountRes.rows[0]?.c || 0),
      favoriteCategoriesCount: Number(favCountRes.rows[0]?.c || 0),
      bookmarksCount: Number(bookmarkCountRes.rows[0]?.c || 0),
      streamers,
    });
  } catch (err: any) {
    return handleApiError("user/stats", err, "Failed to load watch statistics");
  }
}
