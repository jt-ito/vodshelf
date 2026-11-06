import { getDb } from "@/lib/db";
import type { TwitchVodItem } from "@/lib/twitch/gql";

export interface WatchStatusInfo {
  isWatched: boolean;
  progressSeconds: number;
  totalSeconds: number;
}

export interface VodWithWatchStatus extends TwitchVodItem {
  watchStatus: WatchStatusInfo;
  isNew?: boolean;
  inProgress?: boolean;
  isFavoriteCategory?: boolean;
}

/**
 * Merges watch status from SQLite scoped strictly to user.id using safe chunking.
 */
export async function getWatchStatusMapForUser(
  userId: string,
  vodIds: string[]
): Promise<Record<string, WatchStatusInfo>> {
  const watchMap: Record<string, WatchStatusInfo> = {};
  if (!userId || vodIds.length === 0) {
    return watchMap;
  }

  const db = getDb();
  const chunkSize = 100;

  for (let i = 0; i < vodIds.length; i += chunkSize) {
    const chunk = vodIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const watchRows = await db.execute({
      sql: `SELECT vod_id, is_watched, progress_seconds, total_seconds FROM watch_status WHERE user_id = ? AND vod_id IN (${placeholders})`,
      args: [userId, ...chunk],
    });

    for (const row of watchRows.rows) {
      watchMap[row.vod_id as string] = {
        isWatched: Boolean(row.is_watched),
        progressSeconds: (row.progress_seconds as number) || 0,
        totalSeconds: (row.total_seconds as number) || 0,
      };
    }
  }

  return watchMap;
}

/**
 * Attaches watch status to an array of Twitch VODs for a given user.
 */
export async function attachWatchStatusToVods(
  userId: string,
  videos: TwitchVodItem[]
): Promise<VodWithWatchStatus[]> {
  if (videos.length === 0) return [];
  const vodIds = videos.map((v) => v.id);
  const watchMap = await getWatchStatusMapForUser(userId, vodIds);

  return videos.map((v) => ({
    ...v,
    watchStatus: watchMap[v.id] || {
      isWatched: false,
      progressSeconds: 0,
      totalSeconds: v.lengthSeconds || 0,
    },
  }));
}
