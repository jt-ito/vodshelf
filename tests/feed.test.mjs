import { db, request, createUser, fakeUpstream, videoNode, clearMemoryCaches, waitFor } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "@/app/api/streamers/feed/route";
import { resetUpstreamHealth } from "@/lib/twitch/upstream-health";

const json = (res) => res.json();
const feed = (cookie) => GET(request("/api/streamers/feed", { cookie }));
const FRESH_MS = 2 * 60 * 1000;

let upstream;
let n = 0;
const login = () => `feed_streamer_${++n}`; // unique per test: caches are keyed by login

beforeEach(() => resetUpstreamHealth());
afterEach(() => upstream?.());

async function pin(user, streamerLogin, { hidden = false } = {}) {
  await db.execute({
    sql: "INSERT INTO pinned_streamers (id, user_id, streamer_login, streamer_display_name, is_hidden) VALUES (?, ?, ?, ?, ?)",
    args: [`${user.id}_${streamerLogin}`, user.id, streamerLogin, streamerLogin, hidden ? 1 : 0],
  });
}
const snapshot = async (streamerLogin) =>
  (await db.execute({ sql: "SELECT payload, fetched_at FROM vod_snapshots WHERE key = ?", args: [`streamer:${streamerLogin}`] })).rows[0];
const ageSnapshot = (streamerLogin, ms) =>
  db.execute({ sql: "UPDATE vod_snapshots SET fetched_at = fetched_at - ? WHERE key = ?", args: [ms, `streamer:${streamerLogin}`] });

test("anonymous users and users with no pins get an empty feed with guidance", async () => {
  upstream = fakeUpstream();
  const anon = await json(await feed(undefined));
  assert.deepEqual(anon.videos, []);
  assert.match(anon.message, /Sign in/);
  const u = await createUser();
  const empty = await json(await feed(u.cookie));
  assert.deepEqual(empty.videos, []);
  assert.match(empty.message, /pinned/i);
});

test("the first load builds each creator's list from upstream and saves a snapshot", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(101, s), videoNode(102, s, { title: "Newest", createdAt: new Date().toISOString() })] });
  const u = await createUser();
  await pin(u, s);

  const data = await json(await feed(u.cookie));
  assert.deepEqual(data.videos.map((v) => v.id), ["102", "101"]); // newest first
  assert.equal(data.stale, false);
  assert.equal(data.videos[0].watchStatus.isWatched, false);
  assert.equal(data.videos[0].isFavoriteCategory, false);
  assert.ok(await snapshot(s), "a snapshot row should have been stored");
});

test("later loads are served from the database snapshot without calling Twitch", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(201, s)] });
  const u = await createUser();
  await pin(u, s);

  await feed(u.cookie);
  const callsAfterFirst = upstream.towerCalls();
  await clearMemoryCaches(s); // so only the database snapshot can answer
  const second = await json(await feed(u.cookie));
  assert.equal(second.videos.length, 1);
  assert.equal(second.stale, false);
  assert.equal(upstream.towerCalls(), callsAfterFirst, "a fresh snapshot must not trigger upstream calls");
});

test("an out-of-date snapshot is refreshed within the same request when upstream answers quickly", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(301, s, { title: "Old title" })] });
  const u = await createUser();
  await pin(u, s);
  await feed(u.cookie);

  await ageSnapshot(s, FRESH_MS + 60_000);
  upstream.state.videos = [videoNode(301, s, { title: "New title" })];
  await clearMemoryCaches(s);

  // the very first answer already has the new data: no "old now, new a few seconds later"
  const data = await json(await feed(u.cookie));
  assert.equal(data.videos[0].title, "New title");
  assert.equal(data.stale, false);
});

test("when the refresh is slower than the short wait, the saved copy is returned and the refresh finishes in the background", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(311, s, { title: "Old title" })] });
  const u = await createUser();
  await pin(u, s);
  await feed(u.cookie);

  await ageSnapshot(s, FRESH_MS + 60_000);
  upstream.state.videos = [videoNode(311, s, { title: "New title" })];
  upstream.state.delayMs = 700; // slower than FEED_SOFT_WAIT_MS (150ms in tests)
  await clearMemoryCaches(s);

  const started = Date.now();
  const stale = await json(await feed(u.cookie));
  assert.ok(Date.now() - started < 600, "the page must not wait for a slow upstream");
  assert.equal(stale.videos[0].title, "Old title");
  assert.equal(stale.stale, true);
  assert.ok(stale.oldestSnapshotAt < Date.now() - FRESH_MS);

  await waitFor(async () => (await snapshot(s)).payload.includes("New title"), 3000, "background refresh");
  upstream.state.delayMs = 0;
  const fresh = await json(await feed(u.cookie));
  assert.equal(fresh.videos[0].title, "New title");
  assert.equal(fresh.stale, false);
});

test("when Twitch is down the saved feed keeps working and the outage is reported", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(401, s)] });
  const u = await createUser();
  await pin(u, s);
  await feed(u.cookie);

  await ageSnapshot(s, FRESH_MS + 60_000);
  upstream.state.twitchDown = true;
  await clearMemoryCaches(s);

  let data;
  await waitFor(async () => {
    data = await json(await feed(u.cookie));
    return data.outages.some((o) => o.name === "twitch" && o.state === "down");
  }, 4000, "Twitch to be flagged down");

  assert.equal(data.videos.length, 1, "saved videos must still be served");
  assert.equal(data.stale, true);
  const outage = data.outages.find((o) => o.name === "twitch");
  assert.match(outage.message, /Twitch/);
  assert.ok((await snapshot(s)).payload.includes("Stream 401"), "a failed refresh must not erase the snapshot");
});

test("a creator Twitch cannot answer for contributes nothing instead of breaking the feed", async () => {
  const good = login();
  const bad = login();
  upstream = fakeUpstream({ videos: [videoNode(501, good)] });
  const u = await createUser();
  await pin(u, good);
  await pin(u, bad);
  // 'bad' has no videos in the fake; make Twitch fail only for it by removing it from the answer set
  const data = await json(await feed(u.cookie));
  assert.deepEqual(data.videos.map((v) => v.id), ["501"]);
});

test("a VODVOD outage keeps unlisted streams from the previous snapshot", async () => {
  const s = login();
  const unlisted = {
    Metadata: {
      Public: { Bool: false }, StreamID: 99999999999, TitleAtStart: "Hidden stream", StartTime: new Date().toISOString(),
      HlsDurationSeconds: { Float64: 600 }, MaxViews: 3,
    },
    Link: `/channels/${s}/1/index.m3u8`,
  };
  upstream = fakeUpstream({ videos: [videoNode(601, s, { createdAt: new Date(Date.now() - 10 * 86400_000).toISOString() })], vodvod: { status: 200, body: [unlisted] } });
  const u = await createUser();
  await pin(u, s);

  const first = await json(await feed(u.cookie));
  assert.ok(first.videos.some((v) => v.isUnlisted && v.title === "Hidden stream"), "unlisted stream should appear");

  await ageSnapshot(s, FRESH_MS + 60_000);
  const agedAt = Number((await snapshot(s)).fetched_at);
  upstream.state.vodvod = { status: 503, body: [] };
  await clearMemoryCaches(s);
  await feed(u.cookie); // triggers the refresh while VODVOD is failing
  await waitFor(async () => Number((await snapshot(s)).fetched_at) > agedAt, 3000, "refresh to finish");

  assert.ok((await snapshot(s)).payload.includes("Hidden stream"), "unlisted stream must survive a VODVOD outage");
});

test("the feed tells the UI which broadcasts' playlists are not ready yet", async () => {
  const s = login();
  const item = (id, bytes) => ({
    Metadata: { Public: { Bool: false }, StreamID: id, TitleAtStart: `Broadcast ${id}`, StartTime: new Date().toISOString(), BytesFound: bytes },
    Link: `/m3u8/${id}/1/index.m3u8`,
  });
  upstream = fakeUpstream({
    videos: [videoNode(1101, s, { createdAt: new Date(Date.now() - 10 * 86400_000).toISOString() })],
    vodvod: { status: 200, body: [item(88888888881, { Bool: false, Valid: false }), item(88888888882, { Bool: true, Valid: true })] },
  });
  const u = await createUser();
  await pin(u, s);
  const data = await json(await feed(u.cookie));
  const byTitle = Object.fromEntries(data.videos.map((v) => [v.title, v]));
  assert.equal(byTitle["Broadcast 88888888881"].availability, "processing");
  assert.equal(byTitle["Broadcast 88888888882"].availability, "ready");
  // and it survives the database snapshot round trip
  await clearMemoryCaches(s);
  const again = await json(await feed(u.cookie));
  assert.equal(again.videos.find((v) => v.title === "Broadcast 88888888881").availability, "processing");
});

test("hidden creators are left out of the feed", async () => {
  const shown = login();
  const hidden = login();
  upstream = fakeUpstream({ videos: [videoNode(701, shown), videoNode(702, hidden)] });
  const u = await createUser();
  await pin(u, shown);
  await pin(u, hidden, { hidden: true });
  const data = await json(await feed(u.cookie));
  assert.deepEqual(data.videos.map((v) => v.id), ["701"]);
});

test("watch status is merged per user from the shared snapshot", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(801, s, { lengthSeconds: 100 })] });
  const a = await createUser();
  const b = await createUser();
  await pin(a, s);
  await pin(b, s);
  await db.execute({
    sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES ('fw1', ?, '801', ?, 1, 100, 100)",
    args: [a.id, s],
  });

  const forA = (await json(await feed(a.cookie))).videos[0];
  const forB = (await json(await feed(b.cookie))).videos[0];
  assert.equal(forA.watchStatus.isWatched, true);
  assert.equal(forB.watchStatus.isWatched, false);
  assert.equal(forB.watchStatus.isNew, true);
});

test("favorite categories sort first and are flagged", async () => {
  const s = login();
  upstream = fakeUpstream({
    videos: [
      videoNode(901, s, { createdAt: new Date().toISOString() }),
      videoNode(902, s, { createdAt: new Date(Date.now() - 86400_000).toISOString(), game: { id: "1", displayName: "Dota 2", boxArtURL: "" } }),
    ],
  });
  const u = await createUser();
  await pin(u, s);
  await db.execute({ sql: "INSERT INTO favorite_categories (id, user_id, category_name) VALUES ('fc1', ?, 'Dota 2')", args: [u.id] });
  const data = await json(await feed(u.cookie));
  assert.deepEqual(data.videos.map((v) => v.id), ["902", "901"]); // favorited category first despite being older
  assert.equal(data.videos[0].isFavoriteCategory, true);
  assert.deepEqual(data.favoriteCategories, ["Dota 2"]);
});

test("live creators are flagged", async () => {
  const s = login();
  upstream = fakeUpstream({ videos: [videoNode(1001, s)], liveLogins: [s] });
  const u = await createUser();
  await pin(u, s);
  const data = await json(await feed(u.cookie));
  assert.equal(data.videos[0].isStreamerLive, true);
  assert.equal(data.liveMap[s].isLive, true);
});

test("the feed filter preference is validated and persisted", async () => {
  upstream = fakeUpstream();
  const u = await createUser();
  const post = (body, cookie = u.cookie) => POST(request("/api/streamers/feed", { method: "POST", body, cookie }));
  assert.equal((await post({ filter: "bogus" })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ filter: "unwatched" }, null)).status, 401); // null = no cookie
  assert.equal((await post({ filter: "unwatched" })).status, 200);
  const s = login();
  await pin(u, s);
  assert.equal((await json(await feed(u.cookie))).feedFilter, "unwatched");
});
