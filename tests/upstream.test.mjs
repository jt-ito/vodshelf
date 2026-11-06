import "./helpers/env.mjs";
import { mockFetch } from "./helpers/app.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { twitchGqlFetch, getLiveStreams } from "@/lib/twitch/gql";
import { getChannelUnlistedStreams } from "@/lib/twitch/unlisted";
import { getTwitchTrackerStreams } from "@/lib/twitch/tracker-resolver";
import { getUpstreamState, resetUpstreamHealth, reportUpstreamFailure, getOutages } from "@/lib/twitch/upstream-health";

let restore = () => {};
beforeEach(() => resetUpstreamHealth());
afterEach(() => restore());

const ok = (data) => new Response(JSON.stringify({ data }), { status: 200 });
let n = 0;
const uniq = (p) => `${p}_${++n}`;

// ------------------------------------------------------------------ Twitch GQL
test("a good Twitch response returns its data and marks Twitch healthy", async () => {
  restore = mockFetch(() => ok({ hello: "world" }));
  assert.deepEqual(await twitchGqlFetch("query { x }"), { hello: "world" });
  assert.equal(getUpstreamState("twitch"), "ok");
});

test("requests carry a timeout signal, the client id and a JSON body", async () => {
  restore = mockFetch(() => ok({}));
  await twitchGqlFetch("query { x }", { a: 1 });
  const { init } = restore.calls[0];
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.method, "POST");
  assert.ok(init.headers["Client-ID"]);
  assert.deepEqual(JSON.parse(init.body), { variables: { a: 1 }, query: "query { x }" });
});

test("5xx responses and network errors count as outages; three in a row mean 'down'", async () => {
  restore = mockFetch(() => new Response("bad gateway", { status: 502 }));
  await assert.rejects(twitchGqlFetch("q"), /HTTP 502/);
  assert.equal(getUpstreamState("twitch"), "degraded");
  restore();
  restore = mockFetch(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(twitchGqlFetch("q"), /fetch failed/);
  await assert.rejects(twitchGqlFetch("q"), /fetch failed/);
  assert.equal(getUpstreamState("twitch"), "down");
  assert.equal(getOutages()[0].name, "twitch");
});

test("a timeout is reported as an outage", async () => {
  restore = mockFetch(() => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; });
  await assert.rejects(twitchGqlFetch("q"));
  assert.equal(getUpstreamState("twitch"), "degraded");
});

test("once Twitch is down the circuit opens: calls fail fast without touching the network", async () => {
  restore = mockFetch(() => new Response("x", { status: 503 }));
  for (let i = 0; i < 3; i++) await assert.rejects(twitchGqlFetch("q"));
  const before = restore.calls.length;
  await assert.rejects(twitchGqlFetch("q"), /currently unreachable/);
  assert.equal(restore.calls.length, before);
});

test("after the cooldown a probe goes through and a success closes the circuit", async () => {
  for (let i = 0; i < 3; i++) reportUpstreamFailure("twitch", "x", Date.now() - 120_000);
  restore = mockFetch(() => ok({ back: true }));
  assert.deepEqual(await twitchGqlFetch("q"), { back: true });
  assert.equal(restore.calls.length, 1);
  assert.equal(getUpstreamState("twitch"), "ok");
});

test("429 rate limiting counts as trouble, but a 4xx or a GraphQL error means Twitch is up", async () => {
  restore = mockFetch(() => new Response("slow down", { status: 429 }));
  await assert.rejects(twitchGqlFetch("q"));
  assert.equal(getUpstreamState("twitch"), "degraded");
  restore();

  resetUpstreamHealth();
  restore = mockFetch(() => new Response("bad request", { status: 400 }));
  await assert.rejects(twitchGqlFetch("q"), /HTTP 400/);
  assert.equal(getUpstreamState("twitch"), "ok");
  restore();

  restore = mockFetch(() => ({ errors: [{ message: "PersistedQueryNotFound" }] }));
  await assert.rejects(twitchGqlFetch("q"), /PersistedQueryNotFound/);
  assert.equal(getUpstreamState("twitch"), "ok");
});

test("live status is cached briefly, failures are not cached, and errors degrade to 'nobody live'", async () => {
  const a = uniq("live_a");
  const b = uniq("live_b");
  restore = mockFetch(() => { throw new Error("down"); });
  assert.deepEqual(await getLiveStreams([a, b]), {});
  restore();

  restore = mockFetch(() => ok({ users: [{ login: a, stream: { id: "9", title: "t", game: { name: "g" } } }, { login: b, stream: null }] }));
  const live = await getLiveStreams([b, a]); // order must not matter
  assert.equal(live[a].isLive, true);
  assert.equal(live[b].isLive, false);
  await getLiveStreams([a, b]);
  assert.equal(restore.calls.length, 1, "second call is served from the 30s cache");
});

// ------------------------------------------------------------------ VODVOD
const vodvodItem = (over = {}) => ({
  Metadata: { Public: { Bool: false }, StreamID: 12345678901, TitleAtStart: "Secret", StartTime: "2026-09-01T10:00:00Z", HlsDurationSeconds: { Float64: 1234.6 }, MaxViews: 7 },
  Link: "/channels/x/1/index.m3u8",
  ...over,
});

test("VODVOD: only non-public streams are returned, with proxied playlist links", async () => {
  const login = uniq("vv_ok");
  const publicOne = vodvodItem({ Metadata: { Public: { Bool: true }, StreamID: 11111111111 } });
  restore = mockFetch(() => [vodvodItem(), publicOne]);
  const items = await getChannelUnlistedStreams(login, { streamerDisplayName: "Display" });
  assert.equal(items.length, 1);
  const [it] = items;
  assert.deepEqual([it.id, it.title, it.isUnlisted, it.lengthSeconds, it.owner.displayName], ["12345678901", "Secret", true, 1235, "Display"]);
  assert.equal(it.masterPlaylistUrl, "https://api.vodvod.top/channels/x/1/index.m3u8");
  assert.equal(it.proxiedUrl, `/api/proxy/m3u8?url=${encodeURIComponent(it.masterPlaylistUrl)}`);
  assert.equal(getUpstreamState("vodvod"), "ok");
});

test("VODVOD: each broadcast carries whether its playlist is ready, still processing, or has no data", async () => {
  const login = uniq("vv_avail");
  const withBytes = (id, bytes, start = new Date().toISOString()) =>
    vodvodItem({ Metadata: { ...vodvodItem().Metadata, StreamID: id, BytesFound: bytes, StartTime: start } });
  restore = mockFetch(() => [
    withBytes(11111111111, { Bool: true, Valid: true }),
    withBytes(22222222222, { Bool: false, Valid: false }),
    withBytes(33333333333, { Bool: false, Valid: true }, new Date(Date.now() - 200 * 3600_000).toISOString()),
    withBytes(44444444444, { Bool: false, Valid: true }), // checked-empty but only just started: still processing
  ]);
  const items = await getChannelUnlistedStreams(login);
  assert.deepEqual(
    Object.fromEntries(items.map((i) => [i.id, i.availability])),
    { 11111111111: "ready", 22222222222: "processing", 33333333333: "no_data", 44444444444: "processing" }
  );
});

test("VODVOD: records without BytesFound (older format) count as ready", async () => {
  restore = mockFetch(() => [vodvodItem()]);
  assert.equal((await getChannelUnlistedStreams(uniq("vv_old")))[0].availability, "ready");
});

test("VODVOD: a broadcast that has no playlist link yet is kept as 'processing' with no URL instead of being dropped", async () => {
  const login = uniq("vv_nolink");
  restore = mockFetch(() => [vodvodItem({ Link: "" }), vodvodItem({ Link: undefined }), vodvodItem({ Link: 42 })]);
  const items = await getChannelUnlistedStreams(login);
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.equal(it.availability, "processing");
    assert.equal(it.masterPlaylistUrl, "");
    assert.equal(it.proxiedUrl, "");
    assert.equal(it.title, "Secret"); // the rest of the information is still there
  }
});

test("VODVOD: links that are not plain relative paths are dropped", async () => {
  const login = uniq("vv_links");
  restore = mockFetch(() => [
    vodvodItem({ Link: "//evil.com/x.m3u8" }),
    vodvodItem({ Link: "https://evil.com/x.m3u8" }),
    vodvodItem({ Link: "/ok\\..\\bad" }),
    vodvodItem({ Link: "/fine/path.m3u8" }),
  ]);
  const items = await getChannelUnlistedStreams(login);
  assert.deepEqual(items.map((i) => i.masterPlaylistUrl), ["https://api.vodvod.top/fine/path.m3u8"]);
});

test("VODVOD: a 404 means 'not indexed', not an outage, and is cached", async () => {
  const login = uniq("vv_404");
  restore = mockFetch(() => new Response("not found", { status: 404 }));
  assert.deepEqual(await getChannelUnlistedStreams(login), []);
  assert.deepEqual(await getChannelUnlistedStreams(login), []);
  assert.equal(restore.calls.length, 1);
  assert.equal(getUpstreamState("vodvod"), "ok");
});

test("VODVOD: 5xx and network errors throw, are reported, and are never cached", async () => {
  const login = uniq("vv_down");
  restore = mockFetch(() => new Response("oops", { status: 503 }));
  await assert.rejects(getChannelUnlistedStreams(login), /503/);
  assert.equal(getUpstreamState("vodvod"), "degraded");
  restore();

  restore = mockFetch(() => { throw new Error("socket hang up"); });
  await assert.rejects(getChannelUnlistedStreams(login), /socket hang up/);
  restore();

  restore = mockFetch(() => []);
  assert.deepEqual(await getChannelUnlistedStreams(login), []); // recovered immediately, nothing stale cached
  assert.equal(getUpstreamState("vodvod"), "ok");
});

test("VODVOD: with the circuit open no request is made", async () => {
  for (let i = 0; i < 3; i++) reportUpstreamFailure("vodvod", "x");
  restore = mockFetch(() => []);
  await assert.rejects(getChannelUnlistedStreams(uniq("vv_open")), /currently unreachable/);
  assert.equal(restore.calls.length, 0);
});

// ------------------------------------------------------------------ TwitchTracker
function trackerPage(rows) {
  const complicator = Object.fromEntries(rows.map((r) => [r.date, { id: r.id, games: [{ id: 1, name: "Chat" }] }]));
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
  const meta = `${b64(complicator)}!${b64(["complicator"])}`;
  const tr = rows.map((r) => `<tr><td data-order="${r.date}">d</td><td class="status x">${r.title}</td></tr>`).join("");
  return `<html><meta id="ecs" content="${meta}"><table>${tr}</table></html>`;
}

test("TwitchTracker: its obfuscated stream table is decoded into streams", async () => {
  const login = uniq("tt_ok");
  restore = mockFetch(() => new Response(trackerPage([
    { date: "2026-09-01 10:00", id: 12345678901, title: "First stream" },
    { date: "2026-09-02 11:30", id: 12345678902, title: "Second <b>stream</b>" },
  ]), { status: 200 }));
  const streams = await getTwitchTrackerStreams(login);
  assert.equal(streams.length, 2);
  assert.deepEqual(
    [streams[0].streamId, streams[0].title, streams[0].timestamp, streams[0].games[0].name],
    ["12345678901", "First stream", Date.UTC(2026, 8, 1, 10, 0), "Chat"]
  );
  assert.equal(streams[1].title, "Second stream"); // markup stripped
  assert.equal(getUpstreamState("twitchtracker"), "ok");
});

test("TwitchTracker: being blocked yields no streams, is reported, and is not retried for every caller", async () => {
  const login = uniq("tt_blocked");
  restore = mockFetch(() => new Response("Just a moment...", { status: 403 }));
  assert.deepEqual(await getTwitchTrackerStreams(login), []);
  assert.equal(getUpstreamState("twitchtracker"), "degraded");
  assert.deepEqual(await getTwitchTrackerStreams(login), []);
  assert.equal(restore.calls.length, 1, "the failure is cached so the site is not hammered");
});

test("TwitchTracker: an unexpected page layout counts as a failure", async () => {
  restore = mockFetch(() => new Response("<html>no data here</html>", { status: 200 }));
  assert.deepEqual(await getTwitchTrackerStreams(uniq("tt_layout")), []);
  assert.equal(getUpstreamState("twitchtracker"), "degraded");
});

test("TwitchTracker: network failures and an open circuit both degrade to an empty list", async () => {
  restore = mockFetch(() => { throw new Error("ETIMEDOUT"); });
  assert.deepEqual(await getTwitchTrackerStreams(uniq("tt_net")), []);
  restore();

  for (let i = 0; i < 3; i++) reportUpstreamFailure("twitchtracker", "x");
  restore = mockFetch(() => new Response(trackerPage([]), { status: 200 }));
  assert.deepEqual(await getTwitchTrackerStreams(uniq("tt_open")), []);
  assert.equal(restore.calls.length, 0);
});

test("TwitchTracker: invalid logins never reach the network", async () => {
  restore = mockFetch(() => new Response("", { status: 200 }));
  assert.deepEqual(await getTwitchTrackerStreams("../../etc"), []);
  assert.equal(restore.calls.length, 0);
});
