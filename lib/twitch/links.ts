import type { TwitchVodItem } from "./gql";
import { getTwitchTrackerUrl } from "./tracker";

/**
 * Builds a canonical link for any video item (standard VOD or unlisted/CDN stream).
 */
export function getVideoLink(video: TwitchVodItem | any): string {
  if (!video) return "";

  const isUnlisted = Boolean(video.isUnlisted || video.broadcastType === "UNLISTED");
  const m3u8 =
    video.masterPlaylistUrl ||
    (video.proxiedUrl?.includes("url=")
      ? decodeURIComponent(video.proxiedUrl.split("url=")[1])
      : video.proxiedUrl) ||
    video.m3u8Url ||
    "";

  if (isUnlisted) {
    if (m3u8) return m3u8;
    return getTwitchTrackerUrl(video.owner?.login, video);
  }

  const idStr = String(video.id || "");
  if (/^\d+$/.test(idStr)) {
    return `https://www.twitch.tv/videos/${idStr}`;
  }

  if (m3u8) return m3u8;
  return `https://www.twitch.tv/videos/${idStr}`;
}
