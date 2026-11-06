import { serverCache } from "@/lib/cache/ttl-cache";
import { sanitizeLogin } from "@/lib/security/sanitize";
import { normalizeTitle, titleSimilarity } from "./broadcast";
import { isCircuitOpen, reportUpstreamFailure, reportUpstreamSuccess } from "./upstream-health";

export interface TwitchTrackerStream {
  streamId: string;
  date: string;
  timestamp: number;
  title: string;
  games?: Array<{ id: number; name: string }>;
}

/**
 * Fetches and decodes the broadcast stream history from TwitchTracker for a streamer.
 * Cached in server memory for 10 minutes.
 */
export async function getTwitchTrackerStreams(login: string): Promise<TwitchTrackerStream[]> {
  const cleanLogin = sanitizeLogin(login);
  if (!cleanLogin) return [];

  const cacheKey = `twitchtracker:streams:${cleanLogin}`;

  // A blocked/failed fetch is cached for 5 minutes: short enough to recover from a Cloudflare hiccup,
  // long enough not to re-hit a blocked site for every pinned streamer on every feed refresh
  const fail = (): null => {
    serverCache.set(cacheKey, [], 300_000);
    return null;
  };

  const result = await serverCache.fetchOrGet<TwitchTrackerStream[] | null>(cacheKey, 600_000, async () => {
    // Don't keep knocking on a site that has been failing (e.g. blocking us)
    if (isCircuitOpen("twitchtracker")) return fail();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`https://twitchtracker.com/${encodeURIComponent(cleanLogin)}/streams`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        reportUpstreamFailure("twitchtracker", `HTTP ${res.status}`);
        return fail();
      }

      const html = await res.text();
      const metaMatch = html.match(/id="ecs"\s+content="([^"]+)"/);
      if (!metaMatch || !metaMatch[1]) {
        reportUpstreamFailure("twitchtracker", "unexpected page format");
        return fail();
      }

      // TwitchTracker obfuscation: splits parts by '!', replaces '#' with 'W', base64 decodes
      const parts = metaMatch[1].split("!");
      const lastPart = parts.pop();
      if (!lastPart) return fail();

      const keysStr = Buffer.from(lastPart.replace(/#/g, "W"), "base64").toString("utf-8");
      const keys = JSON.parse(keysStr);

      const Y: Record<string, any> = {};
      for (let i = 0; i < parts.length; i++) {
        const key = keys[i];
        if (key) {
          const valStr = Buffer.from(parts[i].replace(/#/g, "W"), "base64").toString("utf-8");
          try {
            Y[key] = JSON.parse(valStr);
          } catch {}
        }
      }

      const complicator = Y.complicator || {};
      const streams: TwitchTrackerStream[] = [];
      const rowRegex =
        /<tr[^>]*>[\s\S]*?<td[^>]*data-order="([^"]+)"[\s\S]*?<td[^>]*class="status[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

      let match: RegExpExecArray | null;
      while ((match = rowRegex.exec(html)) !== null) {
        const dateOrder = match[1]; // e.g. "2026-09-19 15:50"
        const rawTitle = match[2].replace(/<[^>]+>/g, "").trim();
        const comp = complicator[dateOrder];
        if (comp && comp.id) {
          const parsedTime = new Date(`${dateOrder.replace(" ", "T")}:00Z`).getTime();
          streams.push({
            streamId: String(comp.id),
            date: dateOrder,
            timestamp: parsedTime,
            title: rawTitle,
            games: comp.games || [],
          });
        }
      }

      // If table row regex didn't extract enough, fall back directly to complicator keys
      if (streams.length === 0 && Object.keys(complicator).length > 0) {
        for (const [dateKey, comp] of Object.entries(complicator)) {
          if (comp && (comp as any).id) {
            const parsedTime = new Date(`${dateKey.replace(" ", "T")}:00Z`).getTime();
            streams.push({
              streamId: String((comp as any).id),
              date: dateKey,
              timestamp: parsedTime,
              title: "",
              games: (comp as any).games || [],
            });
          }
        }
      }

      reportUpstreamSuccess("twitchtracker");
      return streams;
    } catch (err: any) {
      reportUpstreamFailure("twitchtracker", err?.name === "AbortError" ? "timeout" : "network error");
      return fail();
    }
  });

  return result ?? [];
}

export interface MatchableStreamItem {
  title?: string;
  createdAt?: string;
  publishedAt?: string;
  startTime?: string;
  streamId?: string;
  id?: string;
}

/**
 * Matches a VOD or CDN recovered stream item to its corresponding TwitchTracker broadcast.
 */
export function matchTwitchTrackerStream(
  ttStreams: TwitchTrackerStream[],
  item: MatchableStreamItem
): TwitchTrackerStream | null {
  if (!ttStreams || !ttStreams.length) return null;

  // Direct streamId match if it already exists in TwitchTracker's stream database
  if (item.streamId) {
    const directMatch = ttStreams.find((s) => s.streamId === item.streamId);
    if (directMatch) return directMatch;
  }

  const hasTime = Boolean(item.createdAt || item.startTime || item.publishedAt);
  const itemTime = hasTime ? new Date(item.createdAt || item.startTime || item.publishedAt || 0).getTime() : 0;
  const rawTitle = item.title || "";
  const normTitle = normalizeTitle(rawTitle);

  let bestMatch: TwitchTrackerStream | null = null;
  let bestScore = Infinity;

  for (const s of ttStreams) {
    const diffMs = hasTime ? Math.abs(itemTime - s.timestamp) : 0;
    const diffHours = hasTime ? diffMs / (1000 * 60 * 60) : 0;
    const sim = s.title ? titleSimilarity(rawTitle, s.title) : 0;
    const normSTitle = normalizeTitle(s.title);

    if (hasTime) {
      if (diffHours <= 6) {
        // Exact title match within 6 hours
        if (normTitle && normSTitle && normTitle === normSTitle) {
          if (diffMs < bestScore) {
            bestScore = diffMs;
            bestMatch = s;
          }
        }
        // Substring match
        else if (sim >= 0.8 && diffHours <= 3) {
          const score = diffMs + 10000;
          if (score < bestScore) {
            bestScore = score;
            bestMatch = s;
          }
        }
        // High token similarity within 1 hour
        else if (sim >= 0.5 && diffHours <= 1) {
          const score = diffMs + 30000;
          if (score < bestScore) {
            bestScore = score;
            bestMatch = s;
          }
        }
        // Very close start time (< 8 minutes) with minimal similarity
        else if (diffHours <= 0.14 && (sim >= 0.3 || !s.title)) {
          const score = diffMs + 50000;
          if (score < bestScore) {
            bestScore = score;
            bestMatch = s;
          }
        }
      }
    } else {
      // No time provided - match purely on title similarity, preferring the most recent broadcast
      if (normTitle && normSTitle && normTitle === normSTitle) {
        const score = -s.timestamp;
        if (score < bestScore) {
          bestScore = score;
          bestMatch = s;
        }
      } else if (sim >= 0.7) {
        const score = (1 - sim) * 1_000_000_000_000 - s.timestamp;
        if (score < bestScore) {
          bestScore = score;
          bestMatch = s;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Resolves the true TwitchTracker stream ID for an item, returning null if unresolvable.
 */
export async function resolveStreamTrackerId(
  login: string,
  item: MatchableStreamItem
): Promise<string | null> {
  const streams = await getTwitchTrackerStreams(login);
  const match = matchTwitchTrackerStream(streams, item);
  return match ? match.streamId : null;
}
