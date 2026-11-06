// Client-safe types and helpers describing upstream outages (no server-only imports).

export type UpstreamName = "twitch" | "vodvod" | "twitchtracker";
export type UpstreamState = "ok" | "degraded" | "down";

export interface Outage {
  name: UpstreamName;
  label: string;
  state: Exclude<UpstreamState, "ok">;
  /** Plain-language explanation shown to the user */
  message: string;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
export function formatAgo(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Asks the server which services are failing; returns the most relevant message or null. */
export async function fetchOutageMessage(): Promise<string | null> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const outages: Outage[] = Array.isArray(data.outages) ? data.outages : [];
    const worst = outages.find((o) => o.state === "down") || outages[0];
    return worst ? worst.message : null;
  } catch {
    return null;
  }
}
