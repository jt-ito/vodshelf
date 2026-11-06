export interface PendingFeed {
  videos: any[];
  favoriteCategories: string[] | null;
  /** Broadcasts in the refreshed feed that are not on screen yet */
  newCount: number;
  loadStartedAt: number;
}

export interface FeedUpdateDecision {
  /** Replace the on-screen list with the refreshed one right now */
  applyNow: boolean;
  /** What the "Show updates" button should hold afterwards (null = no button) */
  pending: PendingFeed | null;
}

/**
 * Decides what a refreshed feed does to the screen.
 *  - Nothing shown yet: show it.
 *  - Same visible order: update quietly in place.
 *  - Different order while the user has only just arrived (autoApply): show it straight away, there is
 *    nothing to protect yet.
 *  - Different order while the user is already using the page: hold it behind the button so cards never
 *    move under the cursor.
 * A button that is already showing is never removed by a later refresh, only by the user clicking it:
 * if upstream briefly flaps and the new items vanish, the button stays (it then just says "Feed updated").
 */
export function resolveFeedUpdate(input: {
  shownCount: number;
  sameVisibleOrder: boolean;
  prev: PendingFeed | null;
  fresh: PendingFeed;
  /** The user just arrived on the page and has not interacted with it yet */
  autoApply?: boolean;
}): FeedUpdateDecision {
  const { shownCount, sameVisibleOrder, prev, fresh, autoApply = false } = input;
  if (shownCount === 0) return { applyNow: true, pending: null };
  if (!sameVisibleOrder) return autoApply ? { applyNow: true, pending: null } : { applyNow: false, pending: fresh };
  return { applyNow: true, pending: prev ? { ...fresh, newCount: 0 } : null };
}
