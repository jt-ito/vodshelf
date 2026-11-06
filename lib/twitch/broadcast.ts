/**
 * Utilities for normalizing stream titles, computing title similarity,
 * and detecting whether two video/stream records represent the same broadcast session.
 */

export function normalizeTitle(t?: string | null): string {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * Computes Jaccard/token similarity between two stream titles.
 * Returns a score between 0 and 1.
 */
export function titleSimilarity(a?: string | null, b?: string | null): number {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.85;

  const wordsA = new Set(
    (a || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
  const wordsB = new Set(
    (b || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );

  if (!wordsA.size || !wordsB.size) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union ? common / union : 0;
}

export interface BroadcastTimeTitleComparable {
  title: string;
  createdAt?: string;
  publishedAt?: string;
  startTime?: string;
  lengthSeconds?: number;
  durationSeconds?: number;
}

/**
 * Checks whether two broadcast entries represent the exact same live stream or VOD session.
 */
export function isSameBroadcast(
  a: BroadcastTimeTitleComparable,
  b: BroadcastTimeTitleComparable
): boolean {
  const timeA = new Date(a.createdAt || a.publishedAt || a.startTime || 0).getTime();
  const timeB = new Date(b.createdAt || b.publishedAt || b.startTime || 0).getTime();
  const diffHours = Math.abs(timeA - timeB) / (1000 * 60 * 60);

  if (diffHours <= 24) {
    const normA = normalizeTitle(a.title);
    const normB = normalizeTitle(b.title);

    // Exact normalized title match (ignoring punctuation, emoji, casing, spaces)
    if (normA && normB && normA === normB) {
      return true;
    }

    // Substring match if titles are substantial (at least 6 characters)
    if (normA.length >= 6 && normB.length >= 6 && (normA.includes(normB) || normB.includes(normA))) {
      return true;
    }

    const sim = titleSimilarity(a.title, b.title);

    // High token similarity within 2 hours
    if (sim >= 0.5 && diffHours <= 2) {
      return true;
    }

    // Start time within 15 minutes of each other (diffHours <= 0.25) with at least minimal similarity
    if (diffHours <= 0.25 && (sim >= 0.3 || normA === normB)) {
      return true;
    }
  }

  return false;
}
