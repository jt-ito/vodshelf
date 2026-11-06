import { NextRequest, NextResponse } from "next/server";
import { getChannelVods } from "@/lib/twitch/gql";
import { CLOUDFRONT_DOMAINS } from "@/lib/twitch/cdn-prober";
import { sanitizeLogin } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { getCurrentUser } from "@/lib/auth/session";
import { getWatchStatusMapForUser, type WatchStatusInfo } from "@/lib/watch/merge";
import { serverCache } from "@/lib/cache/ttl-cache";
import { extractStreamId } from "@/lib/twitch/tracker";
import { getTwitchTrackerStreams, matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";
import { isCircuitOpen, reportUpstreamFailure, reportUpstreamSuccess } from "@/lib/twitch/upstream-health";
import { vodvodAvailability, type Availability } from "@/lib/twitch/availability";
import { isSameBroadcast } from "@/lib/twitch/broadcast";

export const dynamic = "force-dynamic";

export interface RecoveredStreamItem {
  id: string;
  streamId: string;
  vodId?: string;
  twitchTrackerStreamId?: string;
  trackerUrl?: string;
  title: string;
  streamerLogin: string;
  startTime: string;
  durationSeconds: number;
  gameName?: string;
  isUnlisted: boolean;
  status: "active" | "purged" | "unknown";
  masterPlaylistUrl: string;
  proxiedUrl: string;
  confirmedDomain?: string;
  source: "indexer" | "gql_extraction";
  /** Whether VODVOD's playlist for this stream will play yet */
  availability: Availability;
  watchStatus?: WatchStatusInfo;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { login: string } }
) {
  const rate = checkRateLimit(req, {
    prefix: "twitch_cdn_list",
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

    const cacheKey = `cdn:list:${cleanLogin}`;
    const built = await serverCache.fetchOrGet(
      cacheKey,
      300_000,
      async () => {
        const resultStreams: RecoveredStreamItem[] = [];

        // Fetch indexer records, Twitch public VODs, and TwitchTracker stream records concurrently
        let twitchFailed = false;
        const [indexerRes, gqlVodsRes, ttStreams] = await Promise.all([
          isCircuitOpen("vodvod")
            ? Promise.resolve(null)
            : fetch(`https://api.vodvod.top/channels/@${cleanLogin}`, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
                cache: "no-store",
                signal: AbortSignal.timeout(8000),
              }).catch(() => null),
          getChannelVods(cleanLogin, { first: 30, broadcastType: "ARCHIVE" }).catch(() => {
            twitchFailed = true;
            return { videos: [] };
          }),
          getTwitchTrackerStreams(cleanLogin).catch(() => []),
        ]);

        // VODVOD health: 404 just means "not indexed"; 5xx, rate limiting and network failures are outages
        const indexerOk = Boolean(indexerRes && (indexerRes.ok || (indexerRes.status < 500 && indexerRes.status !== 429)));
        if (indexerOk) reportUpstreamSuccess("vodvod");
        else reportUpstreamFailure("vodvod", indexerRes ? `HTTP ${indexerRes.status}` : "network error");

        let indexerData: any[] = [];
        if (indexerRes && indexerRes.ok) {
          try {
            const parsed = await indexerRes.json();
            if (Array.isArray(parsed)) {
              indexerData = parsed;
            }
          } catch {}
        }

        const publicVods = (gqlVodsRes?.videos || []).map((v) => {
          const extractedSid = extractStreamId(v);
          const ttMatch = matchTwitchTrackerStream(ttStreams, v);
          return {
            ...v,
            extractedStreamId: extractedSid,
            ttMatch,
          };
        });

        const coveredVodIds = new Set<string>();

        // 1. Process indexer streams and cross-reference against Twitch public VODs
        for (const item of indexerData) {
          if (!item || typeof item !== "object") continue;
          const meta = item.Metadata || {};
          const rawStreamId = meta.StreamID ? String(meta.StreamID).trim() : "";
          const isPublicInIndexer = meta.Public?.Bool ?? true;
          const link = item.Link || "";
          const directM3u8 = link ? `https://api.vodvod.top${link}` : "";
          let availability = vodvodAvailability(meta);
          if (!link && availability === "ready") availability = "processing";
          const proxiedUrl = directM3u8 ? `/api/proxy/m3u8?url=${encodeURIComponent(directM3u8)}` : "";
          const startTime = meta.StartTime || "";
          const title = meta.TitleAtStart || `Broadcast ${rawStreamId}`;

          // Check if this stream is actually an available public Twitch VOD
          let matchedVod: (typeof publicVods)[number] | null = null;
          for (const pv of publicVods) {
            // A. Extracted stream ID match
            if (rawStreamId && pv.extractedStreamId === rawStreamId) {
              matchedVod = pv;
              break;
            }
            // B. URL pattern match
            const pvUrls = [pv.seekPreviewsURL, pv.previewThumbnailURL].filter(Boolean).join(" ");
            if (rawStreamId && pvUrls.includes(`_${rawStreamId}_`)) {
              matchedVod = pv;
              break;
            }
            // C. Session broadcast comparison
            if (isSameBroadcast(pv, { title, startTime })) {
              matchedVod = pv;
              break;
            }
          }

          if (matchedVod) {
            coveredVodIds.add(matchedVod.id);
          }

          // Match against TwitchTracker streams
          const ttMatch =
            matchedVod?.ttMatch ||
            matchTwitchTrackerStream(ttStreams, {
              title,
              startTime,
              streamId: rawStreamId,
            });

          const finalStreamId = ttMatch?.streamId || matchedVod?.extractedStreamId || rawStreamId;
          const trackerUrl = ttMatch
            ? `https://twitchtracker.com/${encodeURIComponent(cleanLogin)}/streams/${encodeURIComponent(ttMatch.streamId)}`
            : undefined;

          // If a stream exists in Twitch's public VOD archive, it is definitively NOT unlisted/privated
          const isActuallyUnlisted = matchedVod ? false : !isPublicInIndexer;

          resultStreams.push({
            id: matchedVod?.id || meta.ID || finalStreamId,
            streamId: finalStreamId,
            vodId: matchedVod?.id,
            twitchTrackerStreamId: ttMatch?.streamId,
            trackerUrl,
            title,
            streamerLogin: cleanLogin,
            startTime,
            durationSeconds: Math.round(meta.HlsDurationSeconds?.Float64 || 0),
            gameName: meta.GameNameAtStart || undefined,
            isUnlisted: isActuallyUnlisted,
            status: "active",
            masterPlaylistUrl: directM3u8,
            proxiedUrl,
            source: "indexer",
            availability,
          });
        }

        // 2. Add public VODs that weren't captured by the external indexer
        for (const pv of publicVods) {
          if (coveredVodIds.has(pv.id)) continue;

          let storageHash: string | undefined;
          let domain: string = CLOUDFRONT_DOMAINS[0];

          const previewUrl = pv.previewThumbnailURL || "";
          const seekUrl = pv.seekPreviewsURL || "";

          if (seekUrl) {
            const match = seekUrl.match(/https?:\/\/([^/]+)\/([^/]+)\//);
            if (match) {
              domain = match[1];
              storageHash = match[2];
            }
          } else if (previewUrl) {
            const match = previewUrl.match(/\/cf_vods\/([^/]+)\/([^/]+)\//);
            if (match) {
              domain = `${match[1]}.cloudfront.net`;
              storageHash = match[2];
            }
          }

          if (storageHash) {
            const masterUrl = `https://${domain}/${storageHash}/chunked/index-dvr.m3u8`;
            const proxied = `/api/proxy/m3u8?url=${encodeURIComponent(masterUrl)}`;
            const finalStreamId = pv.ttMatch?.streamId || pv.extractedStreamId || pv.id;
            const trackerUrl = pv.ttMatch
              ? `https://twitchtracker.com/${encodeURIComponent(cleanLogin)}/streams/${encodeURIComponent(pv.ttMatch.streamId)}`
              : undefined;

            resultStreams.push({
              id: pv.id,
              streamId: finalStreamId,
              vodId: pv.id,
              twitchTrackerStreamId: pv.ttMatch?.streamId,
              trackerUrl,
              title: pv.title,
              streamerLogin: cleanLogin,
              startTime: pv.createdAt || "",
              durationSeconds: pv.lengthSeconds || 0,
              gameName: pv.game?.name,
              isUnlisted: false,
              status: "active",
              masterPlaylistUrl: masterUrl,
              proxiedUrl: proxied,
              confirmedDomain: domain,
              source: "gql_extraction",
              availability: "ready",
            });
          }
        }

        // Sort chronologically (newest first)
        resultStreams.sort((a, b) => {
          const dateA = new Date(a.startTime || 0).getTime();
          const dateB = new Date(b.startTime || 0).getTime();
          return dateB - dateA;
        });

        // `complete` is false when a required source failed, so the partial list is not cached for 5 minutes
        return { streams: resultStreams, complete: indexerOk && !twitchFailed };
      }
    );
    if (!built.complete) serverCache.delete(cacheKey);
    const streams = built.streams;

    const currentUser = await getCurrentUser(req);
    let streamsWithWatch: RecoveredStreamItem[] = streams;
    if (currentUser && streams.length > 0) {
      const ids = Array.from(
        new Set(streams.flatMap((s) => [s.vodId, s.streamId, s.id].filter(Boolean) as string[]))
      );
      const watchMap = await getWatchStatusMapForUser(currentUser.id, ids);
      streamsWithWatch = streams.map((s) => {
        const watch =
          (s.vodId && watchMap[s.vodId]) ||
          (s.streamId && watchMap[s.streamId]) ||
          watchMap[s.id] || {
            isWatched: false,
            progressSeconds: 0,
            totalSeconds: s.durationSeconds || 0,
          };
        return {
          ...s,
          watchStatus: watch,
        };
      });
    } else {
      streamsWithWatch = streams.map((s) => ({
        ...s,
        watchStatus: {
          isWatched: false,
          progressSeconds: 0,
          totalSeconds: s.durationSeconds || 0,
        },
      }));
    }

    return NextResponse.json(
      {
        streamerLogin: cleanLogin,
        count: streamsWithWatch.length,
        streams: streamsWithWatch,
      },
      {
        headers: {
          "Cache-Control": currentUser
            ? "private, no-cache"
            : "public, s-maxage=120, stale-while-revalidate=600",
        },
      }
    );
  } catch (err: any) {
    return handleApiError("twitch/cdn-list", err, "Failed to load stream manifests");
  }
}
