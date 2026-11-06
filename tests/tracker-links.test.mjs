import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractStreamId, getTwitchTrackerUrl } from "@/lib/twitch/tracker";
import { getVideoLink } from "@/lib/twitch/links";
import { matchTwitchTrackerStream } from "@/lib/twitch/tracker-resolver";

test("extractStreamId prefers a confirmed TwitchTracker id, then streamId", () => {
  assert.equal(extractStreamId({ twitchTrackerStreamId: "123456789", streamId: "999999999" }), "123456789");
  assert.equal(extractStreamId({ twitchTrackerStreamId: "123", streamId: "987654321" }), "987654321"); // too short -> ignored
  assert.equal(extractStreamId({ streamId: "987654321" }), "987654321");
});

test("extractStreamId parses the id out of Twitch preview URLs", () => {
  const url = "https://d1.cloudfront.net/abc123_streamer_12345678901_1700000000/storyboards/x-strip-0.jpg";
  assert.equal(extractStreamId({ seekPreviewsURL: url }), "12345678901");
  assert.equal(extractStreamId({ previewThumbnailURL: url }), "12345678901");
});

test("extractStreamId does not mistake a 10-digit VOD id for a stream id", () => {
  assert.equal(extractStreamId({ id: "2869751829" }), null);
  assert.equal(extractStreamId({ id: "123456789012" }), "123456789012"); // 12+ digits is a stream id
  assert.equal(extractStreamId({ id: "12345678", isUnlisted: true }), "12345678");
  assert.equal(extractStreamId(null), null);
  assert.equal(extractStreamId({}), null);
});

test("getTwitchTrackerUrl builds direct, fallback and redirect links", () => {
  assert.equal(getTwitchTrackerUrl(undefined), "https://twitchtracker.com");
  assert.equal(getTwitchTrackerUrl("bad login!"), "https://twitchtracker.com");
  assert.equal(getTwitchTrackerUrl("xqc"), "https://twitchtracker.com/xqc/streams");
  assert.equal(getTwitchTrackerUrl("xqc", "12345678901"), "https://twitchtracker.com/xqc/streams/12345678901");
  assert.equal(getTwitchTrackerUrl("xqc", "123"), "https://twitchtracker.com/xqc/streams"); // too short
  assert.equal(
    getTwitchTrackerUrl("xqc", { trackerUrl: "https://twitchtracker.com/xqc/streams/42" }),
    "https://twitchtracker.com/xqc/streams/42"
  );
  assert.equal(
    getTwitchTrackerUrl("xqc", { twitchTrackerStreamId: "12345678901" }),
    "https://twitchtracker.com/xqc/streams/12345678901"
  );
});

test("getTwitchTrackerUrl routes unconfirmed ids through the safe redirect with metadata", () => {
  const url = getTwitchTrackerUrl("xqc", { streamId: "12345678901", title: "My Title", id: "555", createdAt: "2026-09-01T10:00:00Z" });
  assert.ok(url.startsWith("/api/twitch/tracker-redirect?login=xqc&streamId=12345678901"), url);
  assert.ok(url.includes("title=My%20Title"));
  assert.ok(url.includes("vodId=555"));
});

test("getVideoLink: public VODs link to twitch.tv by numeric id", () => {
  assert.equal(getVideoLink({ id: "2869751829" }), "https://www.twitch.tv/videos/2869751829");
  assert.equal(getVideoLink(null), "");
});

test("getVideoLink: unlisted streams link to their m3u8, decoding proxied urls", () => {
  assert.equal(getVideoLink({ isUnlisted: true, masterPlaylistUrl: "https://api.vodvod.top/a.m3u8" }), "https://api.vodvod.top/a.m3u8");
  assert.equal(
    getVideoLink({ broadcastType: "UNLISTED", proxiedUrl: "/api/proxy/m3u8?url=https%3A%2F%2Fx.com%2Fa.m3u8" }),
    "https://x.com/a.m3u8"
  );
  // no playlist available: falls back to a TwitchTracker link
  assert.ok(getVideoLink({ isUnlisted: true, owner: { login: "xqc" } }).includes("twitchtracker.com/xqc"));
});

test("getVideoLink: non-numeric ids fall back to an m3u8 when present", () => {
  assert.equal(getVideoLink({ id: "abc", m3u8Url: "https://x.com/p.m3u8" }), "https://x.com/p.m3u8");
});

const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
const streams = [
  { streamId: "111", timestamp: T0, title: "Lots to do today", date: "d1" },
  { streamId: "222", timestamp: T0 + 30 * 3600_000, title: "Lots to do today", date: "d2" },
];

test("matchTwitchTrackerStream: empty list gives null", () => {
  assert.equal(matchTwitchTrackerStream([], { title: "x" }), null);
});

test("matchTwitchTrackerStream: a direct stream id wins", () => {
  assert.equal(matchTwitchTrackerStream(streams, { streamId: "222" })?.streamId, "222");
});

test("matchTwitchTrackerStream: matches title within 6 hours and picks the right day", () => {
  const item = { title: "Lots to do today", createdAt: new Date(T0 + 10 * 60_000).toISOString() };
  assert.equal(matchTwitchTrackerStream(streams, item)?.streamId, "111");
  const nextDay = { title: "Lots to do today", createdAt: new Date(T0 + 30 * 3600_000 + 60_000).toISOString() };
  assert.equal(matchTwitchTrackerStream(streams, nextDay)?.streamId, "222");
});

test("matchTwitchTrackerStream: a stream far from the item's start time never matches", () => {
  const item = { title: "Lots to do today", createdAt: new Date(T0 + 12 * 3600_000).toISOString() };
  assert.equal(matchTwitchTrackerStream(streams, item), null);
});

test("matchTwitchTrackerStream: a renamed stream matches on a very close start time", () => {
  const renamed = [{ streamId: "333", timestamp: T0, title: "", date: "d" }];
  assert.equal(matchTwitchTrackerStream(renamed, { title: "Totally new title", startTime: new Date(T0 + 5 * 60_000).toISOString() })?.streamId, "333");
  assert.equal(matchTwitchTrackerStream(renamed, { title: "Totally new title", startTime: new Date(T0 + 20 * 60_000).toISOString() }), null);
});
