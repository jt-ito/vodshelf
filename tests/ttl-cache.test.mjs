import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { serverCache } from "@/lib/cache/ttl-cache";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("set/get returns the value until it expires", async () => {
  serverCache.set("t:expiry", { a: 1 }, 30);
  assert.deepEqual(serverCache.get("t:expiry"), { a: 1 });
  await sleep(50);
  assert.equal(serverCache.get("t:expiry"), null);
});

test("fetchOrGet caches the result for the TTL", async () => {
  let calls = 0;
  const fn = async () => (++calls, "v");
  assert.equal(await serverCache.fetchOrGet("t:cached", 1000, fn), "v");
  assert.equal(await serverCache.fetchOrGet("t:cached", 1000, fn), "v");
  assert.equal(calls, 1);
});

test("concurrent fetchOrGet calls share one in-flight request", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    await sleep(20);
    return "shared";
  };
  const out = await Promise.all([1, 2, 3].map(() => serverCache.fetchOrGet("t:coalesce", 1000, fn)));
  assert.deepEqual(out, ["shared", "shared", "shared"]);
  assert.equal(calls, 1);
});

test("null and undefined results are not cached", async () => {
  let calls = 0;
  await serverCache.fetchOrGet("t:null", 1000, async () => (++calls, null));
  await serverCache.fetchOrGet("t:null", 1000, async () => (++calls, undefined));
  assert.equal(calls, 2);
});

test("a rejected fetch is not cached and does not wedge the key", async () => {
  await assert.rejects(serverCache.fetchOrGet("t:reject", 1000, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await serverCache.fetchOrGet("t:reject", 1000, async () => "recovered"), "recovered");
});

test("delete invalidates a cached key", async () => {
  await serverCache.fetchOrGet("t:delete", 1000, async () => "old");
  serverCache.delete("t:delete");
  assert.equal(await serverCache.fetchOrGet("t:delete", 1000, async () => "new"), "new");
});
