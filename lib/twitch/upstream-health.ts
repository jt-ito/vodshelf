import type { Outage, UpstreamName, UpstreamState } from "./outages";

/**
 * Tracks whether Twitch, VODVOD and TwitchTracker are answering, from the calls the app makes anyway
 * (no extra probing). After repeated failures a short "circuit" stops further attempts so a dead
 * service doesn't slow every request, then lets one through to see whether it recovered.
 */

interface Health {
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastReason: string | null;
}

export const DOWN_AFTER_FAILURES = 3;
export const CIRCUIT_COOLDOWN_MS = 60_000;
/** A failure this old with no newer attempt is forgotten; the next real call re-learns the state */
export const FAILURE_EXPIRY_MS = 10 * 60_000;

const NAMES: UpstreamName[] = ["twitch", "vodvod", "twitchtracker"];

// Shared across hot reloads
const g = globalThis as { __upstreamHealth?: Record<UpstreamName, Health> };
const store = (g.__upstreamHealth ??= {
  twitch: blank(),
  vodvod: blank(),
  twitchtracker: blank(),
});

function blank(): Health {
  return { consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastReason: null };
}

/** Test helper */
export function resetUpstreamHealth(): void {
  for (const n of NAMES) store[n] = blank();
}

export function reportUpstreamSuccess(name: UpstreamName, now = Date.now()): void {
  const h = store[name];
  h.consecutiveFailures = 0;
  h.lastSuccessAt = now;
}

export function reportUpstreamFailure(name: UpstreamName, reason: string, now = Date.now()): void {
  const h = store[name];
  h.consecutiveFailures += 1;
  h.lastFailureAt = now;
  h.lastReason = reason;
}

function stateOf(h: Health, now: number): UpstreamState {
  if (h.consecutiveFailures === 0) return "ok";
  if (h.lastFailureAt !== null && now - h.lastFailureAt > FAILURE_EXPIRY_MS) return "ok";
  return h.consecutiveFailures >= DOWN_AFTER_FAILURES ? "down" : "degraded";
}

/** True while attempts should be skipped: the service just failed repeatedly and is cooling down. */
export function isCircuitOpen(name: UpstreamName, now = Date.now()): boolean {
  const h = store[name];
  return (
    h.consecutiveFailures >= DOWN_AFTER_FAILURES &&
    h.lastFailureAt !== null &&
    now - h.lastFailureAt < CIRCUIT_COOLDOWN_MS
  );
}

export function getUpstreamState(name: UpstreamName, now = Date.now()): UpstreamState {
  return stateOf(store[name], now);
}

const COPY: Record<UpstreamName, { label: string; down: string; degraded: string }> = {
  twitch: {
    label: "Twitch",
    down: "Twitch isn't responding, so new broadcasts can't be loaded right now.",
    degraded: "Twitch is responding unreliably; some broadcasts may be missing or late.",
  },
  vodvod: {
    label: "VODVOD",
    down: "VODVOD is unreachable, so some broadcasts may be missing from your feed.",
    degraded: "VODVOD is responding unreliably; some broadcasts may be missing.",
  },
  twitchtracker: {
    label: "TwitchTracker",
    down: "TwitchTracker is unreachable, so stream links and title updates are limited.",
    degraded: "TwitchTracker is responding unreliably; stream links and title updates may be limited.",
  },
};

/** Services that are currently failing, worst first. Empty when everything is fine. */
export function getOutages(now = Date.now()): Outage[] {
  const outages: Outage[] = [];
  for (const name of NAMES) {
    const h = store[name];
    const state = stateOf(h, now);
    if (state === "ok") continue;
    outages.push({
      name,
      label: COPY[name].label,
      state,
      message: state === "down" ? COPY[name].down : COPY[name].degraded,
      lastSuccessAt: h.lastSuccessAt,
      lastFailureAt: h.lastFailureAt,
    });
  }
  return outages.sort((a, b) => (a.state === b.state ? 0 : a.state === "down" ? -1 : 1));
}
