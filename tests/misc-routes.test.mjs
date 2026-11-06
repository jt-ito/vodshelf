import { db, request, createUser, mockFetch, gqlUsers } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as getStats } from "@/app/api/user/stats/route";
import { GET as getLive } from "@/app/api/streamers/live/route";
import { GET as search } from "@/app/api/twitch/search/route";
import { GET as getUser } from "@/app/api/twitch/user/[login]/route";
import { GET as trackerRedirect } from "@/app/api/twitch/tracker-redirect/route";
import { GET as status } from "@/app/api/status/route";
import { resetUpstreamHealth, reportUpstreamFailure } from "@/lib/twitch/upstream-health";

const json = (res) => res.json();
let restore = () => {};
beforeEach(() => resetUpstreamHealth());
afterEach(() => restore());
let n = 0;
const uniq = (p) => `${p}${++n}`;

// ------------------------------------------------------------------ stats
test("stats require a session", async () => {
  assert.equal((await getStats(request("/api/user/stats"))).status, 401);
});

test("stats aggregate only the caller's watch history", async () => {
  const u = await createUser();
  const other = await createUser();
  await db.batch([
    { sql: "INSERT INTO pinned_streamers (id, user_id, streamer_login, streamer_display_name) VALUES ('s1', ?, 'xqc', 'xQc')", args: [u.id] },
    { sql: "INSERT INTO favorite_categories (id, user_id, category_name) VALUES ('s2', ?, 'Dota 2')", args: [u.id] },
    { sql: "INSERT INTO bookmarks (id, user_id, vod_id, timestamp_seconds) VALUES ('s3', ?, '1', 5)", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds) VALUES ('w1', ?, '1', 'xqc', 1, 3600)", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds) VALUES ('w2', ?, '2', 'xqc', 0, 1800)", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds) VALUES ('w3', ?, '3', 'shroud', 0, 30)", args: [u.id] },
    { sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds) VALUES ('w4', ?, '9', 'xqc', 1, 99999)", args: [other.id] },
  ]);
  const data = await json(await getStats(request("/api/user/stats", { cookie: u.cookie })));
  assert.equal(data.totalEntries, 3);
  assert.equal(data.completedCount, 1);
  assert.equal(data.inProgressCount, 1); // only >60s unwatched counts as "in progress"
  assert.equal(data.totalSeconds, 5430);
  assert.equal(data.totalHours, "1.5");
  assert.deepEqual([data.pinnedCount, data.favoriteCategoriesCount, data.bookmarksCount], [1, 1, 1]);
  assert.equal(data.streamers[0].streamerLogin, "xqc");
  assert.equal(data.streamers[0].displayName, "xQc");
  assert.equal(data.streamers[0].secondsWatched, 5400);
  assert.equal(data.streamers[1].displayName, "shroud"); // falls back to the login when not pinned
});

// ------------------------------------------------------------------ live
test("live status: no valid logins means an empty map and no network call", async () => {
  restore = mockFetch(() => gqlUsers());
  assert.deepEqual(await json(await getLive(request("/api/streamers/live"))), { liveMap: {} });
  assert.deepEqual(await json(await getLive(request("/api/streamers/live?logins=bad%20name,!!"))), { liveMap: {} });
  assert.equal(restore.calls.length, 0);
});

test("live status reports which creators are live and caps the batch at 100", async () => {
  const a = uniq("live_x");
  const b = uniq("live_y");
  restore = mockFetch((url, init) => gqlUsers([a], JSON.parse(init.body).variables.logins));
  const data = await json(await getLive(request(`/api/streamers/live?logins=${a},${b}`)));
  assert.equal(data.liveMap[a].isLive, true);
  assert.equal(data.liveMap[b].isLive, false);

  const many = Array.from({ length: 150 }, (_, i) => `many_${n}_${i}`).join(",");
  await getLive(request(`/api/streamers/live?logins=${many}`));
  const sent = JSON.parse(restore.calls.at(-1).init.body).variables.logins;
  assert.equal(sent.length, 100);
});

// ------------------------------------------------------------------ search
test("search ignores very short queries without calling Twitch", async () => {
  restore = mockFetch(() => ({ data: {} }));
  assert.deepEqual(await json(await search(request("/api/twitch/search?q=a"))), { channels: [] });
  assert.deepEqual(await json(await search(request("/api/twitch/search"))), { channels: [] });
  assert.equal(restore.calls.length, 0);
});

test("search returns at most 8 channels with cache headers", async () => {
  const q = uniq("searchterm");
  const items = Array.from({ length: 12 }, (_, i) => ({ id: String(i), login: `c${i}`, displayName: `C${i}`, profileImageURL: `https://x/${i}.png` }));
  restore = mockFetch(() => ({ data: { searchFor: { channels: { items } } } }));
  const res = await search(request(`/api/twitch/search?q=${q}`));
  const data = await json(res);
  assert.equal(data.channels.length, 8);
  assert.deepEqual(data.channels[0], { login: "c0", displayName: "C0", avatar: "https://x/0.png" });
  assert.match(res.headers.get("cache-control"), /s-maxage=600/);
});

test("a failed search is not cached, so the next attempt can succeed", async () => {
  const q = uniq("flaky");
  restore = mockFetch(() => { throw new Error("twitch down"); });
  assert.deepEqual((await json(await search(request(`/api/twitch/search?q=${q}`)))).channels, []);
  restore();
  restore = mockFetch(() => ({ data: { searchFor: { channels: { items: [{ id: "1", login: "found", displayName: "Found", profileImageURL: "" }] } } } }));
  assert.equal((await json(await search(request(`/api/twitch/search?q=${q}`)))).channels[0].login, "found");
});

// ------------------------------------------------------------------ channel lookup
test("channel lookup validates the login, 404s unknown channels and returns profile data", async () => {
  restore = mockFetch(() => ({ data: { user: null } }));
  assert.equal((await getUser(request("/x"), { params: { login: "bad login" } })).status, 400);
  assert.equal((await getUser(request("/x"), { params: { login: uniq("ghostchan") } })).status, 404);
  restore();

  const login = uniq("realchan");
  restore = mockFetch(() => ({
    data: { user: { id: "9", login, displayName: "Real", profileImageURL: "https://x/p.png", description: "hi", followers: { totalCount: 42 }, stream: { id: "1", title: "live!", game: { name: "Chat" } } } },
  }));
  const res = await getUser(request("/x"), { params: { login } });
  const { streamer } = await json(res);
  assert.deepEqual([streamer.displayName, streamer.followers, streamer.isLive, streamer.gameName], ["Real", 42, true, "Chat"]);
  assert.match(res.headers.get("cache-control"), /s-maxage=300/);
});

// ------------------------------------------------------------------ tracker redirect
const redirect = (qs) => trackerRedirect(request(`/api/twitch/tracker-redirect?${qs}`));
const where = (res) => new URL(res.headers.get("location"));

test("tracker redirect only ever sends the user to twitchtracker.com", async () => {
  restore = mockFetch(() => new Response("blocked", { status: 403 }));
  const attempts = [
    "login=//evil.com", "login=evil.com/x", "login=..%2F..%2Fetc", "login=xqc&streamId=https://evil.com",
    "login=xqc&title=<script>", "login=xqc&vodId=//evil.com", "streamerLogin=a%0d%0aLocation:%20https://evil.com",
  ];
  for (const qs of attempts) {
    const res = await redirect(qs);
    assert.equal(res.status, 307, qs);
    assert.equal(where(res).hostname, "twitchtracker.com", qs);
  }
});

test("tracker redirect: no login goes to the site root, a login without ids to its stream list", async () => {
  restore = mockFetch(() => new Response("blocked", { status: 403 }));
  assert.equal(where(await redirect("")).href, "https://twitchtracker.com/");
  assert.equal(where(await redirect(`login=${uniq("plain")}`)).pathname.endsWith("/streams"), true);
});

test("tracker redirect: a numeric stream id is used directly when TwitchTracker cannot confirm it", async () => {
  restore = mockFetch(() => new Response("blocked", { status: 403 }));
  const login = uniq("direct");
  const res = await redirect(`login=${login}&streamId=12345678901`);
  assert.equal(where(res).pathname, `/${login}/streams/12345678901`);
  // a malformed id is ignored rather than injected into the URL
  const bad = await redirect(`login=${login}&streamId=12ab`);
  assert.equal(where(bad).pathname, `/${login}/streams`);
});

// ------------------------------------------------------------------ status endpoint
test("status lists failing services and is empty when everything is fine", async () => {
  assert.deepEqual(await json(await status(request("/api/status"))), { outages: [] });
  for (let i = 0; i < 3; i++) reportUpstreamFailure("vodvod", "HTTP 503");
  const res = await status(request("/api/status"));
  const { outages } = await json(res);
  assert.deepEqual(outages.map((o) => [o.name, o.state, o.label]), [["vodvod", "down", "VODVOD"]]);
  assert.match(outages[0].message, /VODVOD/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("status is rate limited", async () => {
  const ip = "192.0.2.99";
  let last;
  for (let i = 0; i < 61; i++) last = await status(request("/api/status", { ip }));
  assert.equal(last.status, 429);
});
