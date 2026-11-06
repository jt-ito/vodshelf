import { db, request, createUser, count } from "./helpers/app.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as getProgress, POST as postProgress } from "@/app/api/watch/progress/route";
import { POST as postBulk } from "@/app/api/watch/bulk/route";
import { getWatchStatusMapForUser, attachWatchStatusToVods } from "@/lib/watch/merge";

const json = (res) => res.json();
const progress = (cookie, body, opts) => postProgress(request("/api/watch/progress", { method: "POST", body, cookie, ...opts }));
const bulk = (cookie, body, opts) => postBulk(request("/api/watch/bulk", { method: "POST", body, cookie, ...opts }));
const row = async (userId, vodId) =>
  (await db.execute({ sql: "SELECT * FROM watch_status WHERE user_id = ? AND vod_id = ?", args: [userId, vodId] })).rows[0];

// ------------------------------------------------------------ POST /api/watch/progress
test("progress POST requires a session and valid ids", async () => {
  assert.equal((await progress(undefined, { vodId: "1", streamerLogin: "xqc", isWatched: true })).status, 401);
  const u = await createUser();
  assert.equal((await progress(u.cookie, { streamerLogin: "xqc", isWatched: true })).status, 400); // no vod
  assert.equal((await progress(u.cookie, { vodId: "abc", streamerLogin: "xqc" })).status, 400); // vod has no digits
  assert.equal((await progress(u.cookie, { vodId: "1" })).status, 400); // no streamer and none stored
  assert.equal((await progress(u.cookie, { vodId: "1", streamerLogin: "bad login" })).status, 400);
});

test("an explicit toggle is stored and the response reports what was persisted", async () => {
  const u = await createUser();
  const res = await progress(u.cookie, { vodId: "100", streamerLogin: "XQC", isWatched: true, progressSeconds: 3600, totalSeconds: 3600 });
  assert.deepEqual(await json(res), { message: "Watch progress saved", vodId: "100", progressSeconds: 3600, isWatched: true });
  const r = await row(u.id, "100");
  assert.equal(r.streamer_login, "xqc");
  assert.equal(r.is_watched, 1);
  assert.equal(r.total_seconds, 3600);
});

test("a player heartbeat advances progress but can never un-watch or rewind a watched VOD", async () => {
  const u = await createUser();
  await progress(u.cookie, { vodId: "200", streamerLogin: "xqc", isWatched: true, progressSeconds: 1000, totalSeconds: 1000 });
  const beat = await json(await progress(u.cookie, { vodId: "200", streamerLogin: "xqc", progressSeconds: 50, totalSeconds: 1000 }));
  assert.equal(beat.isWatched, true);
  assert.equal(beat.progressSeconds, 1000);
});

test("heartbeats mark a VOD watched once 95% is reached", async () => {
  const u = await createUser();
  assert.equal((await json(await progress(u.cookie, { vodId: "300", streamerLogin: "xqc", progressSeconds: 90, totalSeconds: 100 }))).isWatched, false);
  assert.equal((await json(await progress(u.cookie, { vodId: "300", streamerLogin: "xqc", progressSeconds: 95, totalSeconds: 100 }))).isWatched, true);
});

test("an explicit un-watch (for example Undo) overwrites a watched VOD", async () => {
  const u = await createUser();
  await progress(u.cookie, { vodId: "400", streamerLogin: "xqc", isWatched: true, progressSeconds: 100, totalSeconds: 100 });
  const res = await json(await progress(u.cookie, { vodId: "400", streamerLogin: "xqc", isWatched: false, progressSeconds: 20, totalSeconds: 100 }));
  assert.deepEqual([res.isWatched, res.progressSeconds], [false, 20]);
});

test("the streamer is looked up from the saved row when omitted", async () => {
  const u = await createUser();
  await progress(u.cookie, { vodId: "500", streamerLogin: "xqc", progressSeconds: 10, totalSeconds: 100 });
  assert.equal((await progress(u.cookie, { vodId: "500", progressSeconds: 20, totalSeconds: 100 })).status, 200);
  assert.equal((await row(u.id, "500")).progress_seconds, 20);
  assert.equal(await count("watch_status", u.id), 1); // updated in place, not duplicated
});

test("seconds are clamped to a sane range", async () => {
  const u = await createUser();
  const res = await json(await progress(u.cookie, { vodId: "600", streamerLogin: "xqc", progressSeconds: 99999999, totalSeconds: -5 }));
  assert.equal(res.progressSeconds, 864000);
  assert.equal((await row(u.id, "600")).total_seconds, 0);
});

test("progress POST is rate limited per client", async () => {
  const u = await createUser();
  const ip = "198.51.100.7";
  let last;
  for (let i = 0; i < 121; i++) last = await progress(u.cookie, { vodId: "700", streamerLogin: "xqc", progressSeconds: i, totalSeconds: 999 }, { ip });
  assert.equal(last.status, 429);
});

// ------------------------------------------------------------ GET /api/watch/progress
test("progress GET: anonymous gets null, single VOD and batch lookups work", async () => {
  assert.deepEqual(await json(await getProgress(request("/api/watch/progress?vodId=1"))), { progress: null });

  const u = await createUser();
  await progress(u.cookie, { vodId: "801", streamerLogin: "xqc", isWatched: true, progressSeconds: 50, totalSeconds: 50 });
  await progress(u.cookie, { vodId: "802", streamerLogin: "xqc", progressSeconds: 10, totalSeconds: 50 });

  const single = (await json(await getProgress(request("/api/watch/progress?vodId=801", { cookie: u.cookie })))).progress;
  assert.deepEqual([single.vodId, single.isWatched, single.streamerLogin], ["801", true, "xqc"]);
  assert.equal((await json(await getProgress(request("/api/watch/progress?vodId=999", { cookie: u.cookie })))).progress, null);

  const map = (await json(await getProgress(request("/api/watch/progress?vodIds=801,802,803,junk", { cookie: u.cookie })))).progressMap;
  assert.deepEqual(Object.keys(map).sort(), ["801", "802"]);
  assert.equal(map["801"].isWatched, true);
  assert.equal(map["802"].progressSeconds, 10);

  assert.equal((await getProgress(request("/api/watch/progress", { cookie: u.cookie }))).status, 400);
  assert.deepEqual(await json(await getProgress(request("/api/watch/progress?vodIds=junk", { cookie: u.cookie }))), { progressMap: {} });
});

test("progress GET never leaks another user's watch history", async () => {
  const a = await createUser();
  const b = await createUser();
  await progress(a.cookie, { vodId: "900", streamerLogin: "xqc", isWatched: true, progressSeconds: 1, totalSeconds: 1 });
  assert.equal((await json(await getProgress(request("/api/watch/progress?vodId=900", { cookie: b.cookie })))).progress, null);
  assert.deepEqual((await json(await getProgress(request("/api/watch/progress?vodIds=900", { cookie: b.cookie })))).progressMap, {});
  // b's own write does not touch a's row
  await progress(b.cookie, { vodId: "900", streamerLogin: "xqc", isWatched: false, progressSeconds: 0, totalSeconds: 1 });
  assert.equal((await row(a.id, "900")).is_watched, 1);
});

// ------------------------------------------------------------ POST /api/watch/bulk
test("bulk requires a session and at least one valid item", async () => {
  assert.equal((await bulk(undefined, { items: [{ vodId: "1", streamerLogin: "xqc" }] })).status, 401);
  const u = await createUser();
  assert.equal((await bulk(u.cookie, {})).status, 400);
  assert.equal((await bulk(u.cookie, { items: [] })).status, 400);
  assert.equal((await bulk(u.cookie, { items: [{ vodId: "x", streamerLogin: "xqc" }, { vodId: "1", streamerLogin: "!" }] })).status, 400);
});

test("bulk marks every valid item watched, skipping invalid ones, and reports the count", async () => {
  const u = await createUser();
  const res = await json(await bulk(u.cookie, {
    items: [
      { vodId: "1001", streamerLogin: "xqc", totalSeconds: 600 },
      { vodId: "1002", streamerLogin: "xqc", totalSeconds: 700 },
      { vodId: "bad", streamerLogin: "xqc" },
    ],
  }));
  assert.deepEqual([res.updatedCount, res.isWatched], [2, true]);
  const r = await row(u.id, "1001");
  assert.deepEqual([r.is_watched, r.progress_seconds, r.total_seconds], [1, 600, 600]);
});

test("bulk un-watching resets progress and bulk updates overwrite existing rows", async () => {
  const u = await createUser();
  await progress(u.cookie, { vodId: "1101", streamerLogin: "xqc", progressSeconds: 40, totalSeconds: 100 });
  await bulk(u.cookie, { items: [{ vodId: "1101", streamerLogin: "xqc", totalSeconds: 100 }] });
  assert.equal((await row(u.id, "1101")).is_watched, 1);

  const res = await json(await bulk(u.cookie, { items: [{ vodId: "1101", streamerLogin: "xqc", totalSeconds: 100 }], isWatched: false }));
  assert.equal(res.isWatched, false);
  const r = await row(u.id, "1101");
  assert.deepEqual([r.is_watched, r.progress_seconds], [0, 0]);
  assert.equal(await count("watch_status", u.id), 1);
});

test("bulk processes at most 200 items per request", async () => {
  const u = await createUser();
  const items = Array.from({ length: 250 }, (_, i) => ({ vodId: String(2000 + i), streamerLogin: "xqc", totalSeconds: 1 }));
  assert.equal((await json(await bulk(u.cookie, { items }))).updatedCount, 200);
  assert.equal(await count("watch_status", u.id), 200);
});

test("bulk only ever writes the caller's rows", async () => {
  const a = await createUser();
  const b = await createUser();
  await progress(a.cookie, { vodId: "3001", streamerLogin: "xqc", isWatched: false, progressSeconds: 5, totalSeconds: 10 });
  await bulk(b.cookie, { items: [{ vodId: "3001", streamerLogin: "xqc", totalSeconds: 10 }] });
  assert.equal((await row(a.id, "3001")).is_watched, 0);
  assert.equal((await row(b.id, "3001")).is_watched, 1);
});

test("bulk rejects a malformed 'before' cutoff before doing any work", async () => {
  const u = await createUser();
  for (const before of ["yesterday", "", 12345, null, {}]) {
    const res = await bulk(u.cookie, { streamerLogin: "xqc", allStreamerVods: true, before });
    assert.equal(res.status, 400, JSON.stringify(before));
  }
});

// ------------------------------------------------------------ lib/watch/merge
test("getWatchStatusMapForUser handles more ids than SQLite's variable limit by chunking", async () => {
  const u = await createUser();
  const ids = Array.from({ length: 1234 }, (_, i) => String(50000 + i));
  // seed a sample spread across chunks
  for (const id of [ids[0], ids[99], ids[100], ids[1000], ids[1233]]) {
    await db.execute({
      sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds) VALUES (?, ?, ?, 'xqc', 1, 7)",
      args: [`m_${id}`, u.id, id],
    });
  }
  const map = await getWatchStatusMapForUser(u.id, ids);
  assert.deepEqual(Object.keys(map).sort(), [ids[0], ids[99], ids[100], ids[1000], ids[1233]].sort());
  assert.deepEqual(map[ids[100]], { isWatched: true, progressSeconds: 7, totalSeconds: 0 });
});

test("getWatchStatusMapForUser returns an empty map without a user or ids", async () => {
  assert.deepEqual(await getWatchStatusMapForUser("", ["1"]), {});
  assert.deepEqual(await getWatchStatusMapForUser("u", []), {});
});

test("attachWatchStatusToVods defaults unseen VODs to unwatched with their own length", async () => {
  const u = await createUser();
  await db.execute({
    sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES ('att', ?, '60001', 'xqc', 1, 30, 30)",
    args: [u.id],
  });
  const out = await attachWatchStatusToVods(u.id, [{ id: "60001", lengthSeconds: 30 }, { id: "60002", lengthSeconds: 99 }]);
  assert.equal(out[0].watchStatus.isWatched, true);
  assert.deepEqual(out[1].watchStatus, { isWatched: false, progressSeconds: 0, totalSeconds: 99 });
  assert.deepEqual(await attachWatchStatusToVods(u.id, []), []);
});
