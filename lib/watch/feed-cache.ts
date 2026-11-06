export const FEED_CACHE_KEY = "twitch_feed_cache_v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface FeedCache {
  savedAt: number;
  videos: any[];
  favoriteCategories: string[];
}

/** Last successful feed payload, shown instantly while a fresh copy loads (stale-while-revalidate). */
export function readFeedCache(): FeedCache | null {
  try {
    const raw = localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedCache;
    if (!Array.isArray(parsed.videos) || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFeedCache(videos: any[], favoriteCategories: string[]): void {
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), videos, favoriteCategories }));
  } catch {
    // Quota exceeded or storage blocked: the cache is optional
  }
}
