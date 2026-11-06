"use client";

import { useEffect, useState } from "react";

export const FEED_FILTERS = ["all", "unwatched", "unwatched_no_live", "in_progress", "unlisted"] as const;
export const FEED_SORTS = ["recent", "duration_desc", "duration_asc", "views", "creator_asc", "creator_desc"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];
export type FeedSortOption = (typeof FEED_SORTS)[number];

// Cookie mirrors localStorage so the server can render with the same preference
const persist = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
    document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
};

function read<T extends string>(key: string, valid: readonly T[]): T | null {
  try {
    const fromCookie = document.cookie.match(new RegExp(`(?:^|;\s*)${key}=([^;]*)`))?.[1];
    const v = fromCookie ?? localStorage.getItem(key);
    return v && (valid as readonly string[]).includes(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Feed tab filter + sort order, remembered across visits; the filter is also saved to the account when signed in. */
export function useFeedPrefs(isLoggedIn: boolean) {
  const [filter, setFilterState] = useState<FeedFilter>("all");
  const [sortBy, setSortState] = useState<FeedSortOption>("recent");

  useEffect(() => {
    const f = read("twitch_vod_feed_filter", FEED_FILTERS);
    if (f) setFilterState(f);
    const s = read("twitch_vod_feed_sort_by", FEED_SORTS);
    if (s) setSortState(s);
  }, []);

  return {
    filter,
    sortBy,
    changeSort: (s: FeedSortOption) => {
      setSortState(s);
      persist("twitch_vod_feed_sort_by", s);
    },
    changeFilter: (f: FeedFilter) => {
      setFilterState(f);
      persist("twitch_vod_feed_filter", f);
      if (isLoggedIn) {
        fetch("/api/streamers/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filter: f }),
        }).catch(() => {});
      }
    },
    /** Adopt the filter saved on the account (from the feed response) without writing it back. */
    adoptServerFilter: (f: unknown) => {
      if ((FEED_FILTERS as readonly unknown[]).includes(f)) {
        setFilterState(f as FeedFilter);
        persist("twitch_vod_feed_filter", f as string);
      }
    },
  };
}
