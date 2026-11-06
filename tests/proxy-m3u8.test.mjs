import { request, mockFetch } from "./helpers/app.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET, OPTIONS } from "@/app/api/proxy/m3u8/route";

const proxy = (target, opts) => GET(request(`/api/proxy/m3u8?url=${encodeURIComponent(target)}`, opts));
const ALLOWED = "https://d2vjef5jvl6bfs.cloudfront.net/vod123/chunked/index-dvr.m3u8";

let restore = () => {};
afterEach(() => restore());

test("a missing url is a 400", async () => {
  assert.equal((await GET(request("/api/proxy/m3u8"))).status, 400);
});

test("only HTTPS targets are accepted", async () => {
  restore = mockFetch(() => ({}));
  for (const target of ["http://d2vjef5jvl6bfs.cloudfront.net/x.m3u8", "ftp://x.cloudfront.net/a", "file:///etc/passwd", "javascript:alert(1)"]) {
    assert.equal((await proxy(target)).status, 400, target);
  }
  assert.equal(restore.calls.length, 0, "nothing may be fetched for a rejected target");
});

test("malformed urls fail safely without fetching", async () => {
  restore = mockFetch(() => ({}));
  const res = await proxy("not a url at all");
  assert.equal(res.status, 502);
  assert.equal(restore.calls.length, 0);
});

test("hosts outside the allowlist are refused (SSRF), including lookalikes and tricks", async () => {
  restore = mockFetch(() => ({}));
  const blocked = [
    "https://evil.com/a.m3u8",
    "https://localhost/a.m3u8",
    "https://127.0.0.1/a.m3u8",
    "https://[::1]/a.m3u8",
    "https://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://10.0.0.5/a", "https://192.168.1.1/a", "https://172.16.0.1/a",
    "https://2130706433/a", // decimal form of 127.0.0.1
    "https://cloudfront.net.evil.com/a.m3u8", // allowed name as a prefix of the attacker's domain
    "https://evilcloudfront.net/a.m3u8", // suffix without the dot boundary
    "https://jtvnw.net.evil.com/a",
    "https://d123.cloudfront.net@evil.com/a.m3u8", // userinfo trick: the real host is evil.com
    "https://evil.com#@d123.cloudfront.net/a",
    "https://evil.com/.cloudfront.net",
  ];
  for (const target of blocked) {
    const res = await proxy(target);
    assert.equal(res.status, 403, target);
  }
  assert.equal(restore.calls.length, 0, "no request may leave the server for a blocked host");
});

test("allowed hosts are fetched with manual redirects (so redirects can be re-validated)", async () => {
  restore = mockFetch(() => new Response("#EXTM3U\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } }));
  for (const target of [ALLOWED, "https://usher.ttvnw.net/a.m3u8", "https://vod-metro.jtvnw.net/a.m3u8", "https://api.vodvod.top/x.m3u8"]) {
    assert.equal((await proxy(target)).status, 200, target);
  }
  assert.ok(restore.calls.every((c) => c.init.redirect === "manual"));
});

test("playlists are rewritten so every segment and key goes back through the proxy", async () => {
  const playlist = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    "#EXTINF:10.0,",
    "0.ts",
    "#EXTINF:10.0,",
    "https://d2vjef5jvl6bfs.cloudfront.net/vod123/chunked/1.ts",
    "",
  ].join("\n");
  restore = mockFetch(() => new Response(playlist, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } }));

  const res = await proxy(ALLOWED);
  assert.equal(res.headers.get("content-type"), "application/vnd.apple.mpegurl");
  assert.match(res.headers.get("cache-control"), /no-store/);
  const lines = (await res.text()).split("\n");
  const base = "https://d2vjef5jvl6bfs.cloudfront.net/vod123/chunked/";
  assert.equal(lines[0], "#EXTM3U");
  assert.equal(lines[1], `#EXT-X-KEY:METHOD=AES-128,URI="/api/proxy/m3u8?url=${encodeURIComponent(base + "key.bin")}"`);
  assert.equal(lines[3], `/api/proxy/m3u8?url=${encodeURIComponent(base + "0.ts")}`);
  assert.equal(lines[5], `/api/proxy/m3u8?url=${encodeURIComponent(base + "1.ts")}`);
});

test("a redirect to an allowed host is followed once", async () => {
  let n = 0;
  restore = mockFetch(() =>
    n++ === 0
      ? new Response(null, { status: 302, headers: { location: "https://other.cloudfront.net/final.m3u8" } })
      : new Response("#EXTM3U\n", { status: 200, headers: { "content-type": "application/x-mpegURL" } })
  );
  assert.equal((await proxy(ALLOWED)).status, 200);
  assert.deepEqual(restore.calls.map((c) => c.url), [ALLOWED, "https://other.cloudfront.net/final.m3u8"]);
});

test("a redirect to a disallowed host or protocol is refused without following it", async () => {
  for (const location of ["https://evil.com/steal", "http://other.cloudfront.net/downgrade", "https://169.254.169.254/"]) {
    restore = mockFetch(() => new Response(null, { status: 302, headers: { location } }));
    const res = await proxy(ALLOWED);
    assert.equal(res.status, 403, location);
    assert.equal(restore.calls.length, 1, "the redirect target must not be requested");
    restore();
  }
});

test("redirect loops and redirects without a location are 502s", async () => {
  restore = mockFetch(() => new Response(null, { status: 302, headers: { location: "https://other.cloudfront.net/again" } }));
  assert.equal((await proxy(ALLOWED)).status, 502); // second hop redirects again
  assert.equal(restore.calls.length, 2);
  restore();
  restore = mockFetch(() => new Response(null, { status: 301 }));
  assert.equal((await proxy(ALLOWED)).status, 502);
});

test("upstream errors keep their status code", async () => {
  restore = mockFetch(() => new Response("nope", { status: 404 }));
  assert.equal((await proxy(ALLOWED)).status, 404);
  restore();
  restore = mockFetch(() => { throw new Error("connect ECONNREFUSED"); });
  const res = await proxy(ALLOWED);
  assert.equal(res.status, 502);
  assert.equal((await res.text()).includes("ECONNREFUSED"), false); // no internal detail leaked
});

test("media segments stream through with range support", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  restore = mockFetch(() => new Response(bytes, { status: 206, headers: { "content-type": "video/mp2t", "content-range": "bytes 0-4/100" } }));
  const res = await proxy("https://d2vjef5jvl6bfs.cloudfront.net/vod123/chunked/0.ts", { headers: { range: "bytes=0-4" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-4/100");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(restore.calls[0].init.headers.Range, "bytes=0-4");
});

test("OPTIONS answers CORS preflight", async () => {
  const res = await OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("the proxy is rate limited per client", async () => {
  const ip = "192.0.2.77";
  let last;
  for (let i = 0; i < 201; i++) last = await GET(request("/api/proxy/m3u8", { ip }));
  assert.equal(last.status, 429);
});
