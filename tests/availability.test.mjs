import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { vodvodAvailability, isNotReady, AVAILABILITY_COPY, PROCESSING_WINDOW_MS } from "@/lib/twitch/availability";

const NOW = Date.UTC(2026, 9, 18, 18, 0, 0);
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600_000;
const meta = (bytes, startedAgo = 100 * HOUR) => ({ BytesFound: bytes, StartTime: iso(startedAgo) });

// Shapes taken from live VODVOD records (and verified against what each playlist link returned)
const NOT_CHECKED = { Bool: false, Valid: false }; // playlist 404s
const FOUND = { Bool: true, Valid: true }; // playlist 200
const CHECKED_EMPTY = { Bool: false, Valid: true }; // playlist 404s

test("data captured means ready", () => {
  assert.equal(vodvodAvailability(meta(FOUND), NOW), "ready");
  assert.equal(vodvodAvailability(meta(FOUND, 1 * HOUR), NOW), "ready"); // even for a very recent stream
});

test("not yet checked by VODVOD means processing, however old the stream looks", () => {
  assert.equal(vodvodAvailability(meta(NOT_CHECKED, 3 * HOUR), NOW), "processing");
  assert.equal(vodvodAvailability(meta(NOT_CHECKED, 400 * HOUR), NOW), "processing");
});

test("checked with nothing found is processing right after the stream, and 'no data' once a day has passed", () => {
  assert.equal(vodvodAvailability(meta(CHECKED_EMPTY, 2 * HOUR), NOW), "processing");
  assert.equal(vodvodAvailability(meta(CHECKED_EMPTY, PROCESSING_WINDOW_MS - 1000), NOW), "processing");
  assert.equal(vodvodAvailability(meta(CHECKED_EMPTY, PROCESSING_WINDOW_MS + 1000), NOW), "no_data");
  assert.equal(vodvodAvailability(meta(CHECKED_EMPTY, 175 * HOUR), NOW), "no_data"); // the week-old streams
});

test("checked-empty with an unreadable start time is treated as no data rather than 'processing forever'", () => {
  assert.equal(vodvodAvailability({ BytesFound: CHECKED_EMPTY, StartTime: "garbage" }, NOW), "no_data");
  assert.equal(vodvodAvailability({ BytesFound: CHECKED_EMPTY }, NOW), "no_data");
});

test("unknown or missing metadata fails open so a VODVOD format change can never block playback", () => {
  for (const bad of [undefined, null, {}, { BytesFound: null }, { BytesFound: "yes" }, { BytesFound: 1 }, "x"]) {
    assert.equal(vodvodAvailability(bad, NOW), "ready", JSON.stringify(bad));
  }
});

test("isNotReady only flags the two blocked states", () => {
  assert.equal(isNotReady("processing"), true);
  assert.equal(isNotReady("no_data"), true);
  for (const ok of ["ready", undefined, null, "", 0, "other"]) assert.equal(isNotReady(ok), false);
});

test("user-facing copy exists for both states and avoids promotional wording", () => {
  for (const state of ["processing", "no_data"]) {
    const c = AVAILABILITY_COPY[state];
    assert.ok(c.label && c.tip && c.toast);
    assert.doesNotMatch(`${c.label} ${c.tip} ${c.toast}`, /unlisted|privated|recover/i);
  }
  assert.match(AVAILABILITY_COPY.processing.toast, /few hours/);
});
