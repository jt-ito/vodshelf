import { NextRequest, NextResponse } from "next/server";
import { getChannelVods, searchChannelVods, type TwitchVodItem } from "@/lib/twitch/gql";
import { getCurrentUser } from "@/lib/auth/session";
import { sanitizeLogin, sanitizeNumber } from "@/lib/security/sanitize";
import { attachWatchStatusToVods } from "@/lib/watch/merge";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { extractStreamId } from "@/lib/twitch/tracker";
import { getTwitchTrackerStreams, matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { login: string } }
) {
  const rate = checkRateLimit(req, {
    prefix: "twitch_vods",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const cleanLogin = sanitizeLogin(params.login);
    if (!cleanLogin) {
      return NextResponse.json({ error: "Valid streamer login is required" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ? String(searchParams.get("q")).slice(0, 100).trim() : null;
    const first = sanitizeNumber(searchParams.get("first"), 1, 100, 24);
    const after = searchParams.get("after") ? String(searchParams.get("after")).slice(0, 500) : null;
    const rawType = (searchParams.get("type") || searchParams.get("broadcastType"))?.toUpperCase();
    const type = ["ARCHIVE", "HIGHLIGHT", "UPLOAD"].includes(rawType || "")
      ? (rawType as "ARCHIVE" | "HIGHLIGHT" | "UPLOAD")
      : null;

    let rawVideos: TwitchVodItem[] = [];
    let responseMetadata: Record<string, any> = {};

    const [vodResult, ttStreams] = await Promise.all([
      q
        ? searchChannelVods(cleanLogin, q, { broadcastType: type })
        : getChannelVods(cleanLogin, { first, after, broadcastType: type }),
      getTwitchTrackerStreams(cleanLogin).catch(() => []),
    ]);

    if (q) {
      const searchRes = vodResult as Awaited<ReturnType<typeof searchChannelVods>>;
      rawVideos = searchRes.videos;
      responseMetadata = {
        videos: rawVideos,
        totalSearched: searchRes.totalSearched,
        isSearch: true,
        query: q,
        hasNextPage: false,
        cursor: null,
      };
    } else {
      const vodData = vodResult as Awaited<ReturnType<typeof getChannelVods>>;
      rawVideos = vodData.videos;
      responseMetadata = {
        ...vodData,
      };
    }

    // Attach verified TwitchTracker stream IDs and URLs to each video
    rawVideos.forEach((v) => {
      const extractedSid = extractStreamId(v);
      const ttMatch = matchTwitchTrackerStream(ttStreams, v);
      const finalStreamId = ttMatch?.streamId || extractedSid || (v as any).streamId;
      if (finalStreamId) {
        (v as any).streamId = finalStreamId;
      }
      if (ttMatch?.streamId) {
        (v as any).twitchTrackerStreamId = ttMatch.streamId;
        (v as any).trackerUrl = `https://twitchtracker.com/${encodeURIComponent(cleanLogin)}/streams/${encodeURIComponent(
          ttMatch.streamId
        )}`;
      }
    });

    // Row-Level Security: attach watch progress only for the authenticated user
    const currentUser = await getCurrentUser(req);
    const videosWithWatch = currentUser
      ? await attachWatchStatusToVods(currentUser.id, rawVideos)
      : rawVideos.map((v) => ({
          ...v,
          watchStatus: {
            isWatched: false,
            progressSeconds: 0,
            totalSeconds: v.lengthSeconds || 0,
          },
        }));

    return NextResponse.json(
      {
        ...responseMetadata,
        videos: videosWithWatch,
      },
      {
        headers: {
          "Cache-Control": currentUser
            ? "private, no-cache, no-store, max-age=0, must-revalidate"
            : "public, s-maxage=60, stale-while-revalidate=300",
          Pragma: "no-cache",
          Vary: "Cookie, Authorization",
        },
      }
    );
  } catch (err: any) {
    return handleApiError("twitch/vods", err, "Failed to load channel VODs");
  }
}
