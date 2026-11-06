import { test } from "node:test";
import assert from "node:assert/strict";
import { createWatchOverrides } from "../lib/watch/overrides.ts";

const vod = (id, isWatched = false) => ({ id, watchStatus: { isWatched, progressSeconds: 0 } });

test("a change made after the request started is re-applied over a stale response", () => {
  const o = createWatchOverrides();
  const started = Date.now();
  o.record("1", true, 100);
  const out = o.apply([vod("1"), vod("2")], started);
  assert.equal(out[0].watchStatus.isWatched, true);
  assert.equal(out[0].watchStatus.progressSeconds, 100);
  assert.equal(out[1].watchStatus.isWatched, false);
});

test("a change saved well before the request started is not forced over fresh server data", () => {
  const o = createWatchOverrides();
  o.record("1", true, 100);
  // Request started 60s after the change: the server already reflects it, and the entry is pruned
  const out = o.apply([vod("1", false)], Date.now() + 60_000);
  assert.equal(out[0].watchStatus.isWatched, false);
});

test("returns the same array when nothing is overridden", () => {
  const o = createWatchOverrides();
  const list = [vod("1")];
  assert.equal(o.apply(list, Date.now()), list);
});

test("the latest change for a VOD wins", () => {
  const o = createWatchOverrides();
  const started = Date.now();
  o.record("1", true, 100);
  o.record("1", false, 0);
  assert.equal(o.apply([vod("1", true)], started)[0].watchStatus.isWatched, false);
});
