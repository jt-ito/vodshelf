import { serverCache } from "@/lib/cache/ttl-cache";
import { type TwitchVodItem, buildCategoryThumbnailUrl } from "./gql";
import { sanitizeLogin, sanitizeText } from "@/lib/security/sanitize";
import { isCircuitOpen, reportUpstreamFailure, reportUpstreamSuccess } from "@/lib/twitch/upstream-health";
import { vodvodAvailability, type Availability } from "@/lib/twitch/availability";

export interface UnlistedVodItem extends TwitchVodItem {
  isUnlisted: boolean;
  streamId: string;
  masterPlaylistUrl: string;
  proxiedUrl: string;
  /** Whether VODVOD's playlist for this broadcast will play yet */
  availability: Availability;
}

/**
 * Fetches unlisted and privated streams indexed for a channel, cached in server memory.
 * Throws when VODVOD itself is unreachable (so callers can tell an outage from "no streams");
 * failures are never cached.
 */
export async function getChannelUnlistedStreams(
  login: string,
  options: {
    streamerDisplayName?: string;
    streamerAvatarUrl?: string;
  } = {}
): Promise<UnlistedVodItem[]> {
  const cleanLogin = sanitizeLogin(login);
  if (!cleanLogin) return [];

  const cacheKey = `indexer:unlisted:${cleanLogin}`;

  return serverCache.fetchOrGet(cacheKey, 300_000, async () => {
    if (isCircuitOpen("vodvod")) {
      throw new Error("VODVOD is currently unreachable");
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`https://api.vodvod.top/channels/@${cleanLogin}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        // 5xx / rate limiting = VODVOD is struggling; 404 etc. just means the channel isn't indexed
        if (res.status >= 500 || res.status === 429) {
          throw new Error(`VODVOD HTTP ${res.status}`);
        }
        reportUpstreamSuccess("vodvod");
        return [];
      }

      const data = await res.json();
      reportUpstreamSuccess("vodvod");
      if (!Array.isArray(data)) {
        return [];
      }

      const unlistedItems: UnlistedVodItem[] = [];

      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const meta = item.Metadata || {};
        const isPublic = meta.Public?.Bool ?? true;

        // We only take unlisted or privated broadcasts
        if (isPublic) {
          continue;
        }

        const rawStreamId = meta.StreamID != null ? String(meta.StreamID).trim() : "";
        const streamId = /^[0-9]{6,16}$/.test(rawStreamId) ? rawStreamId : "";

        // A broadcast VODVOD has not produced a link for yet is kept (flagged "processing"), not dropped.
        // A link that is present but not a plain relative path is rejected to prevent host injection.
        const rawLink = typeof item.Link === "string" ? item.Link.trim() : "";
        const hasLink = rawLink !== "";
        if (hasLink && (!rawLink.startsWith("/") || rawLink.startsWith("//") || rawLink.includes("\\"))) {
          continue;
        }

        const directM3u8 = hasLink ? `https://api.vodvod.top${rawLink}` : "";
        const proxiedUrl = hasLink ? `/api/proxy/m3u8?url=${encodeURIComponent(directM3u8)}` : "";
        let availability = vodvodAvailability(meta);
        if (!hasLink && availability === "ready") availability = "processing";
        const id = streamId || (meta.ID ? sanitizeText(String(meta.ID), 64) : "") || `unlisted_${Date.now()}`;

        const rawDuration = Number(meta.HlsDurationSeconds?.Float64);
        const durationSeconds = !isNaN(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0;
        const startTime = meta.StartTime || new Date().toISOString();

        // High-res profile image URL (e.g. 300x300 instead of 50x50)
        const rawProfile = options.streamerAvatarUrl || meta.ProfileImageUrlAtStart?.String || "";
        const highResProfile = rawProfile.replace(/-\d+x\d+\.(jpg|png|jpeg)/i, "-300x300.$1");

        // High-res category box art URL (e.g. 285x380 instead of 40x56)
        const rawBox = meta.BoxArtUrlAtStart?.String || "";
        const highResBox = rawBox ? rawBox.replace(/-\d+x\d+\.(jpg|png|jpeg)/i, "-285x380.$1") : "";

        unlistedItems.push({
          id,
          title: meta.TitleAtStart || `Broadcast ${streamId || id}`,
          broadcastType: "UNLISTED",
          createdAt: startTime,
          publishedAt: startTime,
          lengthSeconds: durationSeconds,
          viewCount: meta.MaxViews || 0,
          previewThumbnailURL: "", // Never stretch a portrait category art or profile avatar as a 16:9 thumbnail
          game: meta.GameNameAtStart
            ? {
                id: meta.GameIDAtStart || "",
                name: meta.GameNameAtStart,
                boxArtURL: buildCategoryThumbnailUrl(highResBox || undefined, meta.GameIDAtStart),
              }
            : undefined,
          owner: {
            id: meta.StreamerID || "",
            login: cleanLogin,
            displayName: options.streamerDisplayName || meta.StreamerLoginAtStart || cleanLogin,
            profileImageURL: highResProfile || undefined,
          },
          isUnlisted: true,
          streamId: streamId || id,
          masterPlaylistUrl: directM3u8,
          proxiedUrl,
          availability,
        });
      }

      return unlistedItems;
    } catch (err: any) {
      reportUpstreamFailure("vodvod", err?.name === "AbortError" ? "timeout" : String(err?.message || "network error"));
      throw err;
    }
  });
}
