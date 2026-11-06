import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getChannelVods, getSubOnlyVodMeta, getLiveStreams } from "@/lib/twitch/gql";
import { getChannelUnlistedStreams } from "@/lib/twitch/unlisted";
import { extractStreamId } from "@/lib/twitch/tracker";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getWatchStatusMapForUser } from "@/lib/watch/merge";
import { getSnapshot, peekSnapshot } from "@/lib/twitch/vod-snapshots";
import { getOutages, getUpstreamState } from "@/lib/twitch/upstream-health";

import { isSameBroadcast } from "@/lib/twitch/broadcast";
import { getTwitchTrackerStreams, matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";

export const dynamic = "force-dynamic";

/**
 * Builds the public + unlisted VOD list for one streamer from the upstream sources (the slow part).
 * The public VOD fetch is required: if it fails the error propagates so a good saved snapshot is
 * never overwritten. Unlisted and TwitchTracker data are optional and degrade to empty lists.
 */
async function buildStreamerVods(
  login: string,
  displayName: string,
  avatarUrl: string,
  previous: any[] | null
): Promise<any[]> {
  // When an optional source is down, keep what the previous snapshot already knew instead of losing it
  let unlistedOutage = false;
  const [vodData, unlistedStreams, ttStreams] = await Promise.all([
    getChannelVods(login, { first: 30, broadcastType: "ARCHIVE" }),
    getChannelUnlistedStreams(login, {
      streamerDisplayName: displayName,
      streamerAvatarUrl: avatarUrl,
    }).catch(() => {
      unlistedOutage = true;
      return [];
    }),
    getTwitchTrackerStreams(login).catch(() => []),
  ]);
  const previousById = new Map<string, any>((previous || []).map((v) => [String(v.id), v]));
  const trackerOutage = ttStreams.length === 0 && getUpstreamState("twitchtracker") !== "ok";

  const publicVideos = vodData.videos || [];
  const seenStreamIds = new Set<string>();

  // Extract stream ID from public VODs, resolving seekPreviewsURL for processing VODs
  await Promise.all(
    publicVideos.map(async (pv) => {
      if (trackerOutage) {
        // TwitchTracker is down: carry over the stream links it gave us last time
        const old = previousById.get(String(pv.id));
        if (old) {
          for (const k of ["streamId", "twitchTrackerStreamId", "trackerUrl"]) {
            if (old[k] && !(pv as any)[k]) (pv as any)[k] = old[k];
          }
          if (old.streamId) seenStreamIds.add(String(old.streamId));
        }
      }
      let sid = extractStreamId(pv);
      if (!sid && pv.id) {
        try {
          const meta = await getSubOnlyVodMeta(pv.id);
          if (meta?.seekPreviewsURL) {
            pv.seekPreviewsURL = meta.seekPreviewsURL;
            sid = extractStreamId(pv);
          }
        } catch {}
      }

      const ttMatch = matchTwitchTrackerStream(ttStreams, pv);
      const finalSid = ttMatch?.streamId || sid;

      if (finalSid) {
        (pv as any).streamId = finalSid;
        seenStreamIds.add(finalSid);
      }
      if (sid) {
        seenStreamIds.add(sid);
      }
      if (ttMatch?.streamId) {
        (pv as any).twitchTrackerStreamId = ttMatch.streamId;
        (pv as any).trackerUrl = `https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(
          ttMatch.streamId
        )}`;
      }
    })
  );

  // Filter unlisted streams to exclude any that are already available in public VODs
  const unlistedSource: any[] = unlistedOutage ? (previous || []).filter((v) => v.isUnlisted) : unlistedStreams;
  const uniqueUnlisted = unlistedSource.filter((uv) => {
    // 1. Direct stream ID match
    if (uv.streamId && seenStreamIds.has(uv.streamId)) {
      return false;
    }
    // 2. Broadcast session match (same channel + close start time + title match)
    for (const pv of publicVideos) {
      if (isSameBroadcast(pv, uv)) {
        return false;
      }
    }
    return true;
  });

  // Match unlisted streams with TwitchTracker if available
  uniqueUnlisted.forEach((uv) => {
    const ttMatch = matchTwitchTrackerStream(ttStreams, uv);
    if (ttMatch?.streamId) {
      (uv as any).streamId = ttMatch.streamId;
      (uv as any).twitchTrackerStreamId = ttMatch.streamId;
      (uv as any).trackerUrl = `https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(
        ttMatch.streamId
      )}`;
    }
  });

  return [...publicVideos, ...uniqueUnlisted];
}

// Saved VOD lists younger than this are served without any upstream call; older ones are served
// instantly and refreshed in the background. Beyond MAX_STALE the request waits for a rebuild.
const SNAPSHOT_OPTIONS = { freshMs: 2 * 60 * 1000, maxStaleMs: 14 * 24 * 60 * 60 * 1000 };

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_feed",
    maxRequests: 120,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({
        videos: [],
        message: "Sign in and pin streamers to view your personalized VOD feed.",
        feedFilter: "all",
      });
    }

    const db = getDb();

    // Retrieve user's saved feed filter preference from database upfront
    let feedFilter = "all";
    try {
      const userFilterRes = await db.execute({
        sql: "SELECT feed_filter FROM users WHERE id = ?",
        args: [user.id],
      });
      if (userFilterRes.rows[0]?.feed_filter) {
        feedFilter = String(userFilterRes.rows[0].feed_filter);
      }
    } catch {
      // Fallback to default
    }

    // Row-Level Security: strictly enforce authenticated user.id and filter out hidden creators
    const pinnedResult = await db.execute({
      sql: "SELECT streamer_login, streamer_display_name, streamer_avatar_url FROM pinned_streamers WHERE user_id = ? AND (is_hidden = 0 OR is_hidden IS NULL)",
      args: [user.id],
    });

    if (pinnedResult.rows.length === 0) {
      return NextResponse.json({
        videos: [],
        message: "No pinned streamers yet. Search creators and pin them to populate your feed!",
        feedFilter,
      });
    }

    // Each streamer's VOD list comes from the SQLite snapshot (instant); refreshes run in the background
    const snapshotPromises = pinnedResult.rows.map(async (row) => {
      const login = row.streamer_login as string;
      const displayName = (row.streamer_display_name as string) || login;
      const avatarUrl = row.streamer_avatar_url as string;
      const key = `streamer:${login.toLowerCase()}`;
      try {
        const result = await getSnapshot<any[]>(
          db,
          key,
          (previous) => buildStreamerVods(login, displayName, avatarUrl, previous),
          SNAPSHOT_OPTIONS
        );
        return { ...result, key };
      } catch {
        // No saved copy and upstream failed: this creator contributes nothing this time
        return { data: [] as any[], stale: false, refreshing: null, fetchedAt: Date.now(), key };
      }
    });

    const logins = pinnedResult.rows.map((row) => String(row.streamer_login).toLowerCase());

    const [liveMap, initialResults] = await Promise.all([
      withTimeout(getLiveStreams(logins).catch(() => ({})), 2000, {}),
      Promise.all(snapshotPromises),
    ]);

    // Saved lists that were out of date are being refreshed in the background. Give those refreshes a short
    // moment to finish so this very first answer is already current, instead of "old data now, new data
    // a few seconds later" (which would only show up as a held update after the page is in use).
    const snapshotResults = [...initialResults];
    const running = initialResults.flatMap((r) => (r.refreshing ? [r.refreshing] : []));
    if (running.length > 0) {
      const softWaitMs = Number(process.env.FEED_SOFT_WAIT_MS ?? 4000);
      await withTimeout(Promise.all(running).then(() => true), softWaitMs, false);
      for (let i = 0; i < snapshotResults.length; i++) {
        const r = snapshotResults[i];
        if (!r.refreshing) continue;
        const latest = await peekSnapshot<any[]>(db, r.key).catch(() => null);
        if (latest && latest.fetchedAt > r.fetchedAt) {
          snapshotResults[i] = {
            ...r,
            data: latest.data,
            fetchedAt: latest.fetchedAt,
            stale: Date.now() - latest.fetchedAt > SNAPSHOT_OPTIONS.freshMs,
          };
        }
      }
    }
    const nestedVideos = snapshotResults.map((r) => r.data);
    const anyStale = snapshotResults.some((r) => r.stale);
    // Oldest saved data shown: lets the UI say "showing data from 12 min ago" when upstream is failing
    const oldestSnapshotAt = snapshotResults.reduce((min, r) => Math.min(min, r.fetchedAt), Date.now());

    const rawAllVideos = nestedVideos.flat();
    const seenVodIds = new Set<string>();
    const allVideos = rawAllVideos.filter((v) => {
      if (!v.id) return false;
      const idStr = String(v.id);
      if (seenVodIds.has(idStr)) return false;
      seenVodIds.add(idStr);
      return true;
    });

    // Sort chronologically (newest first) to ensure live channel latest video resolution is accurate
    allVideos.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.publishedAt || 0).getTime();
      const dateB = new Date(b.createdAt || b.publishedAt || 0).getTime();
      return dateB - dateA;
    });

    // Determine the most recent broadcast for each currently live channel
    const liveChannelLatestVideoId = new Map<string, string>();
    for (const v of allVideos) {
      const loginLower = (v.owner?.login || "").toLowerCase();
      if ((liveMap as any)[loginLower]?.isLive && !liveChannelLatestVideoId.has(loginLower)) {
        const timeDiff = new Date().getTime() - new Date(v.createdAt || v.publishedAt || 0).getTime();
        // If broadcast began within the last 24 hours, it corresponds to the ongoing live broadcast
        if (timeDiff < 24 * 3600 * 1000) {
          liveChannelLatestVideoId.set(loginLower, String(v.id));
        }
      }
    }

    // Retrieve user's favorited categories
    const favCatResult = await db.execute({
      sql: "SELECT category_name FROM favorite_categories WHERE user_id = ?",
      args: [user.id],
    });
    const favoriteCategories = favCatResult.rows.map((r) => String(r.category_name));
    const favCategoryLower = new Set(favoriteCategories.map((c) => c.toLowerCase()));

    // Sort: Favorited categories appear towards the top, followed by chronological (newest first)
    allVideos.sort((a, b) => {
      const aFav = favCategoryLower.has((a.game?.name || "").toLowerCase()) ? 1 : 0;
      const bFav = favCategoryLower.has((b.game?.name || "").toLowerCase()) ? 1 : 0;
      if (aFav !== bFav) {
        return bFav - aFav; // Favorited category VODs first
      }
      const dateA = new Date(a.createdAt || a.publishedAt || 0).getTime();
      const dateB = new Date(b.createdAt || b.publishedAt || 0).getTime();
      return dateB - dateA;
    });

    // Merge watch status scoped strictly to this user
    const vodIds = allVideos.map((v) => v.id);
    const watchMap = await getWatchStatusMapForUser(user.id, vodIds);

    const feedWithStatus = allVideos.map((v) => {
      const status = watchMap[v.id] || {
        isWatched: false,
        progressSeconds: 0,
        totalSeconds: v.lengthSeconds || 0,
      };

      const isNew = status.progressSeconds === 0 && !status.isWatched;
      const inProgress = status.progressSeconds > 0 && !status.isWatched;
      const isFavoriteCategory = favCategoryLower.has((v.game?.name || "").toLowerCase());

      const loginLower = (v.owner?.login || "").toLowerCase();
      const liveInfo = (liveMap as any)[loginLower];
      const isStreamerLive = Boolean(liveInfo?.isLive);

      // Check if this broadcast is currently live
      let isLive = false;
      if (isStreamerLive) {
        const streamIdMatches = Boolean(
          v.streamId && liveInfo?.streamId && String(v.streamId) === String(liveInfo.streamId)
        );
        const isRecentOngoingPlaceholder = Boolean(
          (v.previewThumbnailURL?.includes("404_processing") || v.previewThumbnailURL?.includes("_404/")) &&
          (new Date().getTime() - new Date(v.createdAt || v.publishedAt || 0).getTime() < 24 * 3600 * 1000)
        );

        if (streamIdMatches || isRecentOngoingPlaceholder) {
          isLive = true;
        } else if (liveChannelLatestVideoId.get(loginLower) === String(v.id)) {
          // If streamer is live and this video started within the last 12 hours
          const timeDiff = new Date().getTime() - new Date(v.createdAt || v.publishedAt || 0).getTime();
          if (timeDiff < 12 * 3600 * 1000) {
            isLive = true;
          }
        }
      }

      return {
        ...v,
        isLive,
        isStreamerLive,
        isFavoriteCategory,
        watchStatus: {
          ...status,
          isNew,
          inProgress,
        },
      };
    });

    return NextResponse.json({ videos: feedWithStatus, favoriteCategories, feedFilter, liveMap, stale: anyStale, oldestSnapshotAt, outages: getOutages() });
  } catch (err: any) {
    return handleApiError("streamers/feed", err, "Failed to generate personalized feed");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_feed_filter",
    maxRequests: 30,
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
    const filter = body.filter;

    if (!filter || !["all", "unwatched", "unwatched_no_live", "in_progress", "unlisted"].includes(filter)) {
      return NextResponse.json({ error: "Invalid feed filter option" }, { status: 400 });
    }

    const db = getDb();
    await db.execute({
      sql: "UPDATE users SET feed_filter = ? WHERE id = ?",
      args: [filter, user.id],
    });

    return NextResponse.json({ message: "Feed filter preference saved", filter });
  } catch (err: any) {
    return handleApiError("streamers/feed:POST", err, "Failed to save feed filter preference");
  }
}
