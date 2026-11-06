import { db, request, createUser, fakeUpstream, videoNode } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/api/twitch/cdn-list/[login]/route";
import { resetUpstreamHealth, getUpstreamState } from "@/lib/twitch/upstream-health";

let upstream;
beforeEach(() => resetUpstreamHealth());
afterEach(() => upstream?.());
let n = 0;
const login = () => `cdnlist${++n}`;
const list = (l, cookie) => GET(request(`/api/twitch/cdn-list/${l}`, { cookie }), { params: { login: l } });
const json = (res) => res.json();
const HOUR = 3600_000;

// A public VOD whose preview URL reveals its CloudFront storage hash and Twitch stream id
const publicVod = (id, l, streamId, extra = {}) =>
  videoNode(id, l, {
    previewThumbnailURL: `https://static-cdn.jtvnw.net/cf_vods/d2vjef5jvl6bfs/hash${id}_${l}_${streamId}_1700000000/thumb/thumb0-640x360.jpg`,
    ...extra,
  });

const indexerItem = (streamId, { isPublic = false, title = "Indexed stream", start = new Date().toISOString(), link, bytes } = {}) => ({
  Metadata: {
    Public: { Bool: isPublic }, StreamID: streamId, TitleAtStart: title, StartTime: start, HlsDurationSeconds: { Float64: 120.4 }, GameNameAtStart: "Chat", ID: `meta${streamId}`,
    ...(bytes ? { BytesFound: bytes } : {}),
  },
  Link: link ?? `/channels/x/${streamId}/index.m3u8`,
});

test("an invalid login is rejected", async () => {
  upstream = fakeUpstream();
  assert.equal((await list("bad login!")).status, 400);
});

test("public VODs are listed with their CloudFront master playlist, proxied", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(11, l, 12345678901)] });
  const data = await json(await list(l));
  assert.equal(data.count, 1);
  const [s] = data.streams;
  assert.equal(s.source, "gql_extraction");
  assert.equal(s.isUnlisted, false);
  assert.equal(s.vodId, "11");
  assert.equal(s.streamId, "12345678901");
  assert.equal(s.masterPlaylistUrl, `https://d2vjef5jvl6bfs.cloudfront.net/hash11_${l}_12345678901_1700000000/chunked/index-dvr.m3u8`);
  assert.equal(s.proxiedUrl, `/api/proxy/m3u8?url=${encodeURIComponent(s.masterPlaylistUrl)}`);
});

test("indexer streams that are not public VODs are flagged as unlisted, newest first", async () => {
  const l = login();
  upstream = fakeUpstream({
    videos: [publicVod(21, l, 12345678901, { createdAt: new Date(Date.now() - 5 * 24 * HOUR).toISOString() })],
    vodvod: { status: 200, body: [indexerItem(99999999991, { title: "Hidden one", start: new Date(Date.now() - HOUR).toISOString() })] },
  });
  const { streams } = await json(await list(l));
  assert.deepEqual(streams.map((s) => s.title), ["Hidden one", "Stream 21"]);
  assert.equal(streams[0].isUnlisted, true);
  assert.equal(streams[0].source, "indexer");
  assert.equal(streams[0].masterPlaylistUrl, "https://api.vodvod.top/channels/x/99999999991/index.m3u8");
  assert.equal(streams[0].durationSeconds, 120);
});

test("an indexer record for a stream that is also a public VOD is merged, not duplicated or called unlisted", async () => {
  const l = login();
  upstream = fakeUpstream({
    videos: [publicVod(31, l, 12345678901)],
    vodvod: { status: 200, body: [indexerItem(12345678901, { isPublic: false, title: "Stream 31" })] },
  });
  const { streams } = await json(await list(l));
  assert.equal(streams.length, 1);
  assert.equal(streams[0].isUnlisted, false); // listed on Twitch, so definitively not unlisted
  assert.equal(streams[0].vodId, "31");
  assert.equal(streams[0].source, "indexer");
});

test("VODVOD records with no link or a hostile id are handled safely", async () => {
  const l = login();
  upstream = fakeUpstream({
    vodvod: { status: 200, body: [null, "junk", { Metadata: {} }, indexerItem(99999999992, { link: "" })] },
  });
  const res = await list(l);
  assert.equal(res.status, 200);
  const { streams } = await json(res);
  assert.ok(streams.every((s) => s.masterPlaylistUrl === "" || s.masterPlaylistUrl.startsWith("https://api.vodvod.top/")));
});

test("each stream says whether VODVOD's playlist is ready yet, so the UI can badge the ones that are not", async () => {
  const l = login();
  upstream = fakeUpstream({
    videos: [publicVod(91, l, 12345678901)],
    vodvod: { status: 200, body: [
      indexerItem(99999999911, { title: "Ready one", bytes: { Bool: true, Valid: true } }),
      indexerItem(99999999912, { title: "Still processing", bytes: { Bool: false, Valid: false } }),
      indexerItem(99999999913, { title: "Captured nothing", bytes: { Bool: false, Valid: true }, start: new Date(Date.now() - 200 * HOUR).toISOString() }),
      indexerItem(99999999914, { title: "No link yet", link: "", bytes: { Bool: true, Valid: true } }),
    ] },
  });
  const byTitle = Object.fromEntries((await json(await list(l))).streams.map((s) => [s.title, s]));
  assert.equal(byTitle["Ready one"].availability, "ready");
  assert.equal(byTitle["Still processing"].availability, "processing");
  assert.equal(byTitle["Captured nothing"].availability, "no_data");
  assert.equal(byTitle["No link yet"].availability, "processing"); // a missing link is never 'ready'
  assert.equal(byTitle["No link yet"].masterPlaylistUrl, "");
  assert.equal(byTitle["Stream 91"].availability, "ready"); // public VODs come from Twitch itself
});

test("results are cached for a few minutes", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(41, l, 12345678901)] });
  await list(l);
  const calls = upstream.calls.length;
  await list(l);
  assert.equal(upstream.calls.length, calls);
});

test("a VODVOD outage still returns public VODs, is reported, and the partial list is NOT cached", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(51, l, 12345678901)], vodvod: { status: 503, body: [] } });
  const partial = await json(await list(l));
  assert.deepEqual(partial.streams.map((s) => s.source), ["gql_extraction"]);
  assert.equal(getUpstreamState("vodvod"), "degraded");

  // VODVOD recovers: the very next request must include its streams (a cached partial would hide them for 5 minutes)
  upstream.state.vodvod = { status: 200, body: [indexerItem(99999999993, { title: "Back again" })] };
  const recovered = await json(await list(l));
  assert.ok(recovered.streams.some((s) => s.title === "Back again"));
  assert.equal(getUpstreamState("vodvod"), "ok");
});

test("a Twitch outage returns what VODVOD knows and is not cached either", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(61, l, 12345678901)], vodvod: { status: 200, body: [indexerItem(99999999994, { title: "Only indexer" })] } });
  upstream.state.twitchDown = true;
  const down = await json(await list(l));
  assert.deepEqual(down.streams.map((s) => s.title), ["Only indexer"]);

  upstream.state.twitchDown = false;
  resetUpstreamHealth();
  const back = await json(await list(l));
  assert.ok(back.streams.some((s) => s.title === "Stream 61"));
});

test("a VODVOD 404 (channel not indexed) is a complete answer and is cached", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(71, l, 12345678901)], vodvod: { status: 404, body: [] } });
  await list(l);
  const calls = upstream.calls.length;
  await list(l);
  assert.equal(upstream.calls.length, calls);
  assert.equal(getUpstreamState("vodvod"), "ok");
});

test("anonymous responses are publicly cacheable; signed-in ones are private and carry watch status", async () => {
  const l = login();
  upstream = fakeUpstream({ videos: [publicVod(81, l, 12345678901)] });
  const anon = await list(l);
  assert.match(anon.headers.get("cache-control"), /public, s-maxage=120/);
  assert.equal((await json(anon)).streams[0].watchStatus.isWatched, false);

  const u = await createUser();
  await db.execute({
    sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES ('cl1', ?, '81', ?, 1, 3600, 3600)",
    args: [u.id, l],
  });
  const signedIn = await list(l, u.cookie);
  assert.equal(signedIn.headers.get("cache-control"), "private, no-cache");
  assert.equal((await json(signedIn)).streams[0].watchStatus.isWatched, true);

  const other = await createUser();
  assert.equal((await json(await list(l, other.cookie))).streams[0].watchStatus.isWatched, false);
});
