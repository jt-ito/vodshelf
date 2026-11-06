import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { rateLimitExceededResponse, handleApiError } from "@/lib/security/errors";
import { sanitizeLogin, sanitizeText } from "@/lib/security/sanitize";
import { getTwitchTrackerStreams, matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";
import { getSubOnlyVodMeta } from "@/lib/twitch/gql";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "tracker_redirect",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const { searchParams } = new URL(req.url);
    const login = sanitizeLogin(searchParams.get("login") || searchParams.get("streamerLogin") || "");
    const rawStreamId = searchParams.get("streamId") || searchParams.get("id") || "";
    const cleanStreamId = /^[0-9]{6,16}$/.test(rawStreamId.trim()) ? rawStreamId.trim() : "";
    const vodId = searchParams.get("vodId") ? String(searchParams.get("vodId")).trim() : "";
    let title = sanitizeText(searchParams.get("title") || "", 200);
    const startTime = sanitizeText(searchParams.get("startTime") || searchParams.get("createdAt") || "", 50);

    if (!login) {
      return NextResponse.redirect(new URL("https://twitchtracker.com"), 307);
    }

    const ttStreams = await getTwitchTrackerStreams(login);

    // 1. Direct stream ID match if known in TwitchTracker
    if (cleanStreamId) {
      const direct = ttStreams.find((s) => s.streamId === cleanStreamId);
      if (direct) {
        return NextResponse.redirect(
          new URL(`https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(cleanStreamId)}`),
          307
        );
      }
    }

    // 2. If title or startTime is provided, try matching
    if (title || startTime) {
      const match = matchTwitchTrackerStream(ttStreams, {
        title,
        startTime,
        streamId: cleanStreamId,
      });
      if (match) {
        return NextResponse.redirect(
          new URL(`https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(match.streamId)}`),
          307
        );
      }
    }

    // 3. If vodId is provided and we still haven't matched, try resolving metadata via Twitch GQL
    if (vodId && /^[0-9]{6,16}$/.test(vodId)) {
      try {
        const meta = await getSubOnlyVodMeta(vodId);
        if (meta?.title || meta?.createdAt) {
          const match = matchTwitchTrackerStream(ttStreams, {
            title: meta.title,
            createdAt: meta.createdAt,
            streamId: cleanStreamId,
          });
          if (match) {
            return NextResponse.redirect(
              new URL(`https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(match.streamId)}`),
              307
            );
          }
        }
      } catch {}
    }

    // 4. If an internal/indexer stream ID was provided, query indexer to find its title and start time
    if (cleanStreamId) {
      try {
        const indexerRes = await fetch(`https://api.vodvod.top/channels/@${encodeURIComponent(login)}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (indexerRes.ok) {
          const indexerData = await indexerRes.json();
          if (Array.isArray(indexerData)) {
            const found = indexerData.find(
              (item) => String(item?.Metadata?.StreamID || "").trim() === cleanStreamId
            );
            if (found && found.Metadata) {
              const matchedFromIndexer = matchTwitchTrackerStream(ttStreams, {
                title: found.Metadata.TitleAtStart,
                startTime: found.Metadata.StartTime,
                streamId: cleanStreamId,
              });
              if (matchedFromIndexer) {
                return NextResponse.redirect(
                  new URL(
                    `https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(
                      matchedFromIndexer.streamId
                    )}`
                  ),
                  307
                );
              }
            }
          }
        }
      } catch {}
    }

    // 5. If we have a streamId that wasn't verified on TT, check if it works directly
    if (cleanStreamId) {
      return NextResponse.redirect(
        new URL(`https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(cleanStreamId)}`),
        307
      );
    }

    // 6. Clean fallback to streamer's streams list (never 404!)
    return NextResponse.redirect(
      new URL(`https://twitchtracker.com/${encodeURIComponent(login)}/streams`),
      307
    );
  } catch (err: any) {
    return handleApiError("twitch/tracker-redirect", err, "Failed to redirect to TwitchTracker");
  }
}
