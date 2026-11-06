// Client-safe: describes whether VODVOD's playlist for a broadcast is playable yet.

export type Availability = "ready" | "processing" | "no_data";

/**
 * VODVOD lists a broadcast (and hands out a playlist link) as soon as it sees the stream, but the link
 * returns 404 until its data has been captured. Its metadata says which situation we are in:
 *   BytesFound { Valid: false }              -> not checked yet            -> playlist 404s: "processing"
 *   BytesFound { Valid: true,  Bool: true }  -> data captured              -> playlist plays: "ready"
 *   BytesFound { Valid: true,  Bool: false } -> checked, nothing captured  -> playlist 404s: "no data"
 * (Verified against live VODVOD records and their playlist responses.)
 */
export const PROCESSING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function vodvodAvailability(meta: any, now: number = Date.now()): Availability {
  const found = meta?.BytesFound;

  // Unknown format: fail open so a VODVOD change can never block playback
  if (!found || typeof found !== "object") return "ready";

  if (found.Valid === true && found.Bool === true) return "ready";

  if (found.Valid === true) {
    // Checked and nothing found. Shortly after a stream that may simply not be finished yet; later it is a gap.
    const start = Date.parse(String(meta?.StartTime ?? ""));
    return Number.isFinite(start) && now - start < PROCESSING_WINDOW_MS ? "processing" : "no_data";
  }

  return "processing";
}

export const AVAILABILITY_COPY: Record<Exclude<Availability, "ready">, { label: string; tip: string; toast: string }> = {
  processing: {
    label: "Processing",
    tip: "VODVOD is still processing this broadcast. Its playlist usually becomes available a few hours after the stream ends and won't play until then.",
    toast: "This broadcast is still being processed. Its playlist usually becomes available a few hours after the stream ends.",
  },
  no_data: {
    label: "No data",
    tip: "VODVOD did not capture any playable data for this broadcast.",
    toast: "VODVOD has no playable data for this broadcast.",
  },
};

export function isNotReady(availability: unknown): availability is Exclude<Availability, "ready"> {
  return availability === "processing" || availability === "no_data";
}
