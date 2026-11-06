import { getSubOnlyVodMeta, type TwitchVodItem } from "./gql";

export const CLOUDFRONT_DOMAINS = [
  "d2vi6trrdongqn.cloudfront.net",
  "dqrpb9wgowsf5.cloudfront.net",
  "ds0h3roq6wcgc.cloudfront.net",
  "d2vjef5jvl6bfs.cloudfront.net",
  "d1m7jfoe9zdc1j.cloudfront.net",
  "d3c27h4revp5fk.cloudfront.net",
  "d2nvs31859zcd8.cloudfront.net",
  "d1ymi26ma8va5f.cloudfront.net",
];

export const STREAM_QUALITIES = [
  { id: "chunked", label: "Source / Original", resolution: "1920x1080", bitrate: 8500000 },
  { id: "1080p60", label: "1080p 60fps", resolution: "1920x1080", bitrate: 6000000 },
  { id: "720p60", label: "720p 60fps", resolution: "1280x720", bitrate: 3500000 },
  { id: "480p30", label: "480p", resolution: "854x480", bitrate: 1500000 },
  { id: "360p30", label: "360p", resolution: "640x360", bitrate: 800000 },
  { id: "160p30", label: "160p", resolution: "284x160", bitrate: 300000 },
];

export interface RecoveredQuality {
  id: string;
  label: string;
  url: string;
  proxiedUrl: string;
  isAvailable: boolean;
}

export interface CdnRecoveryResult {
  vodId: string;
  title: string;
  streamerLogin: string;
  streamerDisplayName: string;
  createdAt: string;
  durationSeconds: number;
  previewThumbnailURL?: string;
  storyboardUrl?: string;
  vodSpecialId?: string;
  confirmedDomain?: string;
  status: "available" | "partial" | "purged" | "not_found";
  masterPlaylistUrl?: string;
  proxiedMasterUrl?: string;
  qualities: RecoveredQuality[];
  sourceMethod: "storyboard_bypass" | "domain_probe" | "twitchtracker_fallback" | "none";
}

/**
 * Parses CloudFront domain and special VOD ID from a storyboard / seekPreviewsURL.
 * Format: https://{domain}/{vodSpecialId}/storyboards/{vodId}-strip-0.jpg
 */
export function parseStoryboardUrl(url: string): { domain: string; vodSpecialId: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const domain = u.hostname;
    // path format: /<vodSpecialId>/storyboards/...
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const vodSpecialId = parts[0];
      return { domain, vodSpecialId };
    }
  } catch {
    // regex fallback
    const match = url.match(/https?:\/\/([^/]+)\/([^/]+)\/storyboards\//);
    if (match) {
      return { domain: match[1], vodSpecialId: match[2] };
    }
  }
  return null;
}

/**
 * Checks if a specific CloudFront manifest or chunk exists via quick HEAD probe.
 */
export async function probeManifestUrl(url: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(id);
    return res.status === 200 || res.status === 206;
  } catch {
    clearTimeout(id);
    return false;
  }
}

/**
 * Probes all candidate CloudFront domains for a known vodSpecialId.
 */
export async function probeCandidateDomains(vodSpecialId: string): Promise<string | null> {
  const probePromises = CLOUDFRONT_DOMAINS.map(async (domain) => {
    const testUrl = `https://${domain}/${vodSpecialId}/chunked/index-dvr.m3u8`;
    const ok = await probeManifestUrl(testUrl, 3500);
    return ok ? domain : null;
  });

  const results = await Promise.all(probePromises);
  const found = results.find((d) => d !== null);
  return found || null;
}

import { serverCache } from "../cache/ttl-cache";

/**
 * Main function to recover a VOD's CDN streams.
 */
export async function recoverVodStreams(vodId: string): Promise<CdnRecoveryResult> {
  const cleanId = vodId.replace(/^v/, "").trim();
  const cacheKey = `cdn:probe:${cleanId}`;

  return serverCache.fetchOrGet(cacheKey, 1800_000, async () => {
    const vodMeta = await getSubOnlyVodMeta(cleanId);

    let streamerLogin = vodMeta?.owner?.login || "";
    let streamerDisplayName = vodMeta?.owner?.displayName || "";
    let title = vodMeta?.title || `Twitch VOD ${cleanId}`;
    let createdAt = vodMeta?.createdAt || new Date().toISOString();
    let durationSeconds = vodMeta?.lengthSeconds || 0;
    let previewThumbnailURL = vodMeta?.previewThumbnailURL || "";
    let storyboardUrl = vodMeta?.seekPreviewsURL || "";
    let vodSpecialId: string | undefined;
    let confirmedDomain: string | undefined;
    let method: CdnRecoveryResult["sourceMethod"] = "none";

    // 1. Check if we have seekPreviewsURL from GQL (Method 1: Sub-Only Storyboard Bypass)
    if (storyboardUrl) {
      const parsed = parseStoryboardUrl(storyboardUrl);
      if (parsed) {
        vodSpecialId = parsed.vodSpecialId;
        // Probe the primary domain
        const primaryUrl = `https://${parsed.domain}/${vodSpecialId}/chunked/index-dvr.m3u8`;
        const isPrimaryOk = await probeManifestUrl(primaryUrl, 3000);

        if (isPrimaryOk) {
          confirmedDomain = parsed.domain;
          method = "storyboard_bypass";
        } else {
          // Try other candidate domains
          const fallbackDomain = await probeCandidateDomains(vodSpecialId);
          if (fallbackDomain) {
            confirmedDomain = fallbackDomain;
            method = "domain_probe";
          }
        }
      }
    }

    // 2. If no storyboard found or not working, attempt TwitchTracker fallback (Method 3)
    if (!confirmedDomain && streamerLogin) {
      const ttResult = await scrapeTwitchTrackerStream(streamerLogin, cleanId);
      if (ttResult && ttResult.vodSpecialId) {
        vodSpecialId = ttResult.vodSpecialId;
        title = ttResult.title || title;
        durationSeconds = ttResult.durationSeconds || durationSeconds;
        const domain = await probeCandidateDomains(vodSpecialId);
        if (domain) {
          confirmedDomain = domain;
          method = "twitchtracker_fallback";
        }
      }
    }

    // If still no confirmed domain, but we have vodSpecialId from storyboard, use it anyway so user can inspect
    const domainToUse = confirmedDomain || CLOUDFRONT_DOMAINS[0];
    const isAvailable = !!confirmedDomain;

    const qualities: RecoveredQuality[] = STREAM_QUALITIES.map((q) => {
      const rawUrl = vodSpecialId
        ? `https://${domainToUse}/${vodSpecialId}/${q.id}/index-dvr.m3u8`
        : "";
      const proxiedUrl = rawUrl
        ? `/api/proxy/m3u8?url=${encodeURIComponent(rawUrl)}`
        : "";
      return {
        id: q.id,
        label: q.label,
        url: rawUrl,
        proxiedUrl,
        isAvailable,
      };
    });

    const masterUrl = vodSpecialId
      ? `https://${domainToUse}/${vodSpecialId}/chunked/index-dvr.m3u8`
      : undefined;
    const proxiedMaster = masterUrl
      ? `/api/proxy/m3u8?url=${encodeURIComponent(masterUrl)}`
      : undefined;

    return {
      vodId: cleanId,
      title,
      streamerLogin,
      streamerDisplayName,
      createdAt,
      durationSeconds,
      previewThumbnailURL,
      storyboardUrl,
      vodSpecialId,
      confirmedDomain,
      status: isAvailable ? "available" : vodSpecialId ? "partial" : "purged",
      masterPlaylistUrl: masterUrl,
      proxiedMasterUrl: proxiedMaster,
      qualities,
      sourceMethod: method,
    };
  });
}

/**
 * Scrapes stream metadata from TwitchTracker for a streamer to find historical stream IDs and timestamps.
 */
export async function scrapeTwitchTrackerStream(
  streamerLogin: string,
  streamIdOrVodId: string
): Promise<{ title?: string; durationSeconds?: number; vodSpecialId?: string } | null> {
  try {
    const url = `https://twitchtracker.com/${streamerLogin.toLowerCase()}/streams/${streamIdOrVodId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/ - TwitchTracker.*/i, "").trim() : undefined;

    // Look for stream timestamp or metadata
    const timestampMatch = html.match(/data-timestamp="(\d+)"/i) || html.match(/"broadcast_id":"(\d+)"/i);
    const broadcastId = timestampMatch ? timestampMatch[1] : streamIdOrVodId;

    return {
      title,
      vodSpecialId: undefined, // Specific hash generation can be tested if needed
    };
  } catch (err) {
    console.error("TwitchTracker query error:", err);
    return null;
  }
}
