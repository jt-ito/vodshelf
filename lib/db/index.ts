import { createClient, type Client } from "@libsql/client";
import path from "path";
import { VOD_SNAPSHOTS_DDL, pruneSnapshots } from "@/lib/twitch/vod-snapshots";

let dbInstance: Client | null = null;
let dbReady: Promise<void> | null = null;

export function getDb(): Client {
  if (!dbInstance) {
    const dbPath = path.join(process.cwd(), "archive.db");
    dbInstance = createClient({
      // ARCHIVE_DB_URL lets tests use an in-memory database; production uses archive.db
      url: process.env.ARCHIVE_DB_URL || `file:${dbPath}`,
    });
    dbReady = initDb(dbInstance);
    dbReady.catch((err) => {
      console.error("Database initialization failed:", err);
    });
    scheduleWalCheckpoint(dbInstance);
  }
  return dbInstance;
}

/** Resolves once the schema exists. Request handlers don't need it (tables appear within milliseconds of startup); tests do. */
export async function ensureDbReady(): Promise<Client> {
  const client = getDb();
  await dbReady;
  return client;
}

const CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Periodically folds the WAL back into the main database file so it can't grow unbounded
 * on a long-running server. Stored on globalThis so dev hot-reloads don't stack timers.
 */
function scheduleWalCheckpoint(client: Client) {
  const g = globalThis as { __walCheckpointTimer?: ReturnType<typeof setInterval> };
  if (g.__walCheckpointTimer) clearInterval(g.__walCheckpointTimer);
  g.__walCheckpointTimer = setInterval(() => {
    client.execute("PRAGMA wal_checkpoint(TRUNCATE);").catch((err) => {
      console.warn("WAL checkpoint failed:", err?.message ?? err);
    });
  }, CHECKPOINT_INTERVAL_MS);
  // Never keep the process alive just for housekeeping
  g.__walCheckpointTimer.unref?.();
}

type Migration = { version: number; name: string; up: (c: Client) => Promise<void> };

/** Adds a column only if it is missing; any other failure propagates instead of being swallowed. */
async function addColumn(c: Client, table: string, column: string, ddl: string) {
  const info = await c.execute(`PRAGMA table_info(${table});`);
  if (info.rows.some((r) => r.name === column)) return;
  await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
}

// Append-only: never edit or reorder a shipped migration, add a new version instead.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline_tables",
    up: async (c) => {
      await c.execute(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        username_changed_at DATETIME,
        token_version INTEGER DEFAULT 1,
        feed_filter TEXT DEFAULT 'all',
        date_format TEXT DEFAULT 'relative',
        mark_watched_on_open_link INTEGER DEFAULT 0,
        mark_watched_on_play INTEGER DEFAULT 0,
        mark_all_watched_scope TEXT DEFAULT 'loaded'
      );
      `);
      await c.execute(`
    CREATE TABLE IF NOT EXISTS pinned_streamers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        streamer_display_name TEXT,
        streamer_avatar_url TEXT,
        pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        group_name TEXT DEFAULT 'General',
        is_hidden INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(user_id, streamer_login)
      );
      `);
      await c.execute(`
    CREATE TABLE IF NOT EXISTS watch_status (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        vod_id TEXT NOT NULL,
        stream_id TEXT,
        streamer_login TEXT NOT NULL,
        is_watched INTEGER DEFAULT 0,
        progress_seconds INTEGER DEFAULT 0,
        total_seconds INTEGER DEFAULT 0,
        last_watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, vod_id)
      );
      `);
      await c.execute(`
    CREATE TABLE IF NOT EXISTS favorite_categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category_name TEXT NOT NULL,
        box_art_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category_name)
      );
      `);
      await c.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        vod_id TEXT NOT NULL,
        streamer_login TEXT,
        timestamp_seconds INTEGER NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      `);
      await c.execute(`
    CREATE TABLE IF NOT EXISTS vod_tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        vod_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, vod_id, tag)
      );
      `);
    },
  },
  {
    version: 2,
    name: "legacy_columns",
    up: async (c) => {
      await addColumn(c, "users", "username_changed_at", "DATETIME");
      await addColumn(c, "users", "token_version", "INTEGER DEFAULT 1");
      await c.execute("UPDATE users SET token_version = 1 WHERE token_version IS NULL;");
      await addColumn(c, "users", "feed_filter", "TEXT DEFAULT 'all'");
      await addColumn(c, "users", "date_format", "TEXT DEFAULT 'relative'");
      await addColumn(c, "users", "mark_watched_on_open_link", "INTEGER DEFAULT 0");
      await addColumn(c, "users", "mark_watched_on_play", "INTEGER DEFAULT 0");
      await addColumn(c, "users", "mark_all_watched_scope", "TEXT DEFAULT 'loaded'");
      await addColumn(c, "pinned_streamers", "group_name", "TEXT DEFAULT 'General'");
      await addColumn(c, "pinned_streamers", "is_hidden", "INTEGER DEFAULT 0");
      await addColumn(c, "pinned_streamers", "sort_order", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 3,
    name: "snapshots_and_indexes",
    up: async (c) => {
      await c.execute(VOD_SNAPSHOTS_DDL);
      await c.execute("CREATE INDEX IF NOT EXISTS idx_pinned_user ON pinned_streamers(user_id);");
      await c.execute("CREATE INDEX IF NOT EXISTS idx_watch_user_vod ON watch_status(user_id, vod_id);");
      await c.execute("CREATE INDEX IF NOT EXISTS idx_watch_user_streamer ON watch_status(user_id, streamer_login);");
      await c.execute("CREATE INDEX IF NOT EXISTS idx_fav_categories_user ON favorite_categories(user_id);");
      await c.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_user_vod ON bookmarks(user_id, vod_id);");
      await c.execute("CREATE INDEX IF NOT EXISTS idx_vod_tags_user ON vod_tags(user_id, vod_id);");
    },
  },
];

async function initDb(client: Client) {
  await client.execute("PRAGMA foreign_keys = ON;");
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const done = new Set(
    (await client.execute("SELECT version FROM schema_migrations")).rows.map((r) => Number(r.version))
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await m.up(client);
    await client.execute({ sql: "INSERT INTO schema_migrations (version, name) VALUES (?, ?)", args: [m.version, m.name] });
  }

  // Drop snapshots for creators nobody has pinned in a month so the table stays bounded
  await pruneSnapshots(client, 30 * 24 * 60 * 60 * 1000).catch(() => {});
}
