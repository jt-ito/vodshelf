import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";

export interface WatchUpsert {
  userId: string;
  vodId: string;
  streamId?: string | null;
  streamerLogin: string;
  isWatched: 0 | 1;
  progressSeconds: number;
  totalSeconds: number;
  /** true for explicit toggles (overwrite); false for player heartbeats (may only raise is_watched) */
  explicit: boolean;
}

export interface SavedWatch {
  isWatched: boolean;
  progressSeconds: number;
}

/**
 * Upserts a watch_status row scoped to userId and returns what was actually persisted.
 * Explicit toggles overwrite; implicit heartbeats never un-watch or rewind a watched VOD.
 */
export async function upsertWatchStatus(db: Client, w: WatchUpsert): Promise<SavedWatch> {
  const explicit = w.explicit ? 1 : 0;

  await db.execute({
    sql: `INSERT INTO watch_status (id, user_id, vod_id, stream_id, streamer_login, is_watched, progress_seconds, total_seconds, last_watched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, vod_id) DO UPDATE SET
            progress_seconds = CASE WHEN ? = 1 OR is_watched = 0 THEN excluded.progress_seconds ELSE progress_seconds END,
            total_seconds = COALESCE(excluded.total_seconds, total_seconds),
            is_watched = CASE WHEN ? = 1 THEN excluded.is_watched ELSE MAX(is_watched, excluded.is_watched) END,
            last_watched_at = CURRENT_TIMESTAMP`,
    args: [
      randomUUID(),
      w.userId,
      w.vodId,
      w.streamId ?? null,
      w.streamerLogin,
      w.isWatched,
      w.progressSeconds,
      w.totalSeconds,
      explicit,
      explicit,
    ],
  });

  const saved = await db.execute({
    sql: "SELECT is_watched, progress_seconds FROM watch_status WHERE user_id = ? AND vod_id = ?",
    args: [w.userId, w.vodId],
  });
  return {
    isWatched: Boolean(saved.rows[0]?.is_watched),
    progressSeconds: Number(saved.rows[0]?.progress_seconds ?? w.progressSeconds),
  };
}
