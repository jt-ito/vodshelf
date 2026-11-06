import { request, mockFetch } from "./helpers/app.mjs";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route caches images under <cwd>/.cache/categories. Run from a throwaway directory so tests never touch the project.
const originalCwd = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-test-"));
process.chdir(sandbox);
const { GET } = await import("@/app/api/categories/thumbnail/[id]/route");

const CACHE = path.join(sandbox, ".cache", "categories");
const bigImage = () => new Response(new Uint8Array(7000).fill(1), { status: 200, headers: { "content-type": "image/jpeg" } });
const thumb = (id, query = "", opts) => GET(request(`/api/categories/thumbnail/x${query}`, opts), { params: { id } });

let restore = () => {};
afterEach(() => restore());

test("custom image urls must be https on Twitch's CDN (SSRF)", async () => {
  restore = mockFetch(() => bigImage());
  const bad = [
    "http://static-cdn.jtvnw.net/a.jpg", // not https
    "https://evil.com/a.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/a.jpg",
    "https://static-cdn.jtvnw.net.evil.com/a.jpg", // lookalike
    "https://static-cdn.jtvnw.net@evil.com/a.jpg", // userinfo trick
    "https://evil.com/static-cdn.jtvnw.net",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ];
  for (const url of bad) {
    const res = await thumb("ssrf1", `?url=${encodeURIComponent(url)}`);
    assert.equal(res.status, 400, url);
  }
  assert.equal(restore.calls.length, 0, "no outbound request for a rejected url");
});

test("an unseen thumbnail is downloaded from Twitch's CDN, cached on disk and served immutably", async () => {
  restore = mockFetch(() => bigImage());
  const res = await thumb("509658");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.match(res.headers.get("cache-control"), /immutable/);
  assert.equal((await res.arrayBuffer()).byteLength, 7000);
  assert.ok(fs.existsSync(path.join(CACHE, "509658.jpg")));
  assert.ok(restore.calls.every((c) => new URL(c.url).hostname === "static-cdn.jtvnw.net"));
  const downloads = restore.calls.length;

  // second request comes from disk, no network
  const again = await thumb("509658");
  assert.equal(again.status, 200);
  assert.equal(restore.calls.length, downloads);
});

test("a valid custom Twitch url is requested first, resized to the box-art dimensions", async () => {
  restore = mockFetch(() => bigImage());
  const res = await thumb("custom1", `?url=${encodeURIComponent("https://static-cdn.jtvnw.net/ttv-boxart/123-52x72.jpg")}`);
  assert.equal(res.status, 200);
  assert.equal(restore.calls[0].url, "https://static-cdn.jtvnw.net/ttv-boxart/123-285x380.jpg");
});

test("ids are reduced to safe characters so they cannot escape the cache directory", async () => {
  restore = mockFetch(() => bigImage());
  assert.equal((await thumb("../../escape")).status, 200);
  assert.ok(fs.existsSync(path.join(CACHE, "escape.jpg")));
  assert.equal(fs.existsSync(path.join(sandbox, "escape.jpg")), false);
  assert.equal(fs.existsSync(path.join(sandbox, "..", "escape.jpg")), false);
  assert.equal((await thumb("../..//")).status, 400); // nothing left after sanitising
});

test("tiny images and Twitch's 404 placeholder are not accepted or cached", async () => {
  restore = mockFetch(() => new Response(new Uint8Array(100), { status: 200 }));
  assert.equal((await thumb("tiny1")).status, 404);
  assert.equal(fs.existsSync(path.join(CACHE, "tiny1.jpg")), false);
  restore();

  restore = mockFetch(() => new Response(new Uint8Array(7000), { status: 200, headers: { "x-404-redirect": "true" } }));
  assert.equal((await thumb("placeholder1")).status, 404);
  restore();

  restore = mockFetch(() => new Response("not found", { status: 404 }));
  assert.equal((await thumb("missing1")).status, 404);
  restore();

  restore = mockFetch(() => { throw new Error("network"); });
  assert.equal((await thumb("neterr1")).status, 404);
});

test("the _IGDB variant of an id is tried as a fallback", async () => {
  restore = mockFetch((url) => (url.includes("_IGDB") ? bigImage() : new Response("no", { status: 404 })));
  const res = await thumb("alt42");
  assert.equal(res.status, 200);
  assert.ok(restore.calls.some((c) => c.url.includes("alt42_IGDB")));
});

test("concurrent requests for the same new thumbnail share one download", async () => {
  restore = mockFetch(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return bigImage();
  });
  const results = await Promise.all([thumb("shared1"), thumb("shared1"), thumb("shared1")]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(restore.calls.filter((c) => c.url.includes("shared1-285x380")).length, 1);
});

test("thumbnail requests are rate limited per client", async () => {
  restore = mockFetch(() => bigImage());
  const ip = "192.0.2.88";
  let last;
  for (let i = 0; i < 301; i++) last = await GET(request("/api/categories/thumbnail/x?url=http://bad", { ip }), { params: { id: "rl1" } });
  assert.equal(last.status, 429);
});

after(() => {
  process.chdir(originalCwd); // a process cannot delete its own working directory (Windows)
  fs.rmSync(sandbox, { recursive: true, force: true });
});
