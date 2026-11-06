import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

const req = (ip, headers = {}) =>
  new NextRequest("http://localhost/api/x", { headers: ip ? { "x-forwarded-for": ip, ...headers } : headers });

test("allows up to maxRequests then blocks with a positive retry time", () => {
  const opts = { prefix: "t_limit", maxRequests: 3, windowMs: 60_000 };
  const results = [1, 2, 3, 4].map(() => checkRateLimit(req("10.0.0.1"), opts));
  assert.deepEqual(results.map((r) => r.success), [true, true, true, false]);
  assert.equal(results[0].remaining, 2);
  assert.equal(results[3].remaining, 0);
  assert.ok(results[3].reset >= 1);
});

test("different clients and different prefixes are limited independently", () => {
  const opts = { prefix: "t_indep", maxRequests: 1, windowMs: 60_000 };
  assert.equal(checkRateLimit(req("10.0.0.2"), opts).success, true);
  assert.equal(checkRateLimit(req("10.0.0.2"), opts).success, false);
  assert.equal(checkRateLimit(req("10.0.0.3"), opts).success, true); // another IP
  assert.equal(checkRateLimit(req("10.0.0.2"), { ...opts, prefix: "t_indep_other" }).success, true); // another route
});

test("the window resets after windowMs", async () => {
  const opts = { prefix: "t_reset", maxRequests: 1, windowMs: 40 };
  assert.equal(checkRateLimit(req("10.0.0.4"), opts).success, true);
  assert.equal(checkRateLimit(req("10.0.0.4"), opts).success, false);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(checkRateLimit(req("10.0.0.4"), opts).success, true);
});

test("getClientIp uses the first X-Forwarded-For hop, then X-Real-IP, then a default", () => {
  assert.equal(getClientIp(req("1.2.3.4, 5.6.7.8")), "1.2.3.4");
  assert.equal(getClientIp(req(null, { "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(getClientIp(req(null)), "127.0.0.1");
});

test("getClientIp strips illegal characters and caps the length", () => {
  // only [a-fA-F0-9.:%] survive sanitisation
  assert.equal(getClientIp(req("1.2.3.4<script>")), "1.2.3.4c");
  assert.equal(getClientIp(req("a".repeat(200))).length, 45);
});

test("TRUST_PROXY=false ignores spoofable forwarding headers", () => {
  process.env.TRUST_PROXY = "false";
  try {
    assert.equal(getClientIp(req("6.6.6.6")), "127.0.0.1");
    const opts = { prefix: "t_spoof", maxRequests: 1, windowMs: 60_000 };
    assert.equal(checkRateLimit(req("7.7.7.7"), opts).success, true);
    // rotating the header must NOT grant a fresh allowance
    assert.equal(checkRateLimit(req("8.8.8.8"), opts).success, false);
  } finally {
    process.env.TRUST_PROXY = "true";
  }
});
