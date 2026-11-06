// Run with: npm test  (Node's built-in test runner; Node strips the TypeScript types on import)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { upsertWatchStatus } from "../lib/watch/upsert.ts";

async function freshDb() {
  const db = createClient({ url: ":memory:" });
  await db.execute(`
    CREATE TABLE watch_status (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, vod_id TEXT NOT NULL, stream_id TEXT,
      streamer_login TEXT NOT NULL, is_watched INTEGER DEFAULT 0, progress_seconds INTEGER DEFAULT 0,
      total_seconds INTEGER DEFAULT 0, last_watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, vod_id)
    )`);
  return db;
}

const base = { userId: "u1", vodId: "v1", streamerLogin: "streamer", totalSeconds: 100 };

test("explicit mark-watched is persisted and read back", async () => {
  const db = await freshDb();
  const saved = await upsertWatchStatus(db, { ...base, isWatched: 1, progressSeconds: 100, explicit: true });
  assert.deepEqual(saved, { isWatched: true, progressSeconds: 100 });
});

test("a late heartbeat does not un-watch a watched VOD or rewind its progress", async () => {
  const db = await freshDb();
  await upsertWatchStatus(db, { ...base, isWatched: 1, progressSeconds: 100, explicit: true });
  const saved = await upsertWatchStatus(db, { ...base, isWatched: 0, progressSeconds: 30, explicit: false });
  assert.deepEqual(saved, { isWatched: true, progressSeconds: 100 });
});

test("heartbeats advance progress on an unwatched VOD", async () => {
  const db = await freshDb();
  await upsertWatchStatus(db, { ...base, isWatched: 0, progressSeconds: 10, explicit: false });
  const saved = await upsertWatchStatus(db, { ...base, isWatched: 0, progressSeconds: 40, explicit: false });
  assert.deepEqual(saved, { isWatched: false, progressSeconds: 40 });
});

test("a heartbeat past 95% can mark the VOD watched", async () => {
  const db = await freshDb();
  const saved = await upsertWatchStatus(db, { ...base, isWatched: 1, progressSeconds: 96, explicit: false });
  assert.equal(saved.isWatched, true);
});

test("explicit un-watch overwrites a watched VOD (undo / mark unwatched)", async () => {
  const db = await freshDb();
  await upsertWatchStatus(db, { ...base, isWatched: 1, progressSeconds: 100, explicit: true });
  const saved = await upsertWatchStatus(db, { ...base, isWatched: 0, progressSeconds: 25, explicit: true });
  assert.deepEqual(saved, { isWatched: false, progressSeconds: 25 });
});

test("rows are scoped per user", async () => {
  const db = await freshDb();
  await upsertWatchStatus(db, { ...base, isWatched: 1, progressSeconds: 100, explicit: true });
  const other = await upsertWatchStatus(db, { ...base, userId: "u2", isWatched: 0, progressSeconds: 5, explicit: true });
  assert.deepEqual(other, { isWatched: false, progressSeconds: 5 });
});
