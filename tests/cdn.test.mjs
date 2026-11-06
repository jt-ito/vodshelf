import { db, request, createUser, mockFetch } from "./helpers/app.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoryboardUrl, probeManifestUrl, probeCandidateDomains, recoverVodStreams, CLOUDFRONT_DOMAINS, STREAM_QUALITIES,
} from "@/lib/twitch/cdn-prober";
import { GET as cdnRoute } from "@/app/api/twitch/cdn/[vodId]/route";

let restore = () => {};
afterEach(() => restore());

const SPECIAL = "abc123def4_streamer_12345678901_1700000000";
const PRIMARY = CLOUDFRONT_DOMAINS[3];
const storyboard = (domain = PRIMARY) => `https://${domain}/${SPECIAL}/storyboards/777-strip-0.jpg`;
const manifest = (domain) => `https://${domain}/${SPECIAL}/chunked/index-dvr.m3u8`;

let n = 0;
const vodId = () => String(900000000 + ++n);

/** Fake CDN + Twitch: HEAD probes succeed only for the manifest URLs in `okUrls`. */
function cdn({ okUrls = [], video } = {}) {
  return mockFetch((url, init) => {
    if (init?.method === "HEAD") return new Response(null, { status: okUrls.includes(url) ? 200 : 404 });
    if (url.startsWith("https://gql.twitch.tv")) return { data: { video: video === undefined ? null : video } };
    return new Response("", { status: 404 }); // TwitchTracker scrape
  });
}
const gqlVideo = (id, extra = {}) => ({
  id, title: "Recovered VOD", createdAt: "2026-09-01T10:00:00Z", publishedAt: "2026-09-01T10:00:00Z", lengthSeconds: 3600, viewCount: 1,
  broadcastType: "ARCHIVE", seekPreviewsURL: storyboard(), previewThumbnailURL: "https://x/t.jpg",
  game: null, owner: { id: "1", login: "streamer", displayName: "Streamer" }, ...extra,
});

// ------------------------------------------------------------------ pure helpers
test("parseStoryboardUrl extracts the CDN domain and the special VOD id", () => {
  assert.deepEqual(parseStoryboardUrl(storyboard()), { domain: PRIMARY, vodSpecialId: SPECIAL });
  assert.equal(parseStoryboardUrl(""), null);
  assert.equal(parseStoryboardUrl("https://x.com/"), null);
  assert.equal(parseStoryboardUrl("not a url"), null);
});

test("probeManifestUrl is true for 200/206 and false for errors, misses and timeouts", async () => {
  for (const [status, expected] of [[200, true], [206, true], [404, false], [403, false], [500, false]]) {
    restore = mockFetch(() => new Response(null, { status }));
    assert.equal(await probeManifestUrl("https://x.cloudfront.net/a"), expected, String(status));
    restore();
  }
  restore = mockFetch(() => { throw new Error("ECONNRESET"); });
  assert.equal(await probeManifestUrl("https://x.cloudfront.net/a"), false);
  restore();
  restore = mockFetch((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  assert.equal(await probeManifestUrl("https://x.cloudfront.net/a", 20), false); // honours the timeout
});

test("probes use HEAD requests", async () => {
  restore = mockFetch(() => new Response(null, { status: 200 }));
  await probeManifestUrl("https://x.cloudfront.net/a");
  assert.equal(restore.calls[0].init.method, "HEAD");
});

test("probeCandidateDomains finds whichever known domain has the manifest", async () => {
  const winner = CLOUDFRONT_DOMAINS[5];
  restore = cdn({ okUrls: [manifest(winner)] });
  assert.equal(await probeCandidateDomains(SPECIAL), winner);
  restore();
  restore = cdn({ okUrls: [] });
  assert.equal(await probeCandidateDomains(SPECIAL), null);
});

// ------------------------------------------------------------------ recovery
test("recovery via the storyboard domain: all qualities are available and proxied", async () => {
  const id = vodId();
  restore = cdn({ okUrls: [manifest(PRIMARY)], video: gqlVideo(id) });
  const r = await recoverVodStreams(id);
  assert.equal(r.status, "available");
  assert.equal(r.sourceMethod, "storyboard_bypass");
  assert.equal(r.confirmedDomain, PRIMARY);
  assert.equal(r.vodSpecialId, SPECIAL);
  assert.equal(r.masterPlaylistUrl, manifest(PRIMARY));
  assert.equal(r.proxiedMasterUrl, `/api/proxy/m3u8?url=${encodeURIComponent(manifest(PRIMARY))}`);
  assert.equal(r.qualities.length, STREAM_QUALITIES.length);
  assert.ok(r.qualities.every((q) => q.isAvailable && q.proxiedUrl.startsWith("/api/proxy/m3u8?url=")));
  assert.deepEqual([r.title, r.streamerLogin, r.durationSeconds], ["Recovered VOD", "streamer", 3600]);
});

test("recovery falls back to probing other CDN domains", async () => {
  const id = vodId();
  const other = CLOUDFRONT_DOMAINS[6];
  restore = cdn({ okUrls: [manifest(other)], video: gqlVideo(id) });
  const r = await recoverVodStreams(id);
  assert.deepEqual([r.status, r.sourceMethod, r.confirmedDomain], ["available", "domain_probe", other]);
});

test("recovery with a storyboard but no live manifest is 'partial' and not marked available", async () => {
  const id = vodId();
  restore = cdn({ okUrls: [], video: gqlVideo(id) });
  const r = await recoverVodStreams(id);
  assert.equal(r.status, "partial");
  assert.equal(r.sourceMethod, "none");
  assert.ok(r.qualities.every((q) => !q.isAvailable && q.url.includes(SPECIAL)));
});

test("recovery for an unknown VOD is 'purged' with no links", async () => {
  const id = vodId();
  restore = cdn({ video: null });
  const r = await recoverVodStreams(id);
  assert.equal(r.status, "purged");
  assert.equal(r.masterPlaylistUrl, undefined);
  assert.ok(r.qualities.every((q) => q.url === "" && q.proxiedUrl === ""));
});

test("recovery accepts a 'v' prefixed id and caches the result", async () => {
  const id = vodId();
  restore = cdn({ okUrls: [manifest(PRIMARY)], video: gqlVideo(id) });
  const first = await recoverVodStreams(`v${id}`);
  assert.equal(first.vodId, id);
  const calls = restore.calls.length;
  await recoverVodStreams(id);
  assert.equal(restore.calls.length, calls, "second lookup is served from cache");
});

// ------------------------------------------------------------------ route
test("the CDN route validates the VOD id", async () => {
  assert.equal((await cdnRoute(request("/x"), { params: { vodId: "not-a-number" } })).status, 400);
});

test("the CDN route is publicly cacheable for anonymous users and private (with watch status) when signed in", async () => {
  const id = vodId();
  restore = cdn({ okUrls: [manifest(PRIMARY)], video: gqlVideo(id) });

  const anon = await cdnRoute(request("/x"), { params: { vodId: id } });
  assert.match(anon.headers.get("cache-control"), /public, s-maxage=600/);
  assert.equal((await anon.json()).recovery.watchStatus.isWatched, false);

  const u = await createUser();
  await db.execute({
    sql: "INSERT INTO watch_status (id, user_id, vod_id, streamer_login, is_watched, progress_seconds, total_seconds) VALUES ('cdnw', ?, ?, 'streamer', 1, 3600, 3600)",
    args: [u.id, id],
  });
  const signedIn = await cdnRoute(request("/x", { cookie: u.cookie }), { params: { vodId: id } });
  assert.equal(signedIn.headers.get("cache-control"), "private, no-cache");
  const body = await signedIn.json();
  assert.equal(body.recovery.watchStatus.isWatched, true);
  assert.equal(body.recovery.status, "available");
});
