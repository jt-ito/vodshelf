import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const HOST = "app.example.com";
const req = (path, { method = "GET", headers = {} } = {}) =>
  new NextRequest(new URL(path, `https://${HOST}`), { method, headers: { host: HOST, ...headers } });
const passes = (res) => res.headers.get("x-middleware-next") === "1";

test("every response carries the security headers and a CSP that blocks framing", () => {
  const res = middleware(req("/"));
  assert.ok(passes(res));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src[^;]*https:\/\/gql\.twitch\.tv/);
  assert.match(csp, /worker-src 'self' blob:/); // HLS.js workers
});

test("safe methods are never CSRF-checked", () => {
  assert.ok(passes(middleware(req("/api/streamers/pinned"))));
  assert.ok(passes(middleware(req("/api/streamers/pinned", { headers: { origin: "https://evil.com" } }))));
});

test("state-changing API calls from the same origin pass", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(passes(middleware(req("/api/watch/progress", { method, headers: { origin: `https://${HOST}` } }))), method);
  }
  // referer is accepted when there is no Origin header
  assert.ok(passes(middleware(req("/api/watch/progress", { method: "POST", headers: { referer: `https://${HOST}/feed` } }))));
  // host comparison ignores case
  assert.ok(passes(middleware(req("/api/watch/progress", { method: "POST", headers: { origin: "https://APP.example.com" } }))));
});

test("cross-origin state-changing API calls are rejected with 403", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = middleware(req("/api/user", { method, headers: { origin: "https://evil.com" } }));
    assert.equal(res.status, 403, method);
    assert.match((await res.json()).error, /CSRF/);
    assert.equal(res.headers.get("x-frame-options"), "DENY"); // even error responses keep the headers
  }
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { referer: "https://evil.com/page" } })).status, 403);
  // a lookalike host must not pass a naive prefix/suffix check
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { origin: `https://${HOST}.evil.com` } })).status, 403);
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { origin: "https://evilapp.example.com" } })).status, 403);
});

test("malformed or missing Origin/Referer headers are rejected", () => {
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { origin: "null" } })).status, 403); // sandboxed iframes send "null"
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { origin: "not a url" } })).status, 403);
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { referer: "::::" } })).status, 403);
  assert.equal(middleware(req("/api/user", { method: "POST" })).status, 403);
});

test("behind a proxy the forwarded host is what Origin must match", () => {
  const forwarded = { host: "internal:3005", "x-forwarded-host": HOST };
  assert.ok(passes(middleware(req("/api/user", { method: "POST", headers: { ...forwarded, origin: `https://${HOST}` } }))));
  assert.equal(middleware(req("/api/user", { method: "POST", headers: { ...forwarded, origin: "https://internal:3005" } })).status, 403);
});

test("only /api/ paths are CSRF-checked", () => {
  assert.ok(passes(middleware(req("/some-page", { method: "POST" }))));
});
