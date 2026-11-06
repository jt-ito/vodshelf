import "./helpers/env.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal browser globals for the localStorage-backed helpers
const store = new Map();
function installBrowser() {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = new EventTarget();
}
beforeEach(installBrowser);

const { formatDateWithPreference, getStoredDateFormat, setStoredDateFormat, DATE_FORMAT_CHANGE_EVENT } =
  await import("@/lib/date");
const {
  getStoredWatchSettings, setStoredWatchSettings, DEFAULT_WATCH_SETTINGS,
  WATCH_SETTINGS_STORAGE_KEY, WATCH_SETTINGS_CHANGE_EVENT,
} = await import("@/lib/watch-settings");

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const HOUR = 3600_000;

test("formatDateWithPreference exact mode prints M/D/YYYY", () => {
  const d = new Date(2026, 8, 4, 12, 0, 0);
  assert.equal(formatDateWithPreference(d.toISOString(), "exact"), "9/4/2026");
});

test("formatDateWithPreference relative mode buckets", () => {
  assert.equal(formatDateWithPreference(ago(10 * 60_000), "relative"), "Just now");
  assert.equal(formatDateWithPreference(ago(5 * HOUR + 60_000), "relative"), "5h ago");
  assert.equal(formatDateWithPreference(ago(30 * HOUR), "relative"), "Yesterday");
  assert.equal(formatDateWithPreference(ago(5 * 24 * HOUR + HOUR), "relative"), "5d ago");
  assert.equal(formatDateWithPreference(ago(65 * 24 * HOUR), "relative"), "2mo ago");
});

test("formatDateWithPreference handles future, invalid and empty input", () => {
  const future = new Date(Date.now() + 5 * 24 * HOUR);
  assert.equal(
    formatDateWithPreference(future.toISOString(), "relative"),
    `${future.getMonth() + 1}/${future.getDate()}/${future.getFullYear()}`
  );
  assert.equal(formatDateWithPreference("not a date", "relative"), "not a date");
  assert.equal(formatDateWithPreference("", "relative"), "");
});

test("stored date format defaults to relative, persists, and notifies listeners", () => {
  assert.equal(getStoredDateFormat(), "relative");
  let seen = null;
  window.addEventListener(DATE_FORMAT_CHANGE_EVENT, (e) => (seen = e.detail));
  setStoredDateFormat("exact");
  assert.equal(getStoredDateFormat(), "exact");
  assert.equal(seen, "exact");
  assert.equal(formatDateWithPreference(new Date(2026, 0, 2, 12).toISOString()), "1/2/2026"); // uses stored mode
});

test("watch settings default, merge partial updates, persist and notify", () => {
  assert.deepEqual(getStoredWatchSettings(), DEFAULT_WATCH_SETTINGS);
  let detail = null;
  window.addEventListener(WATCH_SETTINGS_CHANGE_EVENT, (e) => (detail = e.detail));

  const updated = setStoredWatchSettings({ markWatchedOnPlay: true });
  assert.deepEqual(updated, { ...DEFAULT_WATCH_SETTINGS, markWatchedOnPlay: true });
  assert.deepEqual(detail, updated);

  setStoredWatchSettings({ markAllWatchedScope: "all" });
  assert.deepEqual(getStoredWatchSettings(), { markWatchedOnOpenLink: false, markWatchedOnPlay: true, markAllWatchedScope: "all" });
});

test("watch settings tolerate corrupt or unexpected stored values", () => {
  store.set(WATCH_SETTINGS_STORAGE_KEY, "{not json");
  assert.deepEqual(getStoredWatchSettings(), DEFAULT_WATCH_SETTINGS);
  store.set(WATCH_SETTINGS_STORAGE_KEY, JSON.stringify({ markAllWatchedScope: "weird", markWatchedOnPlay: 1 }));
  assert.deepEqual(getStoredWatchSettings(), { markWatchedOnOpenLink: false, markWatchedOnPlay: true, markAllWatchedScope: "loaded" });
});

test("without a browser the helpers return defaults and do not throw", () => {
  delete globalThis.window;
  assert.equal(getStoredDateFormat(), "relative");
  assert.deepEqual(getStoredWatchSettings(), DEFAULT_WATCH_SETTINGS);
  assert.deepEqual(setStoredWatchSettings({ markWatchedOnPlay: true }), { ...DEFAULT_WATCH_SETTINGS, markWatchedOnPlay: true });
});
