export interface SaveWatchPayload {
  vodId: string;
  streamerLogin: string;
  isWatched: boolean;
  progressSeconds: number;
  totalSeconds: number;
}

export const SESSION_EXPIRED_EVENT = "twitch_session_expired";

/** POST JSON with one retry on network failure and a session-expired signal on 401. */
async function postWatch(url: string, body: unknown): Promise<{ error: string | null; data: any }> {
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  try {
    let res: Response;
    try {
      res = await send();
    } catch {
      // A tab waking from idle/sleep often fails its first request while the network reconnects
      await new Promise((r) => setTimeout(r, 1500));
      res = await send();
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      return { error: "Session expired. Please sign in again.", data };
    }
    if (!res.ok) return { error: data?.error || "Failed to update watch status", data };
    return { error: null, data };
  } catch {
    return { error: "Failed to update watch status", data: null };
  }
}

/**
 * Saves an explicit watch status and verifies the server persisted the requested value.
 * Returns an error message on failure, or null on success.
 */
export async function saveWatchStatus(payload: SaveWatchPayload): Promise<string | null> {
  const { error, data } = await postWatch("/api/watch/progress", payload);
  if (error) return error;
  if (!data || data.isWatched !== payload.isWatched) return "Watch status was not saved. Please try again.";
  return null;
}

/**
 * Bulk-marks VODs watched/unwatched and verifies the server's confirmed count.
 * Returns an error message on failure, or null on success.
 */
export async function saveBulkWatch(
  items: Array<{ vodId: string; streamerLogin: string; totalSeconds: number }>,
  isWatched = true
): Promise<string | null> {
  const { error, data } = await postWatch("/api/watch/bulk", { items, isWatched });
  if (error) return error;
  if (!data || data.isWatched !== isWatched || !(data.updatedCount > 0)) {
    return "Watch status was not saved. Please try again.";
  }
  return null;
}

/**
 * Marks every VOD of a streamer (optionally only those created before an ISO date) as watched.
 * Returns the error message (or null) and the number of VODs the server updated.
 */
export async function saveStreamerBulkWatch(
  streamerLogin: string,
  before?: string
): Promise<{ error: string | null; updatedCount: number }> {
  const { error, data } = await postWatch("/api/watch/bulk", {
    streamerLogin,
    allStreamerVods: true,
    isWatched: true,
    ...(before ? { before } : {}),
  });
  if (error) return { error, updatedCount: 0 };
  if (!data || data.isWatched !== true || typeof data.updatedCount !== "number") {
    return { error: "Watch status was not saved. Please try again.", updatedCount: 0 };
  }
  return { error: null, updatedCount: data.updatedCount };
}
