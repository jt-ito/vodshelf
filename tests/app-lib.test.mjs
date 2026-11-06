import { db, request, mockFetch } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";
import { GET as health } from "@/app/api/health/route";
import { formatAgo, fetchOutageMessage } from "@/lib/twitch/outages";
import { FEED_CACHE_KEY, readFeedCache, writeFeedCache } from "@/lib/watch/feed-cache";
import { saveWatchStatus, saveBulkWatch, saveStreamerBulkWatch, SESSION_EXPIRED_EVENT } from "@/lib/watch/client";
import { getDb } from "@/lib/db";

const json = (res) => res.json();
let restore = () => {};
afterEach(() => restore());

// ------------------------------------------------------------------ errors
test("handleApiError never leaks internal error details", async () => {
  const res = handleApiError("test", new Error("SQLITE_CONSTRAINT: users.password_hash at /srv/app"), "Friendly message");
  assert.equal(res.status, 500);
  assert.deepEqual(await json(res), { error: "Friendly message" });
  assert.equal(JSON.stringify(await json(handleApiError("t", new Error("LEAK-ME")))).includes("LEAK-ME"), false); // default message too
  assert.equal(handleApiError("t", new Error("x"), "m", 502).status, 502);
});

test("rateLimitExceededResponse is a 429 with Retry-After", async () => {
  const res = rateLimitExceededResponse(12);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "12");
  assert.match((await json(res)).error, /12 seconds/);
});

// ------------------------------------------------------------------ logger
test("the logger redacts secrets and writes structured JSON", () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    logger.info("login", { password: "hunter2", currentPassword: "a", newPassword: "b", token: "t", secret: "s", cookie: "c", userId: "u1" });
  } finally {
    console.log = original;
  }
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "info");
  assert.equal(entry.message, "login");
  assert.equal(entry.meta.userId, "u1");
  for (const key of ["password", "currentPassword", "newPassword", "token", "secret", "cookie"]) {
    assert.equal(entry.meta[key], "[REDACTED]", key);
  }
  assert.equal(lines[0].includes("hunter2"), false);
});

test("logger.error records error name and message", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    logger.error("boom", new TypeError("bad thing"));
  } finally {
    console.error = original;
  }
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.meta.error.name, "TypeError");
  assert.equal(entry.meta.error.message, "bad thing");
});

// ------------------------------------------------------------------ database
test("the schema has every table and the uniqueness rules the app relies on", async () => {
  getDb();
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => r.name);
  for (const t of ["users", "pinned_streamers", "watch_status", "favorite_categories", "bookmarks", "vod_tags", "schema_migrations", "vod_snapshots"]) {
    assert.ok(tables.includes(t), t);
  }
  const indexes = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")).rows.map((r) => r.name);
  for (const i of ["idx_pinned_user", "idx_watch_user_vod", "idx_watch_user_streamer", "idx_fav_categories_user", "idx_bookmarks_user_vod", "idx_vod_tags_user"]) {
    assert.ok(indexes.includes(i), i);
  }

  await db.execute("INSERT INTO users (id, username, password_hash) VALUES ('uq1', 'uq_user', 'h')");
  await assert.rejects(db.execute("INSERT INTO users (id, username, password_hash) VALUES ('uq2', 'uq_user', 'h')")); // unique username
  await db.execute("INSERT INTO watch_status (id, user_id, vod_id, streamer_login) VALUES ('a', 'uq1', '1', 'x')");
  await assert.rejects(db.execute("INSERT INTO watch_status (id, user_id, vod_id, streamer_login) VALUES ('b', 'uq1', '1', 'x')"));
  await db.execute("INSERT INTO pinned_streamers (id, user_id, streamer_login) VALUES ('p1', 'uq1', 'x')");
  await assert.rejects(db.execute("INSERT INTO pinned_streamers (id, user_id, streamer_login) VALUES ('p2', 'uq1', 'x')"));
});

test("new users get safe defaults", async () => {
  await db.execute("INSERT INTO users (id, username, password_hash) VALUES ('def1', 'defaults_user', 'h')");
  const row = (await db.execute("SELECT * FROM users WHERE id = 'def1'")).rows[0];
  assert.deepEqual(
    [row.token_version, row.feed_filter, row.date_format, row.mark_watched_on_open_link, row.mark_watched_on_play, row.mark_all_watched_scope],
    [1, "all", "relative", 0, 0, "loaded"]
  );
});

// ------------------------------------------------------------------ health
test("health reports ok while the database answers", async () => {
  const res = await health(request("/api/health"));
  assert.equal(res.status, 200);
  const data = await json(res);
  assert.equal(data.status, "ok");
  assert.ok(data.uptimeSeconds >= 0);
});

// ------------------------------------------------------------------ outages (client helpers)
test("formatAgo buckets elapsed time", () => {
  const now = 1_000_000_000_000;
  assert.equal(formatAgo(now - 10_000, now), "just now");
  assert.equal(formatAgo(now - 5 * 60_000, now), "5 min ago");
  assert.equal(formatAgo(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(formatAgo(now - 49 * 3600_000, now), "2 d ago");
  assert.equal(formatAgo(now + 5000, now), "just now"); // clock skew
});

test("fetchOutageMessage returns the most serious outage's message, or null", async () => {
  const outage = (name, state, message) => ({ name, state, message });
  restore = mockFetch(() => ({ outages: [outage("vodvod", "degraded", "VODVOD is flaky"), outage("twitch", "down", "Twitch is down")] }));
  assert.equal(await fetchOutageMessage(), "Twitch is down");
  restore();
  restore = mockFetch(() => ({ outages: [] }));
  assert.equal(await fetchOutageMessage(), null);
  restore();
  restore = mockFetch(() => new Response("no", { status: 500 }));
  assert.equal(await fetchOutageMessage(), null);
  restore();
  restore = mockFetch(() => { throw new Error("offline"); });
  assert.equal(await fetchOutageMessage(), null);
});

// ------------------------------------------------------------------ feed cache + browser helpers
const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = new EventTarget();
});

test("the feed cache round-trips and expires after a day", () => {
  assert.equal(readFeedCache(), null);
  writeFeedCache([{ id: "1" }], ["Dota 2"]);
  const cached = readFeedCache();
  assert.deepEqual([cached.videos, cached.favoriteCategories], [[{ id: "1" }], ["Dota 2"]]);

  const stored = JSON.parse(store.get(FEED_CACHE_KEY));
  stored.savedAt = Date.now() - 25 * 3600_000;
  store.set(FEED_CACHE_KEY, JSON.stringify(stored));
  assert.equal(readFeedCache(), null);
});

test("the feed cache tolerates corrupt data and unavailable or full storage", () => {
  store.set(FEED_CACHE_KEY, "{broken");
  assert.equal(readFeedCache(), null);
  store.set(FEED_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), videos: "not an array" }));
  assert.equal(readFeedCache(), null);
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.doesNotThrow(() => writeFeedCache([{ id: "1" }], []));
});

// ------------------------------------------------------------------ watch client helpers
const payload = { vodId: "1", streamerLogin: "xqc", isWatched: true, progressSeconds: 10, totalSeconds: 10 };
const ok = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("saveWatchStatus succeeds only when the server confirms the requested state", async () => {
  restore = mockFetch(() => ok({ isWatched: true }));
  assert.equal(await saveWatchStatus(payload), null);
  const { init } = restore.calls[0];
  assert.equal(init.method, "POST");
  assert.equal(init.keepalive, true);
  assert.deepEqual(JSON.parse(init.body), payload);
  restore();

  restore = mockFetch(() => ok({ isWatched: false })); // server says it did not stick
  assert.match(await saveWatchStatus(payload), /not saved/);
});

test("saveWatchStatus surfaces server errors, and signals an expired session on 401", async () => {
  restore = mockFetch(() => ok({ error: "Too many requests" }, 429));
  assert.equal(await saveWatchStatus(payload), "Too many requests");
  restore();

  let expired = 0;
  window.addEventListener(SESSION_EXPIRED_EVENT, () => expired++);
  restore = mockFetch(() => ok({ error: "Unauthorized" }, 401));
  assert.match(await saveWatchStatus(payload), /Session expired/);
  assert.equal(expired, 1);
  restore();

  restore = mockFetch(() => new Response("<html>oops</html>", { status: 500 }));
  assert.equal(await saveWatchStatus(payload), "Failed to update watch status"); // non-JSON error body
});

test("saveWatchStatus retries once after a network failure (a tab waking from sleep)", async () => {
  let attempts = 0;
  restore = mockFetch(() => {
    if (++attempts === 1) throw new TypeError("Failed to fetch");
    return ok({ isWatched: true });
  });
  assert.equal(await saveWatchStatus(payload), null);
  assert.equal(attempts, 2);
});

test("saveWatchStatus gives up after the retry also fails", async () => {
  restore = mockFetch(() => { throw new TypeError("Failed to fetch"); });
  assert.equal(await saveWatchStatus(payload), "Failed to update watch status");
  assert.equal(restore.calls.length, 2);
});

test("saveBulkWatch verifies the confirmed count and state", async () => {
  const items = [{ vodId: "1", streamerLogin: "xqc", totalSeconds: 5 }];
  restore = mockFetch(() => ok({ isWatched: true, updatedCount: 1 }));
  assert.equal(await saveBulkWatch(items), null);
  assert.deepEqual(JSON.parse(restore.calls[0].init.body), { items, isWatched: true });
  restore();
  restore = mockFetch(() => ok({ isWatched: true, updatedCount: 0 }));
  assert.match(await saveBulkWatch(items), /not saved/);
  restore();
  restore = mockFetch(() => ok({ isWatched: true, updatedCount: 1 }));
  assert.match(await saveBulkWatch(items, false), /not saved/); // asked for un-watch, server reports watched
});

test("saveStreamerBulkWatch returns the server's count and includes the cutoff only when given", async () => {
  restore = mockFetch(() => ok({ isWatched: true, updatedCount: 42 }));
  assert.deepEqual(await saveStreamerBulkWatch("xqc"), { error: null, updatedCount: 42 });
  assert.deepEqual(JSON.parse(restore.calls[0].init.body), { streamerLogin: "xqc", allStreamerVods: true, isWatched: true });
  await saveStreamerBulkWatch("xqc", "2026-01-01T00:00:00.000Z");
  assert.equal(JSON.parse(restore.calls[1].init.body).before, "2026-01-01T00:00:00.000Z");
  restore();
  restore = mockFetch(() => ok({ isWatched: true })); // no count at all
  assert.match((await saveStreamerBulkWatch("xqc")).error, /not saved/);
  restore();
  restore = mockFetch(() => ok({ error: "Failed to bulk update watch status" }, 500));
  assert.deepEqual(await saveStreamerBulkWatch("xqc"), { error: "Failed to bulk update watch status", updatedCount: 0 });
});
