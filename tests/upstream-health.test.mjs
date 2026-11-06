import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  reportUpstreamSuccess,
  reportUpstreamFailure,
  getUpstreamState,
  isCircuitOpen,
  getOutages,
  resetUpstreamHealth,
  DOWN_AFTER_FAILURES,
  CIRCUIT_COOLDOWN_MS,
  FAILURE_EXPIRY_MS,
} from "../lib/twitch/upstream-health.ts";

beforeEach(() => resetUpstreamHealth());

test("a service with no failures is ok and reports no outage", () => {
  reportUpstreamSuccess("twitch", 1000);
  assert.equal(getUpstreamState("twitch", 1000), "ok");
  assert.deepEqual(getOutages(1000), []);
});

test("one or two failures are degraded, three are down", () => {
  reportUpstreamFailure("vodvod", "HTTP 503", 1000);
  assert.equal(getUpstreamState("vodvod", 1000), "degraded");
  reportUpstreamFailure("vodvod", "HTTP 503", 1001);
  assert.equal(getUpstreamState("vodvod", 1001), "degraded");
  reportUpstreamFailure("vodvod", "HTTP 503", 1002);
  assert.equal(getUpstreamState("vodvod", 1002), "down");
});

test("a success resets the failure count", () => {
  for (let i = 0; i < DOWN_AFTER_FAILURES; i++) reportUpstreamFailure("twitch", "network", 1000 + i);
  assert.equal(getUpstreamState("twitch", 2000), "down");
  reportUpstreamSuccess("twitch", 2001);
  assert.equal(getUpstreamState("twitch", 2001), "ok");
});

test("the circuit opens after repeated failures, then lets a probe through after the cooldown", () => {
  for (let i = 0; i < DOWN_AFTER_FAILURES; i++) reportUpstreamFailure("twitchtracker", "HTTP 403", 5000);
  assert.equal(isCircuitOpen("twitchtracker", 5000 + CIRCUIT_COOLDOWN_MS - 1), true);
  assert.equal(isCircuitOpen("twitchtracker", 5000 + CIRCUIT_COOLDOWN_MS + 1), false);
});

test("the circuit stays closed below the failure threshold", () => {
  reportUpstreamFailure("twitch", "network", 5000);
  assert.equal(isCircuitOpen("twitch", 5001), false);
});

test("an old failure with no newer attempt is forgotten", () => {
  for (let i = 0; i < DOWN_AFTER_FAILURES; i++) reportUpstreamFailure("vodvod", "network", 1000);
  assert.equal(getUpstreamState("vodvod", 1000 + FAILURE_EXPIRY_MS + 1), "ok");
});

test("outages list the failing services, worst first, with plain-language messages", () => {
  reportUpstreamFailure("vodvod", "network", 1000); // degraded
  for (let i = 0; i < DOWN_AFTER_FAILURES; i++) reportUpstreamFailure("twitch", "HTTP 500", 1000);
  const outages = getOutages(1000);
  assert.deepEqual(outages.map((o) => [o.name, o.state]), [["twitch", "down"], ["vodvod", "degraded"]]);
  assert.match(outages[0].message, /Twitch/);
});
