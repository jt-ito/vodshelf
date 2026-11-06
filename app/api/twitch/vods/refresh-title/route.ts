import { NextRequest, NextResponse } from "next/server";
import { twitchGqlFetch } from "@/lib/twitch/gql";
import { sanitizeVodId, sanitizeLogin, sanitizeText } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import { getTwitchTrackerStreams, matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";

export const dynamic = "force-dynamic";

interface GqlVideoResponse {
  video: {
    id: string;
    title: string;
    broadcastType: string;
    status: string;
    createdAt: string;
    publishedAt: string;
    lengthSeconds: number;
    game: {
      name: string;
    } | null;
    owner: {
      login: string;
      displayName: string;
      broadcastSettings: {
        title: string;
        game: {
          name: string;
        } | null;
      } | null;
      stream: {
        id: string;
        title: string;
        game: {
          name: string;
        } | null;
      } | null;
    } | null;
  } | null;
}

/**
 * Looks up the latest title TwitchTracker has for this exact broadcast (matched by stream id /
 * start time), not just the channel's most recent stream. Returns available=false when the
 * tracker returned no data at all (e.g. blocked by Cloudflare), so callers can say so honestly.
 */
async function lookupTrackerTitle(
  login: string,
  item: { createdAt?: string; title?: string }
): Promise<{ title: string | null; available: boolean }> {
  const streams = await getTwitchTrackerStreams(login);
  if (streams.length === 0) return { title: null, available: false };

  let match = matchTwitchTrackerStream(streams, item);

  // A streamer who rewrites the title mid-stream leaves nothing for the title matcher to latch onto.
  // For a title refresh a broadcast that started within 10 minutes of the VOD is the same broadcast.
  if (!match && item.createdAt) {
    const start = Date.parse(item.createdAt);
    let bestDiff = 10 * 60_000;
    for (const s of streams) {
      const diff = Math.abs(s.timestamp - start);
      if (diff <= bestDiff) {
        bestDiff = diff;
        match = s;
      }
    }
  }
  return { title: match?.title?.trim() || null, available: true };
}

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "refresh_vod_title",
    maxRequests: 45,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const { searchParams } = new URL(req.url);
    const vodId = sanitizeVodId(searchParams.get("vodId"));
    const streamerLogin = sanitizeLogin(searchParams.get("streamerLogin") || searchParams.get("login"));
    const currentTitle = sanitizeText(searchParams.get("currentTitle") || "", 200);

    if (!vodId) {
      return NextResponse.json({ error: "Valid numeric vodId is required" }, { status: 400 });
    }

    const query = `
      query GetVideoWithSettings($id: ID!) {
        video(id: $id) {
          id
          title
          broadcastType
          status
          createdAt
          publishedAt
          lengthSeconds
          game {
            name
          }
          owner {
            login
            displayName
            broadcastSettings {
              title
              game {
                name
              }
            }
            stream {
              id
              title
              game {
                name
              }
            }
          }
        }
      }
    `;

    // Direct, uncached Twitch GQL fetch
    const gqlData = await twitchGqlFetch<GqlVideoResponse>(query, { id: vodId });
    const video = gqlData?.video;

    if (!video) {
      // If video node not found directly, attempt TwitchTracker fallback if login provided
      if (streamerLogin) {
        const tracker = await lookupTrackerTitle(streamerLogin, { title: currentTitle });
        if (tracker.title && tracker.title !== currentTitle) {
          return NextResponse.json({
            title: tracker.title,
            updated: true,
            source: "twitchtracker",
          });
        }
      }
      return NextResponse.json({ error: "VOD metadata not found" }, { status: 404 });
    }

    const vodTitle = (video.title || "").trim();
    const liveStreamTitle = (video.owner?.stream?.title || "").trim();
    const broadcastSettingsTitle = (video.owner?.broadcastSettings?.title || "").trim();
    const gameName = video.game?.name || video.owner?.broadcastSettings?.game?.name || "";

    // Determine latest candidate title
    // Priority order:
    // 1. Live stream active title (if currently streaming this broadcast)
    // 2. BroadcastSettings updated title (streamers update this mid-stream via OBS / Stream Manager)
    // 3. Fresh VOD node title on Twitch
    // 4. TwitchTracker fallback
    let candidateTitle = vodTitle;
    let source = "twitch_vod";

    const isRecentOrOngoing =
      !video.lengthSeconds ||
      video.lengthSeconds === 0 ||
      (video.createdAt && Date.now() - new Date(video.createdAt).getTime() < 4 * 86400 * 1000);

    if (liveStreamTitle && isRecentOrOngoing) {
      candidateTitle = liveStreamTitle;
      source = "twitch_live_stream";
    } else if (broadcastSettingsTitle && isRecentOrOngoing && broadcastSettingsTitle !== vodTitle) {
      candidateTitle = broadcastSettingsTitle;
      source = "twitch_broadcast_settings";
    } else if (vodTitle && vodTitle !== currentTitle) {
      candidateTitle = vodTitle;
      source = "twitch_vod_updated";
    }

    // Twitch only exposes the title a VOD started with. If it matches what we already show, ask
    // TwitchTracker (which records mid-stream title changes) for this specific broadcast.
    let trackerAvailable: boolean | null = null;
    const streamerForTracker = streamerLogin || video.owner?.login;
    if (candidateTitle === currentTitle && streamerForTracker) {
      const tracker = await lookupTrackerTitle(streamerForTracker, { createdAt: video.createdAt, title: currentTitle });
      trackerAvailable = tracker.available;
      if (tracker.title && tracker.title !== currentTitle) {
        candidateTitle = tracker.title;
        source = "twitchtracker";
      }
    }

    const hasUpdated = Boolean(candidateTitle && candidateTitle !== currentTitle);

    logger.info("Stream title refresh checked", {
      vodId,
      streamerLogin: streamerLogin || video.owner?.login,
      currentTitle,
      candidateTitle,
      hasUpdated,
      source,
    });

    return NextResponse.json({
      title: candidateTitle || currentTitle || vodTitle,
      updated: hasUpdated,
      source,
      gameName,
      trackerAvailable,
      message: hasUpdated
        ? `Stream title updated to "${candidateTitle}"`
        : trackerAvailable === false
        ? "No newer title found. TwitchTracker couldn't be reached to check for mid-stream title changes."
        : "Stream title is already up to date.",
    });
  } catch (err: any) {
    return handleApiError("twitch/vods/refresh-title", err, "Failed to refresh stream title");
  }
}
