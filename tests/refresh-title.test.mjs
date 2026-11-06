import { request, mockFetch, trackerPage } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/api/twitch/vods/refresh-title/route";
import { resetUpstreamHealth } from "@/lib/twitch/upstream-health";

let restore = () => {};
beforeEach(() => resetUpstreamHealth());
afterEach(() => restore());
let n = 0;
const uniq = (p) => `${p}${++n}`;
const DAY = 86400_000;
const OLD_TITLE = "Lots To Do Today! | !merch";

const video = (over = {}, owner = {}) => ({
  id: "555000111", title: OLD_TITLE, broadcastType: "ARCHIVE", status: "RECORDED",
  createdAt: new Date(Date.now() - 10 * DAY).toISOString(), publishedAt: new Date(Date.now() - 10 * DAY).toISOString(),
  lengthSeconds: 22000, game: { name: "Just Chatting" },
  owner: { login: "creator", displayName: "Creator", broadcastSettings: null, stream: null, ...owner },
  ...over,
});

/** Fake Twitch (video lookup) + TwitchTracker. trackerRows null means TwitchTracker blocks us. */
function upstream({ vid, trackerRows = null }) {
  return mockFetch((url, init) => {
    if (url.startsWith("https://twitchtracker.com")) {
      return trackerRows ? new Response(trackerPage(trackerRows), { status: 200 }) : new Response("Just a moment...", { status: 403 });
    }
    return { data: { video: vid } };
  });
}
const refresh = (qs) => GET(request(`/api/twitch/vods/refresh-title?${qs}`));
const q = (login, current = OLD_TITLE) => `vodId=555000111&streamerLogin=${login}&currentTitle=${encodeURIComponent(current)}`;
const json = (res) => res.json();

test("a VOD id is required", async () => {
  assert.equal((await refresh("streamerLogin=x")).status, 400);
});

test("the live stream's title wins for a recent VOD", async () => {
  restore = upstream({ vid: video({ createdAt: new Date().toISOString() }, { stream: { id: "1", title: "Live right now", game: null } }) });
  const data = await json(await refresh(q(uniq("live"))));
  assert.deepEqual([data.updated, data.title, data.source], [true, "Live right now", "twitch_live_stream"]);
});

test("a recent VOD takes the channel's current broadcast title when the VOD still has the old one", async () => {
  restore = upstream({
    vid: video({ createdAt: new Date(Date.now() - DAY).toISOString() }, { broadcastSettings: { title: "Mooncakes today!", game: null } }),
  });
  const data = await json(await refresh(q(uniq("settings"))));
  assert.deepEqual([data.updated, data.title, data.source], [true, "Mooncakes today!", "twitch_broadcast_settings"]);
});

test("if Twitch's VOD title differs from what is shown, that is the update", async () => {
  restore = upstream({ vid: video({ title: "Edited on Twitch" }) });
  const data = await json(await refresh(q(uniq("edited"))));
  assert.deepEqual([data.updated, data.title, data.source], [true, "Edited on Twitch", "twitch_vod_updated"]);
});

test("an older VOD with an unchanged title asks TwitchTracker, and uses its newer title for the matching broadcast", async () => {
  const vid = video();
  const date = new Date(vid.createdAt).toISOString().slice(0, 16).replace("T", " ");
  restore = upstream({ vid, trackerRows: [
    { date, id: 12345678901, title: "MAKING MOONCAKES TODAY COME NOW!!" },
    { date: "2020-01-01 00:00", id: 12345678902, title: "Unrelated ancient stream" },
  ] });
  const data = await json(await refresh(q(uniq("tracker"))));
  assert.deepEqual([data.updated, data.title, data.source, data.trackerAvailable], [true, "MAKING MOONCAKES TODAY COME NOW!!", "twitchtracker", true]);
});

test("TwitchTracker's title for a different broadcast is never applied", async () => {
  const vid = video();
  restore = upstream({ vid, trackerRows: [{ date: "2020-01-01 00:00", id: 12345678902, title: "Some other stream entirely" }] });
  const data = await json(await refresh(q(uniq("othertt"))));
  assert.equal(data.updated, false);
  assert.equal(data.title, OLD_TITLE);
  assert.equal(data.trackerAvailable, true);
  assert.match(data.message, /already up to date/);
});

test("when TwitchTracker cannot be reached the answer says so instead of claiming the title is current", async () => {
  restore = upstream({ vid: video(), trackerRows: null });
  const data = await json(await refresh(q(uniq("blocked"))));
  assert.equal(data.updated, false);
  assert.equal(data.trackerAvailable, false);
  assert.match(data.message, /TwitchTracker couldn't be reached/);
  assert.doesNotMatch(data.message, /already up to date/);
});

test("when Twitch has no such VOD the creator's TwitchTracker history is the only source", async () => {
  restore = upstream({ vid: null, trackerRows: null });
  assert.equal((await refresh(q(uniq("gone")))).status, 404);
  restore();

  const login = uniq("gone2");
  restore = upstream({ vid: null, trackerRows: [{ date: "2026-09-01 10:00", id: 12345678903, title: OLD_TITLE }] });
  assert.equal((await refresh(q(login))).status, 404); // nothing newer to offer
});

test("a Twitch failure is a clean error", async () => {
  restore = mockFetch(() => { throw new Error("db password leaked"); });
  const res = await refresh(q(uniq("err")));
  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(await json(res)).includes("leaked"), false);
});

test("the endpoint is rate limited", async () => {
  restore = upstream({ vid: video({ title: "x" }) });
  const ip = "192.0.2.123";
  let last;
  for (let i = 0; i < 46; i++) last = await GET(request(`/api/twitch/vods/refresh-title?${q(uniq("rl"))}`, { ip }));
  assert.equal(last.status, 429);
});
