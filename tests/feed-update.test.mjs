import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFeedUpdate } from "../lib/watch/feed-update.ts";

const fresh = (newCount = 3) => ({ videos: [{ id: "1" }], favoriteCategories: ["Dota 2"], newCount, loadStartedAt: 100 });
const pending = (newCount = 5) => ({ videos: [{ id: "old" }], favoriteCategories: null, newCount, loadStartedAt: 50 });

test("with nothing on screen the refreshed feed is simply shown", () => {
  const d = resolveFeedUpdate({ shownCount: 0, sameVisibleOrder: false, prev: null, fresh: fresh() });
  assert.deepEqual([d.applyNow, d.pending], [true, null]);
});

test("a refresh that would not move anything updates in place without raising the button", () => {
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: true, prev: null, fresh: fresh() });
  assert.deepEqual([d.applyNow, d.pending], [true, null]);
});

test("a refresh that would move cards is held behind the button", () => {
  const f = fresh(4);
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: false, prev: null, fresh: f });
  assert.equal(d.applyNow, false);
  assert.equal(d.pending, f);
});

test("right after arriving on the page, a refresh that would reorder things is shown immediately", () => {
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: false, prev: null, fresh: fresh(19), autoApply: true });
  assert.deepEqual([d.applyNow, d.pending], [true, null]);
});

test("once the user is using the page, the same refresh is held instead", () => {
  const f = fresh(19);
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: false, prev: null, fresh: f, autoApply: false });
  assert.deepEqual([d.applyNow, d.pending], [false, f]);
});

test("a newer held refresh replaces the older one", () => {
  const f = fresh(7);
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: false, prev: pending(), fresh: f });
  assert.deepEqual([d.applyNow, d.pending.newCount], [false, 7]);
});

test("a button that is showing is never removed by a later refresh that happens to match the screen", () => {
  const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder: true, prev: pending(5), fresh: fresh(3) });
  assert.equal(d.applyNow, true);
  assert.ok(d.pending, "the button must survive");
  assert.equal(d.pending.newCount, 0); // nothing new relative to the screen any more
  assert.deepEqual(d.pending.videos, [{ id: "1" }]); // and it now holds the latest data, not the stale copy
});

test("the button only goes away when the user accepts it (caller clears it), not through any decision", () => {
  for (const sameVisibleOrder of [true, false]) {
    const d = resolveFeedUpdate({ shownCount: 10, sameVisibleOrder, prev: pending(), fresh: fresh() });
    assert.notEqual(d.pending, null, `sameVisibleOrder=${sameVisibleOrder}`);
  }
});
