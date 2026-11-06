import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { getSnapshot, pruneSnapshots, VOD_SNAPSHOTS_DDL } from "../lib/twitch/vod-snapshots.ts";

const FRESH = 1000;
const MAX_STALE = 100_000;

async function setup() {
  const db = createClient({ url: ":memory:" });
  await db.execute(VOD_SNAPSHOTS_DDL);
  let t = 1_000_000;
  const opts = { freshMs: FRESH, maxStaleMs: MAX_STALE, now: () => t };
  return { db, opts, advance: (ms) => (t += ms) };
}

test("missing snapshot: builds, stores, and a fresh read does not rebuild", async () => {
  const { db, opts } = await setup();
  let builds = 0;
  const build = async () => (++builds, ["a"]);

  const first = await getSnapshot(db, "k1", build, opts);
  assert.deepEqual(first, { data: ["a"], stale: false, refreshing: null, fetchedAt: 1_000_000 });

  const second = await getSnapshot(db, "k1", build, opts);
  assert.equal(second.stale, false);
  assert.equal(builds, 1);
});

test("stale snapshot is served immediately while a background refresh updates it", async () => {
  const { db, opts, advance } = await setup();
  await getSnapshot(db, "k2", async () => ["old"], opts);
  advance(FRESH + 1);

  const res = await getSnapshot(db, "k2", async () => ["new"], opts);
  assert.deepEqual(res.data, ["old"]);
  assert.equal(res.stale, true);
  await res.refreshing;

  const next = await getSnapshot(db, "k2", async () => ["never"], opts);
  assert.deepEqual(next.data, ["new"]);
  assert.equal(next.stale, false);
});

test("a failed background refresh keeps the old snapshot", async () => {
  const { db, opts, advance } = await setup();
  await getSnapshot(db, "k3", async () => ["good"], opts);
  advance(FRESH + 1);

  const res = await getSnapshot(db, "k3", async () => { throw new Error("upstream down"); }, opts);
  assert.deepEqual(res.data, ["good"]);
  await res.refreshing; // must not reject

  const again = await getSnapshot(db, "k3", async () => ["later"], { ...opts, now: () => 1_000_000 + FRESH + 1 });
  assert.deepEqual(again.data, ["good"]);
});

test("no snapshot and a failing build rejects", async () => {
  const { db, opts } = await setup();
  await assert.rejects(getSnapshot(db, "k4", async () => { throw new Error("down"); }, opts), /down/);
});

test("a snapshot older than maxStale is rebuilt synchronously", async () => {
  const { db, opts, advance } = await setup();
  await getSnapshot(db, "k5", async () => ["ancient"], opts);
  advance(MAX_STALE + 1);
  const res = await getSnapshot(db, "k5", async () => ["rebuilt"], opts);
  assert.deepEqual(res.data, ["rebuilt"]);
  assert.equal(res.stale, false);
  assert.equal(res.fetchedAt, 1_000_000 + MAX_STALE + 1);
});

test("concurrent requests for the same key share one build", async () => {
  const { db, opts } = await setup();
  let builds = 0;
  const build = async () => {
    builds++;
    await new Promise((r) => setTimeout(r, 20));
    return ["x"];
  };
  const [a, b, c] = await Promise.all([
    getSnapshot(db, "k6", build, opts),
    getSnapshot(db, "k6", build, opts),
    getSnapshot(db, "k6", build, opts),
  ]);
  assert.equal(builds, 1);
  assert.deepEqual([a.data, b.data, c.data], [["x"], ["x"], ["x"]]);
});

test("pruneSnapshots removes only old rows", async () => {
  const { db, opts, advance } = await setup();
  await getSnapshot(db, "old", async () => [1], opts);
  advance(50_000);
  await getSnapshot(db, "new", async () => [2], opts);
  await pruneSnapshots(db, 10_000, 1_000_000 + 50_000);
  const rows = await db.execute("SELECT key FROM vod_snapshots");
  assert.deepEqual(rows.rows.map((r) => r.key), ["new"]);
});

test("the build receives the previous snapshot so an outage can keep what was known", async () => {
  const { db, opts, advance } = await setup();
  const seen = [];
  await getSnapshot(db, "k8", async (prev) => (seen.push(prev), ["v1"]), opts);
  advance(FRESH + 1);
  const res = await getSnapshot(db, "k8", async (prev) => (seen.push(prev), [...prev, "v2"]), opts);
  assert.deepEqual(res.data, ["v1"]); // served instantly
  assert.equal(res.fetchedAt, 1_000_000); // and reports how old it is
  await res.refreshing;
  assert.deepEqual(seen, [null, ["v1"]]);
  const next = await getSnapshot(db, "k8", async () => ["x"], opts);
  assert.deepEqual(next.data, ["v1", "v2"]);
});
