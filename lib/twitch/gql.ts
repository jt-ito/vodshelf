import { serverCache } from "@/lib/cache/ttl-cache";
import { isCircuitOpen, reportUpstreamFailure, reportUpstreamSuccess } from "@/lib/twitch/upstream-health";

const GQL_URL = "https://gql.twitch.tv/gql";
export const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || "kimne78kx3ncx6brgo4mv6wki5h1ko";
export const TWITCH_DESKTOP_CLIENT_ID = process.env.TWITCH_DESKTOP_CLIENT_ID || "ue6666qo983tsx6so1t0vnawi233wa";
export const FILTERABLE_TOWER_HASH = process.env.FILTERABLE_TOWER_HASH || "67004f7881e65c297936f32c75246470629557a393788fb5a69d6d9a25a8fd5f";

export interface TwitchChannelMeta {
  id: string;
  login: string;
  displayName: string;
  profileImageURL: string;
  bannerImageURL?: string;
  description: string;
  followers: number;
  isLive: boolean;
  streamTitle?: string;
  gameName?: string;
}

export interface TwitchVodItem {
  id: string;
  title: string;
  broadcastType: string;
  createdAt: string;
  publishedAt?: string;
  lengthSeconds: number;
  viewCount: number;
  previewThumbnailURL: string;
  animatedPreviewURL?: string;
  seekPreviewsURL?: string;
  streamId?: string;
  isUnlisted?: boolean;
  isLive?: boolean;
  isStreamerLive?: boolean;
  watchStatus?: {
    isWatched: boolean;
    progressSeconds: number;
    totalSeconds: number;
    isNew?: boolean;
    inProgress?: boolean;
    lastWatchedAt?: string;
    [key: string]: any;
  };
  game?: {
    id: string;
    name: string;
    boxArtURL?: string;
  };
  owner: {
    id: string;
    login: string;
    displayName: string;
    profileImageURL?: string;
  };
}

export interface VodPageResponse {
  videos: TwitchVodItem[];
  cursor: string | null;
  hasNextPage: boolean;
  totalCount?: number;
}

export async function twitchGqlFetch<T>(
  query: string | null,
  variables: Record<string, any> = {},
  options: {
    clientId?: string;
    persistedQuery?: {
      version: number;
      sha256Hash: string;
    };
    operationName?: string;
  } = {}
): Promise<T> {
  const body: Record<string, any> = { variables };
  if (query) body.query = query;
  if (options.operationName) body.operationName = options.operationName;
  if (options.persistedQuery) {
    body.extensions = {
      persistedQuery: options.persistedQuery,
    };
  }

  // After repeated failures stop hammering Twitch for a minute; callers fall back to saved data
  if (isCircuitOpen("twitch")) {
    throw new Error("Twitch is currently unreachable");
  }

  let res: Response;
  try {
    res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": options.clientId || TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    reportUpstreamFailure("twitch", err?.name === "TimeoutError" ? "timeout" : "network error");
    throw err;
  }

  // 5xx and rate limiting mean Twitch is struggling; other 4xx mean it answered (our request was wrong)
  if (res.status >= 500 || res.status === 429) {
    reportUpstreamFailure("twitch", `HTTP ${res.status}`);
    throw new Error(`Twitch GQL HTTP ${res.status}: ${res.statusText}`);
  }
  reportUpstreamSuccess("twitch");

  if (!res.ok) {
    throw new Error(`Twitch GQL HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message || "Twitch GQL error");
  }

  return json.data as T;
}

/**
 * Builds local category thumbnail URL preserving Twitch's exact slug (including _IGDB suffix)
 * with a high-res customUrl fallback parameter.
 */
export function buildCategoryThumbnailUrl(rawBoxArtUrl?: string, gameId?: string | number): string | undefined {
  if (!rawBoxArtUrl && !gameId) return undefined;

  let slug = "";
  if (rawBoxArtUrl) {
    const match = rawBoxArtUrl.match(/ttv-boxart\/([a-zA-Z0-9_-]+?)(?:-\d+x\d+|-\{width\}x\{height\}|\.(?:jpg|png|jpeg))/i);
    if (match && match[1]) {
      slug = match[1];
    }
  }

  if (!slug && gameId) {
    slug = String(gameId).replace(/[^a-zA-Z0-9_]/g, "");
  }

  if (!slug) return undefined;

  if (rawBoxArtUrl && rawBoxArtUrl.startsWith("http")) {
    const highRes = rawBoxArtUrl
      .replace(/-\d+x\d+\.(jpg|png|jpeg)/i, "-285x380.$1")
      .replace(/\{width\}x\{height\}/i, "285x380");
    return `/api/categories/thumbnail/${slug}?url=${encodeURIComponent(highRes)}`;
  }

  return `/api/categories/thumbnail/${slug}`;
}

/**
 * Resolves streamer profile, avatar, bio, follower count, and current live status.
 */
export async function getChannelMeta(login: string): Promise<TwitchChannelMeta | null> {
  const cleanLogin = login.toLowerCase().trim();
  return serverCache.fetchOrGet(`gql:meta:${cleanLogin}`, 300_000, async () => {
    const query = `
      query GetChannelMeta($login: String!) {
        user(login: $login) {
          id
          login
          displayName
          profileImageURL(width: 300)
          bannerImageURL
          description
          followers {
            totalCount
          }
          stream {
            id
            title
            type
            game {
              name
            }
          }
        }
      }
    `;

    try {
      const data = await twitchGqlFetch<{ user: any }>(query, { login: cleanLogin });
      if (!data.user) return null;

      const u = data.user;
      return {
        id: u.id,
        login: u.login,
        displayName: u.displayName,
        profileImageURL: u.profileImageURL || "https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb9c-91fbe85943c7-profile_image-300x300.png",
        bannerImageURL: u.bannerImageURL,
        description: u.description || "",
        followers: u.followers?.totalCount || 0,
        isLive: !!u.stream,
        streamTitle: u.stream?.title,
        gameName: u.stream?.game?.name,
      };
    } catch (err) {
      console.error(`Error resolving channel meta for ${cleanLogin}:`, err);
      return null;
    }
  });
}

export interface LiveStreamStatus {
  isLive: boolean;
  streamId?: string;
  title?: string;
  gameName?: string;
}

/**
 * Batch queries Twitch GQL for live stream status of multiple channels.
 */
export async function getLiveStreams(
  logins: string[]
): Promise<Record<string, LiveStreamStatus>> {
  const cleanLogins = Array.from(
    new Set(logins.map((l) => l.toLowerCase().trim()).filter(Boolean))
  );
  if (cleanLogins.length === 0) return {};

  const query = `
    query BatchCheckLive($logins: [String!]) {
      users(logins: $logins) {
        login
        stream {
          id
          title
          type
          game {
            name
          }
        }
      }
    }
  `;

  try {
    // 30s TTL + in-flight coalescing: the sidebar poll and feed load share one upstream call.
    // Errors throw out of fetchOrGet so failures are never cached.
    return await serverCache.fetchOrGet(`gql:live:${[...cleanLogins].sort().join(",")}`, 30_000, async () => {
    const data = await twitchGqlFetch<{ users: any[] }>(query, { logins: cleanLogins });
    const result: Record<string, LiveStreamStatus> = {};

    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (!u || !u.login) continue;
        const loginLower = u.login.toLowerCase();
        if (u.stream) {
          result[loginLower] = {
            isLive: true,
            streamId: u.stream.id,
            title: u.stream.title,
            gameName: u.stream.game?.name,
          };
        } else {
          result[loginLower] = {
            isLive: false,
          };
        }
      }
    }

    return result;
    });
  } catch (err) {
    console.error("Error fetching live streams batch:", err);
    return {};
  }
}

/**
 * Searches channel logins and display names for autocomplete suggestions.
 */
export async function searchChannels(queryText: string): Promise<Array<{ login: string; displayName: string; avatar: string }>> {
  if (!queryText || queryText.trim().length < 2) return [];
  const cleanQuery = queryText.toLowerCase().trim();

  // Failures return null so they are never cached: a Twitch hiccup must not blank search for 10 minutes
  const results = await serverCache.fetchOrGet<Array<{ login: string; displayName: string; avatar: string }> | null>(`gql:search:${cleanQuery}`, 600_000, async () => {
    const query = `
      query SearchChannels($query: String!) {
        searchFor(userQuery: $query, platform: "web") {
          channels {
            items {
              id
              login
              displayName
              profileImageURL(width: 70)
            }
          }
        }
      }
    `;

    try {
      const data = await twitchGqlFetch<{ searchFor: any }>(query, { query: cleanQuery });
      const items = data.searchFor?.channels?.items || [];
      return items.slice(0, 8).map((c: any) => ({
        login: c.login,
        displayName: c.displayName,
        avatar: c.profileImageURL,
      }));
    } catch (err) {
      console.error("Error searching channels:", err);
      return null;
    }
  });
  return results ?? [];
}

/**
 * Fetches paginated VODs for a streamer via GQL, bypassing standard restrictions.
 */
export async function getChannelVods(
  login: string,
  options: {
    first?: number;
    after?: string | null;
    broadcastType?: "ARCHIVE" | "HIGHLIGHT" | "UPLOAD" | null;
  } = {}
): Promise<VodPageResponse> {
  const { first = 30, after = null, broadcastType = null } = options;
  const cleanLogin = login.toLowerCase().trim();
  const cacheKey = `gql:vods:${cleanLogin}:${first}:${after || "head"}:${broadcastType || "ALL"}`;

  return serverCache.fetchOrGet(cacheKey, 120_000, async () => {
    try {
      // Primary: Use FilterableVideoTower_Videos persisted query with public desktop client
      // to bypass Twitch server-side bot mitigation (IntegrityCheckFailed on cursor pagination).
      const towerData = await twitchGqlFetch<{ user: any }>(
        null,
        {
          channelOwnerLogin: cleanLogin,
          limit: Math.min(first, 100),
          cursor: after || null,
          broadcastType: broadcastType || null,
          videoSort: "TIME",
        },
        {
          clientId: TWITCH_DESKTOP_CLIENT_ID,
          operationName: "FilterableVideoTower_Videos",
          persistedQuery: {
            version: 1,
            sha256Hash: FILTERABLE_TOWER_HASH,
          },
        }
      );

      if (towerData?.user?.videos) {
        const vData = towerData.user.videos;
        const edges = vData.edges || [];
        const videos: TwitchVodItem[] = edges.map((e: any) => {
          const node = e.node;
          return {
            id: node.id,
            title: node.title,
            broadcastType: node.broadcastType || broadcastType || "ARCHIVE",
            createdAt: node.createdAt || node.publishedAt || new Date().toISOString(),
            publishedAt: node.publishedAt,
            lengthSeconds: node.lengthSeconds || 0,
            viewCount: node.viewCount || 0,
            previewThumbnailURL: node.previewThumbnailURL || "",
            animatedPreviewURL: node.animatedPreviewURL,
            seekPreviewsURL: node.seekPreviewsURL,
            game: node.game
              ? {
                  id: node.game.id,
                  name: node.game.displayName || node.game.name,
                  boxArtURL: buildCategoryThumbnailUrl(node.game.boxArtURL, node.game.id),
                }
              : undefined,
            owner: {
              id: node.owner?.id || towerData.user.id || "",
              login: node.owner?.login || cleanLogin,
              displayName: node.owner?.displayName || cleanLogin,
              profileImageURL: node.owner?.profileImageURL,
            },
          };
        });

        const lastCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

        return {
          videos,
          cursor: lastCursor,
          hasNextPage: Boolean(vData.pageInfo?.hasNextPage),
        };
      }
    } catch (err: any) {
      // If persisted tower fails on cursor pagination, rethrow so caller handles it
      if (after) {
        throw err;
      }
      console.warn(`FilterableVideoTower query failed for ${cleanLogin}, attempting fallback:`, err.message);
    }

    // Fallback query for initial page loads
    const query = `
      query GetChannelVideos($login: String!, $first: Int, $after: Cursor, $types: [BroadcastType!]) {
        user(login: $login) {
          videos(first: $first, after: $after, types: $types, sort: TIME) {
            totalCount
            pageInfo {
              hasNextPage
            }
            edges {
              cursor
              node {
                id
                title
                broadcastType
                createdAt
                publishedAt
                lengthSeconds
                viewCount
                previewThumbnailURL(width: 640, height: 360)
                seekPreviewsURL
                game {
                  id
                  name
                  boxArtURL(width: 140, height: 190)
                }
                owner {
                  id
                  login
                  displayName
                  profileImageURL(width: 70)
                }
              }
            }
          }
        }
      }
    `;

    const types = broadcastType ? [broadcastType] : ["ARCHIVE", "HIGHLIGHT", "UPLOAD"];

    const data = await twitchGqlFetch<{ user: any }>(query, {
      login: cleanLogin,
      first: Math.min(first, 100),
      after,
      types,
    });

    if (!data.user || !data.user.videos) {
      return { videos: [], cursor: null, hasNextPage: false, totalCount: 0 };
    }

    const vData = data.user.videos;
    const edges = vData.edges || [];
    const videos: TwitchVodItem[] = edges.map((e: any) => {
      const node = e.node;
      if (node && node.game) {
        node.game.boxArtURL = buildCategoryThumbnailUrl(node.game.boxArtURL, node.game.id);
      }
      return node;
    });
    const lastCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

    return {
      videos,
      cursor: lastCursor,
      hasNextPage: Boolean(vData.pageInfo?.hasNextPage),
      totalCount: vData.totalCount,
    };
  });
}

/**
 * Fetches all available VODs for a streamer (up to maxLimit, default 1000)
 * using sequential 100-item requests, cached in server memory for 3 minutes.
 */
export async function getAllChannelVods(
  login: string,
  options: {
    broadcastType?: "ARCHIVE" | "HIGHLIGHT" | "UPLOAD" | null;
    maxLimit?: number;
  } = {}
): Promise<TwitchVodItem[]> {
  const { broadcastType = null, maxLimit = 1000 } = options;
  const cleanLogin = login.toLowerCase().trim();
  const cacheKey = `gql:allvods:${cleanLogin}:${broadcastType || "ALL"}`;

  return serverCache.fetchOrGet(cacheKey, 180_000, async () => {
    const allVideos: TwitchVodItem[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    let page = 0;
    const maxPages = Math.ceil(maxLimit / 100);

    while (hasNextPage && page < maxPages) {
      page++;
      // A failed page throws (and is therefore never cached): returning a partial catalogue would make
      // "mark all as watched" and full-catalogue search silently incomplete.
      const pageRes = await getChannelVods(cleanLogin, {
        first: 100,
        after: cursor,
        broadcastType,
      });

      if (!pageRes.videos || pageRes.videos.length === 0) {
        break;
      }

      allVideos.push(...pageRes.videos);
      cursor = pageRes.cursor;
      hasNextPage = Boolean(pageRes.hasNextPage && cursor);
    }

    return allVideos;
  });
}

/**
 * Searches across all channel VODs by matching tokens against title and game/category name.
 */
export async function searchChannelVods(
  login: string,
  query: string,
  options: {
    broadcastType?: "ARCHIVE" | "HIGHLIGHT" | "UPLOAD" | null;
  } = {}
): Promise<{ videos: TwitchVodItem[]; totalSearched: number }> {
  const cleanQuery = query.toLowerCase().trim();
  const allVideos = await getAllChannelVods(login, options);

  if (!cleanQuery) {
    return { videos: allVideos, totalSearched: allVideos.length };
  }

  // Tokenize search query words
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  const matched = allVideos.filter((video) => {
    const titleLower = (video.title || "").toLowerCase();
    const gameLower = (video.game?.name || "").toLowerCase();
    const searchableText = `${titleLower} ${gameLower}`;

    // Every token must appear in the video's title or game
    return tokens.every((token) => searchableText.includes(token));
  });

  return {
    videos: matched,
    totalSearched: allVideos.length,
  };
}

/**
 * Fetches VOD metadata including seekPreviewsURL (used to bypass sub-only restriction).
 */
export async function getSubOnlyVodMeta(vodId: string): Promise<TwitchVodItem | null> {
  const cleanId = vodId.trim();
  return serverCache.fetchOrGet(`gql:vodmeta:${cleanId}`, 1800_000, async () => {
    const query = `
      query GetSubOnlyVod($id: ID!) {
        video(id: $id) {
          id
          title
          createdAt
          publishedAt
          lengthSeconds
          viewCount
          broadcastType
          seekPreviewsURL
          previewThumbnailURL(width: 640, height: 360)
          game {
            id
            name
            boxArtURL(width: 140, height: 190)
          }
          owner {
            id
            login
            displayName
            profileImageURL(width: 70)
          }
        }
      }
    `;

    try {
      const data = await twitchGqlFetch<{ video: any }>(query, { id: cleanId });
      if (!data.video) return null;
      if (data.video.game) {
        data.video.game.boxArtURL = buildCategoryThumbnailUrl(data.video.game.boxArtURL, data.video.game.id);
      }
      return data.video as TwitchVodItem;
    } catch (err) {
      console.error(`Error querying video ${cleanId}:`, err);
      return null;
    }
  });
}
