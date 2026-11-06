import { db, request, createUser, mockFetch, videoNode, trackerPage, count } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as vodsRoute } from "@/app/api/twitch/vods/[login]/route";
import { POST as bulkRoute } from "@/app/api/watch/bulk/route";
import { getAllChannelVods, getChannelVods } from "@/lib/twitch/gql";
import { resetUpstreamHealth } from "@/lib/twitch/upstream-health";

const json = (res) => res.json();
let restore = () => {};
beforeEach(() => resetUpstreamHealth());
afterEach(() => restore());
let n = 0;
const uniq = (p) => `${p}${++n}`;
const DAY = 86400_000;

/**
 * Fake Twitch with paging: `catalogue` is every video; the tower query returns `pageSize` at a time using cursors.
 * `failOnPage` makes that (1-based) page throw a network error.
 */
function pagedTwitch(catalogue, { pageSize = 100, failOnPage = 0 } = {}) {
  let tower = 0;
  const state = { failOnPage };
  const restoreFetch = mockFetch((url, init) => {
    if (url.startsWith("https://twitchtracker.com")) return new Response("blocked", { status: 403 });
    if (url.includes("vodvod")) return [];
    const body = JSON.parse(init.body);
    if (body.operationName !== "FilterableVideoTower_Videos") return { data: {} };
    tower++;
    if (state.failOnPage && tower === state.failOnPage) throw new Error("twitch hiccup");
    const { cursor, limit, broadcastType } = body.variables;
    let list = catalogue.filter((v) => !broadcastType || v.broadcastType === broadcastType);
    const start = cursor ? Number(cursor.slice(1)) + 1 : 0;
    const size = Math.min(limit, pageSize);
    const slice = list.slice(start, start + size);
    return {
      data: { user: { id: "1", videos: {
        edges: slice.map((node, i) => ({ cursor: `c${start + i}`, node })),
        pageInfo: { hasNextPage: start + size < list.length },
      } } },
    };
  });
  restoreFetch.state = state;
  restoreFetch.resetTower = () => { tower = 0; };
  return restoreFetch;
}
const catalogue = (login, count, makeExtra = () => ({})) =>
  Array.from({ length: count }, (_, i) => videoNode(1000 + i, login, makeExtra(i)));

// ------------------------------------------------------------------ getAllChannelVods
test("the full catalogue is collected across pages", async () => {
  const login = uniq("allvods");
  restore = pagedTwitch(catalogue(login, 230));
  const all = await getAllChannelVods(login);
  assert.equal(all.length, 230);
  assert.equal(new Set(all.map((v) => v.id)).size, 230);
});

test("a failed page makes the whole fetch fail instead of returning a partial list, and nothing bad is cached", async () => {
  const login = uniq("partial");
  restore = pagedTwitch(catalogue(login, 230), { failOnPage: 2 });
  await assert.rejects(getAllChannelVods(login));
  restore.state.failOnPage = 0;
  restore.resetTower();
  assert.equal((await getAllChannelVods(login)).length, 230); // a later attempt is not poisoned by the failure
});

// ------------------------------------------------------------------ bulk "mark all" for a creator
const bulk = (cookie, body) => bulkRoute(request("/api/watch/bulk", { method: "POST", body, cookie }));

test("mark-all marks every VOD of the creator for the caller only", async () => {
  const login = uniq("markall");
  restore = pagedTwitch(catalogue(login, 130));
  const u = await createUser();
  const other = await createUser();
  const res = await json(await bulk(u.cookie, { streamerLogin: login, allStreamerVods: true }));
  assert.deepEqual([res.updatedCount, res.allStreamerVods, res.isWatched], [130, true, true]);
  assert.equal(await count("watch_status", u.id), 130);
  assert.equal(await count("watch_status", other.id), 0);
  const row = (await db.execute({ sql: "SELECT is_watched, progress_seconds, total_seconds FROM watch_status WHERE user_id = ? LIMIT 1", args: [u.id] })).rows[0];
  assert.deepEqual([row.is_watched, row.progress_seconds, row.total_seconds], [1, 3600, 3600]);
});

test("mark-all with a cutoff only touches VODs created before it", async () => {
  const login = uniq("cutoff");
  // first 40 are recent, the rest are a month old
  restore = pagedTwitch(catalogue(login, 130, (i) => ({ createdAt: new Date(Date.now() - (i < 40 ? 1 : 30) * DAY).toISOString() })));
  const u = await createUser();
  const before = new Date(Date.now() - 10 * DAY).toISOString();
  const res = await json(await bulk(u.cookie, { streamerLogin: login, allStreamerVods: true, before }));
  assert.equal(res.updatedCount, 90);
  const recent = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM watch_status WHERE user_id = ? AND vod_id = ?", args: [u.id, "1000"] })).rows[0].n;
  assert.equal(recent, 0, "a recent VOD must stay untouched");
  assert.equal(await count("watch_status", u.id), 90);
});

test("mark-all with a cutoff that matches nothing reports zero", async () => {
  const login = uniq("nothing");
  restore = pagedTwitch(catalogue(login, 10));
  const u = await createUser();
  const res = await json(await bulk(u.cookie, { streamerLogin: login, allStreamerVods: true, before: new Date(Date.now() - 365 * DAY).toISOString() }));
  assert.equal(res.updatedCount, 0);
  assert.match(res.message, /before that date/);
});

test("mark-all fails loudly when Twitch is unavailable instead of claiming there were no VODs", async () => {
  const login = uniq("twdown");
  restore = mockFetch(() => { throw new Error("twitch is down"); }); // every Twitch query fails, as in a real outage
  const u = await createUser();
  const res = await bulk(u.cookie, { streamerLogin: login, allStreamerVods: true });
  assert.equal(res.status, 500);
  assert.equal(await count("watch_status", u.id), 0);
});

// ------------------------------------------------------------------ VOD listing route
const list = (login, qs = "", cookie) => vodsRoute(request(`/api/twitch/vods/${login}${qs}`, { cookie }), { params: { login } });

test("the listing validates the login", async () => {
  assert.equal((await list("bad login")).status, 400);
});

test("anonymous listings are publicly cacheable and every VOD defaults to unwatched", async () => {
  const login = uniq("listanon");
  restore = pagedTwitch(catalogue(login, 5));
  const res = await list(login);
  assert.match(res.headers.get("cache-control"), /public, s-maxage=60/);
  const data = await json(res);
  assert.equal(data.videos.length, 5);
  assert.deepEqual(data.videos[0].watchStatus, { isWatched: false, progressSeconds: 0, totalSeconds: 3600 });
});

test("signed-in listings are private and carry only that user's watch status", async () => {
  const login = uniq("listuser");
  restore = pagedTwitch(catalogue(login, 3));
  const a = await createUser();
  const b = await createUser();
  await db.execute({
    sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES ('lw', ?, '1000', ?, 1, 3600, 3600)",
    args: [a.id, login],
  });
  const forA = await list(login, "", a.cookie);
  assert.match(forA.headers.get("cache-control"), /private, no-cache/);
  assert.equal((await json(forA)).videos.find((v) => v.id === "1000").watchStatus.isWatched, true);
  assert.equal((await json(await list(login, "", b.cookie))).videos.find((v) => v.id === "1000").watchStatus.isWatched, false);
});

test("paging parameters are clamped and forwarded to Twitch", async () => {
  const login = uniq("paging");
  restore = pagedTwitch(catalogue(login, 300));
  await list(login, "?first=9999&after=c10");
  const body = JSON.parse(restore.calls.find((c) => c.init?.body?.includes("FilterableVideoTower_Videos")).init.body);
  assert.equal(body.variables.limit, 100); // clamped
  assert.equal(body.variables.cursor, "c10");
});

test("the broadcast type filter is applied and invalid types are ignored", async () => {
  const login = uniq("types");
  const mixed = [videoNode(1, login), videoNode(2, login, { broadcastType: "HIGHLIGHT" }), videoNode(3, login, { broadcastType: "UPLOAD" })];
  restore = pagedTwitch(mixed);
  assert.deepEqual((await json(await list(login, "?type=highlight"))).videos.map((v) => v.id), ["2"]);
  restore();
  const login2 = uniq("types");
  restore = pagedTwitch([videoNode(1, login2), videoNode(2, login2, { broadcastType: "HIGHLIGHT" })]);
  assert.equal((await json(await list(login2, "?type=bogus"))).videos.length, 2);
});

test("searching matches every word against titles and categories across the whole catalogue", async () => {
  const login = uniq("search");
  restore = pagedTwitch([
    videoNode(1, login, { title: "Cooking dumplings live" }),
    videoNode(2, login, { title: "Playing Zelda", game: { id: "9", displayName: "Zelda", boxArtURL: "" } }),
    videoNode(3, login, { title: "Dumplings part 2" }),
  ]);
  const data = await json(await list(login, "?q=dumplings"));
  assert.equal(data.isSearch, true);
  assert.deepEqual(data.videos.map((v) => v.id).sort(), ["1", "3"]);
  assert.equal(data.totalSearched, 3);
  assert.deepEqual((await json(await list(login, "?q=zelda"))).videos.map((v) => v.id), ["2"]); // category match
  assert.deepEqual((await json(await list(login, "?q=cooking%20zelda"))).videos, []); // all tokens must match
});

test("a listing links VODs to their TwitchTracker stream when it can be matched", async () => {
  const login = uniq("ttlink");
  const created = new Date(Date.now() - 2 * DAY);
  const date = created.toISOString().slice(0, 16).replace("T", " ");
  restore = mockFetch((url, init) => {
    if (url.startsWith("https://twitchtracker.com")) return new Response(trackerPage([{ date, id: 12345678901, title: "Stream 1000" }]), { status: 200 });
    if (url.includes("vodvod")) return [];
    const body = JSON.parse(init.body);
    return { data: { user: { id: "1", videos: { edges: [{ cursor: "c0", node: videoNode(1000, login, { createdAt: created.toISOString() }) }], pageInfo: { hasNextPage: false } } } } };
  });
  const [video] = (await json(await list(login))).videos;
  assert.equal(video.twitchTrackerStreamId, "12345678901");
  assert.equal(video.trackerUrl, `https://twitchtracker.com/${login}/streams/12345678901`);
});

test("a Twitch failure while listing is a clean 500 without internal details", async () => {
  const login = uniq("listfail");
  restore = mockFetch(() => { throw new Error("secret internal detail"); });
  const res = await list(login);
  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(await json(res)).includes("secret"), false);
});

test("getChannelVods maps Twitch nodes into the app's VOD shape", async () => {
  const login = uniq("shape");
  restore = pagedTwitch([videoNode(77, login, { viewCount: 1234 })]);
  const { videos, hasNextPage, cursor } = await getChannelVods(login, { first: 30, broadcastType: "ARCHIVE" });
  assert.equal(hasNextPage, false);
  assert.equal(cursor, "c0");
  assert.deepEqual([videos[0].id, videos[0].viewCount, videos[0].owner.login, videos[0].game.name], ["77", 1234, login, "Just Chatting"]);
  assert.match(videos[0].game.boxArtURL, /api\/categories\/thumbnail/); // rewritten to the local cached thumbnail route
});
