import type { Client } from "@libsql/client";

/**
 * Persistent stale-while-revalidate snapshots of expensive upstream data (public data, shared by users).
 * A request is answered from SQLite immediately; when the snapshot is older than `freshMs` a refresh
 * runs in the background. A failed refresh never overwrites a good snapshot.
 */
export const VOD_SNAPSHOTS_DDL = `
  CREATE TABLE IF NOT EXISTS vod_snapshots (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )
`;

export interface SnapshotOptions {
  /** Younger than this: served as-is, no upstream call */
  freshMs: number;
  /** Older than this: treated as missing (the caller waits for a rebuild) */
  maxStaleMs: number;
  /** Injectable clock for tests */
  now?: () => number;
}

export interface SnapshotResult<T> {
  data: T;
  /** true when the snapshot was older than freshMs and a background refresh was started */
  stale: boolean;
  /** Resolves when the background refresh settles (never rejects); null when none was started */
  refreshing: Promise<void> | null;
  /** When the returned data was fetched from upstream (epoch ms) */
  fetchedAt: number;
}

// Shared across hot reloads so one key never has two concurrent rebuilds
const g = globalThis as { __vodSnapshotInflight?: Map<string, Promise<unknown>> };
const inflight = (g.__vodSnapshotInflight ??= new Map<string, Promise<unknown>>());

async function readSnapshot<T>(db: Client, key: string): Promise<{ data: T; fetchedAt: number } | null> {
  const res = await db.execute({
    sql: "SELECT payload, fetched_at FROM vod_snapshots WHERE key = ?",
    args: [key],
  });
  const row = res.rows[0];
  if (!row) return null;
  try {
    return { data: JSON.parse(String(row.payload)) as T, fetchedAt: Number(row.fetched_at) };
  } catch {
    return null; // corrupt payload: behave as if missing
  }
}

function rebuild<T>(
  db: Client,
  key: string,
  build: (previous: T | null) => Promise<T>,
  clock: () => number,
  previous: T | null
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const data = await build(previous);
      await db.execute({
        sql: `INSERT INTO vod_snapshots (key, payload, fetched_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
        args: [key, JSON.stringify(data), clock()],
      });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function getSnapshot<T>(
  db: Client,
  key: string,
  /** Receives the previous snapshot (or null) so a partial upstream outage can keep what was already known */
  build: (previous: T | null) => Promise<T>,
  options: SnapshotOptions
): Promise<SnapshotResult<T>> {
  const clock = options.now ?? Date.now;
  const snap = await readSnapshot<T>(db, key);
  const age = snap ? clock() - snap.fetchedAt : Infinity;

  if (snap && age <= options.freshMs) {
    return { data: snap.data, stale: false, refreshing: null, fetchedAt: snap.fetchedAt };
  }

  if (snap && age <= options.maxStaleMs) {
    // Serve the saved copy now; refresh behind it. Errors are swallowed: the old snapshot stays.
    const refreshing = rebuild(db, key, build, clock, snap.data).then(
      () => undefined,
      () => undefined
    );
    return { data: snap.data, stale: true, refreshing, fetchedAt: snap.fetchedAt };
  }

  // Nothing usable saved: the caller has to wait (and sees the error if the build fails)
  const data = await rebuild(db, key, build, clock, snap ? snap.data : null);
  return { data, stale: false, refreshing: null, fetchedAt: clock() };
}

/** Reads the saved copy without ever triggering a refresh (null when there is none). */
export async function peekSnapshot<T>(db: Client, key: string): Promise<{ data: T; fetchedAt: number } | null> {
  return readSnapshot<T>(db, key);
}

/** Drops snapshots nobody has read-through recently (e.g. creators that were unpinned). */
export async function pruneSnapshots(db: Client, olderThanMs: number, now = Date.now()): Promise<void> {
  await db.execute({ sql: "DELETE FROM vod_snapshots WHERE fetched_at < ?", args: [now - olderThanMs] });
}
