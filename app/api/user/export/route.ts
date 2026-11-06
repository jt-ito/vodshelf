import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_export",
    maxRequests: 10,
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

    // Query user profile & preferences
    const userRes = await db.execute({
      sql: "SELECT id, username, created_at, feed_filter, date_format, mark_watched_on_open_link, mark_watched_on_play, mark_all_watched_scope FROM users WHERE id = ?",
      args: [currentUser.id],
    });

    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Query all user scoped data
    const [pinnedRes, watchRes, favRes, bookmarksRes, tagsRes] = await Promise.all([
      db.execute({
        sql: "SELECT streamer_login, streamer_display_name, streamer_avatar_url, group_name, is_hidden, sort_order FROM pinned_streamers WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT vod_id, stream_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at FROM watch_status WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT category_name, box_art_url FROM favorite_categories WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT vod_id, streamer_login, timestamp_seconds, note, created_at FROM bookmarks WHERE user_id = ?",
        args: [currentUser.id],
      }),
      db.execute({
        sql: "SELECT vod_id, tag, created_at FROM vod_tags WHERE user_id = ?",
        args: [currentUser.id],
      }),
    ]);

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: {
        username: userRes.rows[0].username,
        settings: {
          feedFilter: userRes.rows[0].feed_filter,
          dateFormat: userRes.rows[0].date_format,
          markWatchedOnOpenLink: Boolean(userRes.rows[0].mark_watched_on_open_link),
          markWatchedOnPlay: Boolean(userRes.rows[0].mark_watched_on_play),
          markAllWatchedScope: userRes.rows[0].mark_all_watched_scope,
        },
      },
      pinnedStreamers: pinnedRes.rows.map((r) => ({
        streamerLogin: r.streamer_login,
        streamerDisplayName: r.streamer_display_name,
        streamerAvatarUrl: r.streamer_avatar_url,
        groupName: r.group_name || "General",
        isHidden: Boolean(r.is_hidden),
        sortOrder: Number(r.sort_order || 0),
      })),
      watchStatus: watchRes.rows.map((r) => ({
        vodId: r.vod_id,
        streamId: r.stream_id,
        streamerLogin: r.streamer_login,
        isWatched: Boolean(r.is_watched),
        progressSeconds: Number(r.progress_seconds || 0),
        totalSeconds: Number(r.total_seconds || 0),
        lastWatchedAt: r.last_watched_at,
      })),
      favoriteCategories: favRes.rows.map((r) => ({
        categoryName: r.category_name,
        boxArtUrl: r.box_art_url,
      })),
      bookmarks: bookmarksRes.rows.map((r) => ({
        vodId: r.vod_id,
        streamerLogin: r.streamer_login,
        timestampSeconds: Number(r.timestamp_seconds),
        note: r.note,
        createdAt: r.created_at,
      })),
      tags: tagsRes.rows.map((r) => ({
        vodId: r.vod_id,
        tag: r.tag,
        createdAt: r.created_at,
      })),
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="twitch_archive_backup_${currentUser.username}_${Date.now()}.json"`,
      },
    });
  } catch (err: any) {
    return handleApiError("user/export", err, "Failed to export user archive");
  }
}
