import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { sanitizeLogin, sanitizeText, sanitizeUrl } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_import",
    maxRequests: 5,
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

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid backup JSON file format" }, { status: 400 });
    }

    const db = getDb();
    const stats = {
      pinnedCount: 0,
      watchCount: 0,
      categoryCount: 0,
      bookmarkCount: 0,
      tagCount: 0,
    };

    // 1. Restore pinned streamers
    if (Array.isArray(payload.pinnedStreamers)) {
      for (const item of payload.pinnedStreamers) {
        if (!item || !item.streamerLogin) continue;
        const cleanLogin = sanitizeLogin(item.streamerLogin);
        if (!cleanLogin) continue;

        const id = `${currentUser.id}_${cleanLogin}`;
        const displayName = sanitizeText(item.streamerDisplayName || cleanLogin, 50);
        // Only http(s) URLs are kept: never store javascript:/data: pseudo-URLs from an untrusted file
        const avatarUrl = sanitizeUrl(item.streamerAvatarUrl) || null;
        const groupName = sanitizeText(item.groupName || "General", 30);
        const isHidden = item.isHidden ? 1 : 0;
        const sortOrder = typeof item.sortOrder === "number" ? item.sortOrder : 0;

        await db.execute({
          sql: `
            INSERT INTO pinned_streamers (id, user_id, streamer_login, streamer_display_name, streamer_avatar_url, group_name, is_hidden, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, streamer_login) DO UPDATE SET
              streamer_display_name = excluded.streamer_display_name,
              streamer_avatar_url = excluded.streamer_avatar_url,
              group_name = excluded.group_name,
              is_hidden = excluded.is_hidden,
              sort_order = excluded.sort_order
          `,
          args: [id, currentUser.id, cleanLogin, displayName, avatarUrl, groupName, isHidden, sortOrder],
        });
        stats.pinnedCount++;
      }
    }

    // 2. Restore watch status
    if (Array.isArray(payload.watchStatus)) {
      for (const item of payload.watchStatus) {
        if (!item || !item.vodId) continue;
        const vodId = String(item.vodId).replace(/[^a-zA-Z0-9_-]/g, "");
        if (!vodId) continue;

        const id = `${currentUser.id}_${vodId}`;
        const streamId = item.streamId ? String(item.streamId).replace(/[^a-zA-Z0-9_-]/g, "") : null;
        const streamerLogin = sanitizeLogin(item.streamerLogin || "");
        // streamer_login is NOT NULL: skip unusable entries instead of failing the whole restore
        if (!streamerLogin) continue;
        const isWatched = item.isWatched ? 1 : 0;
        const progressSeconds = Math.max(0, Number(item.progressSeconds) || 0);
        const totalSeconds = Math.max(0, Number(item.totalSeconds) || 0);
        const lastWatched = item.lastWatchedAt ? String(item.lastWatchedAt) : new Date().toISOString();

        await db.execute({
          sql: `
            INSERT INTO watch_status (id, user_id, vod_id, stream_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, vod_id) DO UPDATE SET
              is_watched = excluded.is_watched,
              progress_seconds = excluded.progress_seconds,
              total_seconds = excluded.total_seconds,
              last_watched_at = excluded.last_watched_at
          `,
          args: [id, currentUser.id, vodId, streamId, streamerLogin, isWatched, progressSeconds, totalSeconds, lastWatched],
        });
        stats.watchCount++;
      }
    }

    // 3. Restore favorite categories
    if (Array.isArray(payload.favoriteCategories)) {
      for (const item of payload.favoriteCategories) {
        if (!item || !item.categoryName) continue;
        const categoryName = sanitizeText(item.categoryName, 100);
        if (!categoryName) continue;

        const id = `${currentUser.id}_${categoryName.toLowerCase()}`;
        const boxArtUrl = sanitizeUrl(item.boxArtUrl) || null;

        await db.execute({
          sql: `
            INSERT INTO favorite_categories (id, user_id, category_name, box_art_url)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, category_name) DO UPDATE SET
              box_art_url = excluded.box_art_url
          `,
          args: [id, currentUser.id, categoryName, boxArtUrl],
        });
        stats.categoryCount++;
      }
    }

    // 4. Restore bookmarks
    if (Array.isArray(payload.bookmarks)) {
      for (const item of payload.bookmarks) {
        if (!item || !item.vodId || item.timestampSeconds === undefined) continue;
        const vodId = String(item.vodId).replace(/[^a-zA-Z0-9_-]/g, "");
        const timestampSeconds = Math.max(0, Math.floor(Number(item.timestampSeconds) || 0));
        const id = `bm_${currentUser.id}_${vodId}_${timestampSeconds}`;
        const streamerLogin = sanitizeLogin(item.streamerLogin || "");
        const note = sanitizeText(item.note || "", 300);
        const createdAt = item.createdAt ? String(item.createdAt) : new Date().toISOString();

        await db.execute({
          sql: `
            INSERT OR REPLACE INTO bookmarks (id, user_id, vod_id, streamer_login, timestamp_seconds, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          args: [id, currentUser.id, vodId, streamerLogin, timestampSeconds, note, createdAt],
        });
        stats.bookmarkCount++;
      }
    }

    // 5. Restore tags
    if (Array.isArray(payload.tags)) {
      for (const item of payload.tags) {
        if (!item || !item.vodId || !item.tag) continue;
        const vodId = String(item.vodId).replace(/[^a-zA-Z0-9_-]/g, "");
        const cleanTag = sanitizeText(item.tag, 50).toLowerCase();
        if (!vodId || !cleanTag) continue;
        const id = `tag_${currentUser.id}_${vodId}_${cleanTag}`;

        await db.execute({
          sql: `
            INSERT OR IGNORE INTO vod_tags (id, user_id, vod_id, tag, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
          args: [id, currentUser.id, vodId, cleanTag, new Date().toISOString()],
        });
        stats.tagCount++;
      }
    }

    // 6. Restore user settings if present
    if (payload.user?.settings) {
      const s = payload.user.settings;
      const updates: string[] = [];
      const args: any[] = [];

      if (s.dateFormat === "relative" || s.dateFormat === "exact") {
        updates.push("date_format = ?");
        args.push(s.dateFormat);
      }
      if (typeof s.markWatchedOnOpenLink === "boolean") {
        updates.push("mark_watched_on_open_link = ?");
        args.push(s.markWatchedOnOpenLink ? 1 : 0);
      }
      if (typeof s.markWatchedOnPlay === "boolean") {
        updates.push("mark_watched_on_play = ?");
        args.push(s.markWatchedOnPlay ? 1 : 0);
      }
      if (s.markAllWatchedScope === "all" || s.markAllWatchedScope === "loaded") {
        updates.push("mark_all_watched_scope = ?");
        args.push(s.markAllWatchedScope);
      }

      if (updates.length > 0) {
        args.push(currentUser.id);
        await db.execute({
          sql: `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
          args,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Data backup successfully restored.",
      stats,
    });
  } catch (err: any) {
    return handleApiError("user/import", err, "Failed to import user archive");
  }
}
