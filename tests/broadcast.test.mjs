import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, titleSimilarity, isSameBroadcast } from "@/lib/twitch/broadcast";

const at = (hoursFromBase) => new Date(Date.UTC(2026, 8, 1, 12, 0, 0) + hoursFromBase * 3600_000).toISOString();

test("normalizeTitle drops punctuation, emoji, spacing and case", () => {
  assert.equal(normalizeTitle("Hello, World! 🎮"), "helloworld");
  assert.equal(normalizeTitle("  Café   Stream  "), "caféstream"); // letters keep their accents
  assert.equal(normalizeTitle(null), "");
  assert.equal(normalizeTitle(undefined), "");
});

test("titleSimilarity: identical 1, empty 0, substring 0.85, token overlap Jaccard", () => {
  assert.equal(titleSimilarity("Lots To Do Today!", "lots to do today"), 1);
  assert.equal(titleSimilarity("", "anything"), 0);
  assert.equal(titleSimilarity(null, null), 0);
  assert.equal(titleSimilarity("Just Chatting", "Just Chatting with chat"), 0.85);
  // words >= 3 chars: {cooking,with,friends,today} vs {cooking,tonight,with,friends} -> 3 common / 5 union
  assert.equal(titleSimilarity("Cooking with friends today", "Cooking tonight with friends"), 0.6);
  assert.equal(titleSimilarity("Zelda marathon", "Cooking dinner"), 0);
});

test("isSameBroadcast: same title within a day matches, beyond a day does not", () => {
  const a = { title: "Lots To Do Today!", createdAt: at(0) };
  assert.equal(isSameBroadcast(a, { title: "lots to do today", createdAt: at(3) }), true);
  assert.equal(isSameBroadcast(a, { title: "Lots To Do Today!", createdAt: at(25) }), false);
});

test("isSameBroadcast: a title edit mid-stream is matched by token similarity or close start time", () => {
  const a = { title: "Zelda Tears of the Kingdom", createdAt: at(0) };
  assert.equal(isSameBroadcast(a, { title: "Zelda Tears Kingdom run", createdAt: at(1) }), true); // sim 0.6 within 2h
  // unrelated titles that merely start close together are not enough
  assert.equal(isSameBroadcast(a, { title: "Cooking dinner", startTime: at(0.1) }), false);
});

test("isSameBroadcast: a long shared substring matches, short ones do not", () => {
  const long = { title: "Just Chatting Stream", createdAt: at(0) };
  assert.equal(isSameBroadcast(long, { title: "Just Chatting", createdAt: at(20) }), true);
  const short = { title: "abc", createdAt: at(0) };
  assert.equal(isSameBroadcast(short, { title: "abcd", createdAt: at(20) }), false);
});

test("isSameBroadcast reads whichever timestamp field is present", () => {
  assert.equal(
    isSameBroadcast({ title: "Same title here", publishedAt: at(0) }, { title: "Same title here", startTime: at(1) }),
    true
  );
});
