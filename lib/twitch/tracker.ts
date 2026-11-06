/**
 * Utility functions for generating TwitchTracker links and extracting stream IDs.
 */

import { sanitizeLogin } from "@/lib/security/sanitize";

export interface StreamIdExtractable {
  streamId?: string;
  twitchTrackerStreamId?: string;
  trackerUrl?: string;
  seekPreviewsURL?: string;
  previewThumbnailURL?: string;
  animatedPreviewURL?: string;
  id?: string;
  title?: string;
  createdAt?: string;
  publishedAt?: string;
  startTime?: string;
  owner?: {
    login?: string;
    displayName?: string;
  };
}

/**
 * Extracts a numeric Twitch broadcast stream ID from a video object or URL.
 * Twitch encodes the stream ID in seekPreviewsURL, animatedPreviewURL, and previewThumbnailURL as:
 * {hash}_{channel}_{streamId}_{timestamp}/...
 */
export function extractStreamId(video?: StreamIdExtractable | null): string | null {
  if (!video) return null;

  // 1. Confirmed TwitchTracker stream ID if pre-resolved
  if (video.twitchTrackerStreamId && /^[0-9]{6,16}$/.test(String(video.twitchTrackerStreamId).trim())) {
    return String(video.twitchTrackerStreamId).trim();
  }

  // 2. Direct streamId property (present on unlisted/indexed streams)
  if (video.streamId && /^[0-9]{6,16}$/.test(String(video.streamId).trim())) {
    return String(video.streamId).trim();
  }

  // 3. Parse from seekPreviewsURL, animatedPreviewURL, or previewThumbnailURL
  const urls = [
    video.seekPreviewsURL,
    video.previewThumbnailURL,
    video.animatedPreviewURL,
  ].filter(Boolean) as string[];
  for (const u of urls) {
    const match = u.match(/_([a-zA-Z0-9_]+)_([0-9]{6,16})_/);
    if (match && match[2]) {
      return match[2];
    }
  }

  // 4. If video.id is a 12+ digit stream ID (10-digit IDs like 2869751829 are Twitch VOD IDs, not stream IDs)
  if (
    video.id &&
    (/^[0-9]{12,16}$/.test(String(video.id).trim()) ||
      ((video as any).isUnlisted && /^[0-9]{6,16}$/.test(String(video.id).trim())))
  ) {
    return String(video.id).trim();
  }

  return null;
}

/**
 * Builds a valid TwitchTracker URL for a streamer and stream.
 * Direct stream stats format: https://twitchtracker.com/{login}/streams/{streamId}
 * Fallback format: https://twitchtracker.com/{login}/streams
 */
export function getTwitchTrackerUrl(
  streamerLogin?: string,
  streamIdOrVideo?: string | StreamIdExtractable | null
): string {
  const login = sanitizeLogin(streamerLogin);
  if (!login) return "https://twitchtracker.com";

  if (typeof streamIdOrVideo === "object" && streamIdOrVideo !== null) {
    // A. Explicit tracker URL already constructed
    if (streamIdOrVideo.trackerUrl) {
      return streamIdOrVideo.trackerUrl;
    }
    // B. Confirmed TwitchTracker stream ID
    if (
      streamIdOrVideo.twitchTrackerStreamId &&
      /^[0-9]{6,16}$/.test(String(streamIdOrVideo.twitchTrackerStreamId).trim())
    ) {
      return `https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(
        String(streamIdOrVideo.twitchTrackerStreamId).trim()
      )}`;
    }
  }

  let streamId: string | null = null;
  if (typeof streamIdOrVideo === "string") {
    const trimmed = streamIdOrVideo.trim();
    if (/^[0-9]{6,16}$/.test(trimmed)) {
      streamId = trimmed;
    }
  } else if (streamIdOrVideo) {
    streamId = extractStreamId(streamIdOrVideo);
  }

  if (streamId) {
    // If streamId was extracted or raw, but we have metadata to cross-reference (title or date),
    // and twitchTrackerStreamId has not been confirmed yet:
    // Route through safe tracker redirect to prevent 404s when CloudFront session IDs differ from Helix stream IDs!
    if (
      typeof streamIdOrVideo === "object" &&
      streamIdOrVideo !== null &&
      !streamIdOrVideo.twitchTrackerStreamId &&
      (streamIdOrVideo.title || streamIdOrVideo.createdAt || streamIdOrVideo.startTime || streamIdOrVideo.id)
    ) {
      const title = streamIdOrVideo.title ? encodeURIComponent(streamIdOrVideo.title) : "";
      const startTime = encodeURIComponent(
        streamIdOrVideo.createdAt || streamIdOrVideo.startTime || streamIdOrVideo.publishedAt || ""
      );
      const vodId = streamIdOrVideo.id ? encodeURIComponent(streamIdOrVideo.id) : "";
      return `/api/twitch/tracker-redirect?login=${encodeURIComponent(login)}&streamId=${encodeURIComponent(
        streamId
      )}&vodId=${vodId}&title=${title}&startTime=${startTime}`;
    }

    return `https://twitchtracker.com/${encodeURIComponent(login)}/streams/${encodeURIComponent(streamId)}`;
  }

  return `https://twitchtracker.com/${encodeURIComponent(login)}/streams`;
}
