"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Bookmark,
  Film,
  Loader2,
  Star,
  Play,
  ArrowUpDown,
  Tag,
  Clock,
  ChevronRight,
  Copy,
  Check,
  CheckSquare,
  CheckCheck,
  ListPlus,
  ArrowUp,
  AlertTriangle,
  X,
} from "lucide-react";
import VodCard, { formatDuration } from "./VodCard";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { useToast } from "./Toast";
import { saveWatchStatus, saveBulkWatch } from "@/lib/watch/client";
import { readFeedCache, writeFeedCache } from "@/lib/watch/feed-cache";
import { createWatchOverrides } from "@/lib/watch/overrides";
import { Outage, formatAgo } from "@/lib/twitch/outages";
import { isNotReady } from "@/lib/twitch/availability";
import { resolveFeedUpdate, type PendingFeed } from "@/lib/watch/feed-update";
import { useWatchSettings } from "@/lib/watch-settings";
import { useFeedPrefs } from "@/hooks/useFeedPrefs";
import { useVodTags } from "@/hooks/useVodTags";
import { getVideoLink } from "@/lib/twitch/links";

interface FeedViewProps {
  onPlayVideo: (video: TwitchVodItem) => void;
  onRecoverCdn: (vodId: string) => void;
  onSelectStreamer: (login: string) => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  onAddToQueue?: (video: TwitchVodItem) => void;
  onBatchAddToQueue?: (videos: TwitchVodItem[]) => void;
  selectedVodId?: string | null;
  queueVodIds?: Set<string>;
  liveStreamerLogins?: Set<string>;
  /** Reports per-creator unwatched counts (lowercase login -> count) for sidebar badges */
  onUnwatchedCounts?: (counts: Record<string, number>) => void;
}

// When the server still had to refresh in the background, check again after these delays
const STALE_RETRY_DELAYS_MS = [3000, 5000, 8000];

const POPULAR_SUGGESTIONS = [
  { login: "shroud", name: "shroud", color: "#00b4d8" },
  { login: "tarik", name: "tarik", color: "#eb0400" },
  { login: "xqc", name: "xQc", color: "#ffb703" },
  { login: "caseoh_", name: "CaseOh", color: "#fb8500" },
  { login: "summit1g", name: "summit1g", color: "#7209b7" },
  { login: "pokimane", name: "Pokimane", color: "#f72585" },
];

export default function FeedView({
  onPlayVideo,
  onRecoverCdn,
  onSelectStreamer,
  isLoggedIn,
  onOpenAuth,
  onAddToQueue,
  onBatchAddToQueue,
  selectedVodId,
  queueVodIds,
  liveStreamerLogins,
  onUnwatchedCounts,
}: FeedViewProps) {
  const { showToast } = useToast();
  const watchSettings = useWatchSettings();
  const [videos, setVideos] = useState<any[]>([]);
  const [favoriteCategories, setFavoriteCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { filter, sortBy, changeSort: handleSortChange, changeFilter: handleFilterChange, adoptServerFilter } =
    useFeedPrefs(isLoggedIn);
  const [copiedLinks, setCopiedLinks] = useState(false);
  const userTags = useVodTags(isLoggedIn);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedVodIds, setSelectedVodIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Upstream services (Twitch / VODVOD / TwitchTracker) that are currently failing, and how old the data shown is
  const [outages, setOutages] = useState<Outage[]>([]);
  const [dataAsOf, setDataAsOf] = useState<number | null>(null);
  const announcedOutagesRef = useRef("");
  const [focusedVodId, setFocusedVodId] = useState<string | null>(null);

  // Local watch changes are remembered so a response fetched before they were saved can't overwrite them
  const [watchOverrides] = useState(createWatchOverrides);
  const recordWatchOverride = watchOverrides.record;
  const applyWatchOverrides = watchOverrides.apply;

  // A refreshed feed that would change what is on screen is held here until the user accepts it,
  // so cards never move under the cursor mid-click.
  const [pendingFeed, setPendingFeed] = useState<PendingFeed | null>(null);
  const pendingFeedRef = useRef<PendingFeed | null>(null);
  pendingFeedRef.current = pendingFeed;
  const videosRef = useRef<any[]>([]);
  videosRef.current = videos;
  const computeVisibleRef = useRef<(list: any[]) => any[]>((l) => l);
  const feedTopRef = useRef<HTMLDivElement>(null);
  // When the server answered from a stale snapshot it refreshes in the background; re-check shortly
  const staleRetriesRef = useRef(0);
  // For a short window after arriving on the feed (opening the site, or navigating back to it) refreshes are
  // applied straight away. Once the user has clicked or typed, or the window ends, they are held behind the button.
  const arrivalWindowEndsRef = useRef(0);
  const userActedRef = useRef(false);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
  }, []);

  const loadFeed = async (silent = false) => {
    const loadStartedAt = Date.now();
    // Stale-while-revalidate: paint the last known feed instantly, then refresh behind it
    let showedCache = false;
    if (!silent && isLoggedIn) {
      const cached = readFeedCache();
      if (cached && cached.videos.length > 0) {
        setVideos(cached.videos);
        setFavoriteCategories(cached.favoriteCategories);
        setIsLoading(false);
        showedCache = true;
      }
    }
    if (!silent && !showedCache) setIsLoading(true);
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/streamers/feed");
      if (res.ok) {
        const data = await res.json();

        // Tell the user when a source is down (once per change) instead of letting the feed silently go stale
        // TwitchTracker is an optional extra (and is often blocked from home connections): it never shows up here
        const currentOutages: Outage[] = (Array.isArray(data.outages) ? (data.outages as Outage[]) : []).filter(
          (o) => o.name !== "twitchtracker"
        );
        // Toast only for real outages; a merely unstable optional source (TwitchTracker flaps) just shows the chip
        const notable = currentOutages.filter((o) => o.state === "down");
        const outageKey = notable.map((o) => `${o.name}:${o.state}`).join("|");
        const savedNote =
          data.stale && typeof data.oldestSnapshotAt === "number"
            ? ` Showing saved data from ${formatAgo(data.oldestSnapshotAt)}.`
            : "";
        setOutages(currentOutages);
        setDataAsOf(currentOutages.length > 0 && data.stale ? data.oldestSnapshotAt ?? null : null);
        if (outageKey !== announcedOutagesRef.current) {
          if (notable.length > 0) {
            showToast(
              notable.map((o) => o.message).join(" ") + savedNote,
              notable.some((o) => o.state === "down") ? "error" : "info"
            );
          } else if (announcedOutagesRef.current) {
            showToast("Everything is reachable again. Your feed is up to date.");
          }
          announcedOutagesRef.current = outageKey;
        }

        const freshVideos = applyWatchOverrides(data.videos || [], loadStartedAt);
        const freshCategories: string[] | null = Array.isArray(data.favoriteCategories) ? data.favoriteCategories : null;

        // Apply immediately only when nothing is shown yet or the visible order wouldn't change.
        // Otherwise hold the update behind a pill so cards don't shift while the user is acting.
        const shown = videosRef.current;
        const visibleIds = (list: any[]) => computeVisibleRef.current(list).map((v) => String(v.id)).join(",");
        const shownIds = new Set(shown.map((v) => String(v.id)));
        const decision = resolveFeedUpdate({
          shownCount: shown.length,
          sameVisibleOrder: visibleIds(shown) === visibleIds(freshVideos),
          prev: pendingFeedRef.current,
          autoApply: Date.now() < arrivalWindowEndsRef.current && !userActedRef.current,
          fresh: {
            videos: freshVideos,
            favoriteCategories: freshCategories,
            newCount: freshVideos.filter((v) => !shownIds.has(String(v.id))).length,
            loadStartedAt,
          },
        });
        if (decision.applyNow) {
          setVideos(freshVideos);
          if (freshCategories) setFavoriteCategories(freshCategories);
        }
        setPendingFeed(decision.pending);
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
        // No point re-checking while Twitch itself is down
        const twitchDown = currentOutages.some((o) => o.name === "twitch" && o.state === "down");
        if (data.stale && !twitchDown && staleRetriesRef.current < STALE_RETRY_DELAYS_MS.length) {
          staleTimerRef.current = setTimeout(() => loadFeed(true), STALE_RETRY_DELAYS_MS[staleRetriesRef.current]);
          staleRetriesRef.current += 1;
        } else if (!data.stale) {
          staleRetriesRef.current = 0;
          arrivalWindowEndsRef.current = 0; // fully up to date: the arrival refresh is done
        }
        // The cache always gets the fresh copy so the next visit starts up to date
        if (isLoggedIn && freshVideos.length > 0) {
          writeFeedCache(freshVideos, freshCategories || []);
        }
        adoptServerFilter(data.feedFilter);
      } else if (!silent) {
        showToast(showedCache ? "Couldn't refresh your feed. Showing saved data." : "Couldn't load your feed.", "error");
      }
    } catch (err) {
      console.error("Failed to load feed:", err);
      if (!silent) {
        showToast(showedCache ? "Couldn't refresh your feed. Showing saved data." : "Couldn't load your feed.", "error");
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    arrivalWindowEndsRef.current = Date.now() + 30_000;
    userActedRef.current = false;
    setPendingFeed(null);
    loadFeed();
  }, [isLoggedIn]);

  // Deliberate actions (not scrolling or hovering) mean the user is using the page and must not have cards move
  useEffect(() => {
    const markActed = () => {
      userActedRef.current = true;
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, markActed, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, markActed));
  }, []);

  // Resync after the tab sat hidden for a while so stale state never masks the server's truth
  useEffect(() => {
    if (!isLoggedIn) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) {
        hiddenAt = 0;
        loadFeed(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isLoggedIn]);

  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const setWatchState = (vodId: string, isWatched: boolean, progressSeconds: number) => {
    recordWatchOverride(vodId, isWatched, progressSeconds);
    setVideos((prev) =>
      prev.map((v) =>
        String(v.id) === vodId
          ? { ...v, watchStatus: { ...(v.watchStatus || {}), isWatched, progressSeconds } }
          : v
      )
    );
  };

  const handleToggleWatch = async (
    vodId: string,
    currentStatus: boolean,
    totalSeconds: number,
    silent = false,
    streamerLoginParam?: string
  ) => {
    if (!isLoggedIn) {
      onOpenAuth();
      return false;
    }

    const stringVodId = String(vodId);
    const targetVideo = videos.find((v) => String(v.id) === stringVodId);
    const streamerLogin = streamerLoginParam || targetVideo?.owner?.login;

    if (!streamerLogin) {
      showToast("Streamer information missing for this broadcast", "error");
      return false;
    }

    const nextStatus = !currentStatus;
    const prevProgress = targetVideo?.watchStatus?.progressSeconds || 0;
    const nextProgress = nextStatus ? totalSeconds : 0;

    // If the current filter excludes watched broadcasts (unwatched, unwatched_no_live, or in_progress),
    // animate dismissal smoothly with keyframe transition before removing from view
    const shouldDismiss =
      (filter === "unwatched" && nextStatus === true) ||
      (filter === "unwatched_no_live" && nextStatus === true) ||
      (filter === "in_progress" && (nextStatus === true || totalSeconds <= 0));

    // Optimistic update: the UI changes immediately and rolls back if the server rejects it
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    if (shouldDismiss) {
      setDismissingIds((prev) => new Set(prev).add(stringVodId));
      dismissTimer = setTimeout(() => {
        setWatchState(stringVodId, nextStatus, nextProgress);
        setDismissingIds((prev) => {
          const next = new Set(prev);
          next.delete(stringVodId);
          return next;
        });
      }, 280);
    } else {
      setWatchState(stringVodId, nextStatus, nextProgress);
    }

    const err = await saveWatchStatus({
      vodId: stringVodId,
      streamerLogin,
      isWatched: nextStatus,
      progressSeconds: nextProgress,
      totalSeconds,
    });

    if (err) {
      if (dismissTimer) clearTimeout(dismissTimer);
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(stringVodId);
        return next;
      });
      setWatchState(stringVodId, currentStatus, prevProgress);
      showToast(err, "error");
      return false;
    }

    if (!silent) {
      showToast(nextStatus ? "Marked as watched" : "Marked as unwatched", "success", {
        label: "Undo",
        onClick: async () => {
          setWatchState(stringVodId, currentStatus, prevProgress);
          const undoErr = await saveWatchStatus({
            vodId: stringVodId,
            streamerLogin,
            isWatched: currentStatus,
            progressSeconds: prevProgress,
            totalSeconds,
          });
          if (undoErr) {
            setWatchState(stringVodId, nextStatus, nextProgress);
            showToast(undoErr, "error");
          }
        },
      });
    }
    return true;
  };

  // Handle external bulk mark watched (e.g. from queue manager) with smooth card exit animation
  const handleBulkMarkWatched = (vodIds: string[]) => {
    if (!vodIds || vodIds.length === 0) return;
    const vodIdSet = new Set(vodIds.map(String));

    // Find which videos in feed match and aren't already marked watched
    const matchingIds = videos
      .filter((v) => vodIdSet.has(String(v.id)) && !v.watchStatus?.isWatched)
      .map((v) => String(v.id));

    videos.forEach((v) => {
      if (vodIdSet.has(String(v.id))) {
        recordWatchOverride(String(v.id), true, v.lengthSeconds || v.watchStatus?.totalSeconds || 0);
      }
    });

    const shouldDismiss = filter === "unwatched" || filter === "unwatched_no_live" || filter === "in_progress";

    if (shouldDismiss && matchingIds.length > 0) {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        matchingIds.forEach((id) => next.add(id));
        return next;
      });

      setTimeout(() => {
        setVideos((prev) =>
          prev.map((v) => {
            if (vodIdSet.has(String(v.id))) {
              return {
                ...v,
                watchStatus: {
                  ...(v.watchStatus || {}),
                  isWatched: true,
                  progressSeconds: v.lengthSeconds || v.watchStatus?.totalSeconds || 0,
                },
              };
            }
            return v;
          })
        );
        setDismissingIds((prev) => {
          const next = new Set(prev);
          matchingIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 280);
    } else {
      setVideos((prev) =>
        prev.map((v) => {
          if (vodIdSet.has(String(v.id))) {
            return {
              ...v,
              watchStatus: {
                ...(v.watchStatus || {}),
                isWatched: true,
                progressSeconds: v.lengthSeconds || v.watchStatus?.totalSeconds || 0,
              },
            };
          }
          return v;
        })
      );
    }
  };

  // Listen for bulk mark watched events dispatched across the app
  useEffect(() => {
    const handleExternalWatchedEvent = (e: any) => {
      const ids = e.detail?.vodIds;
      if (Array.isArray(ids) && ids.length > 0) {
        handleBulkMarkWatched(ids);
      }
    };
    window.addEventListener("twitch_vods_marked_watched", handleExternalWatchedEvent);
    return () => {
      window.removeEventListener("twitch_vods_marked_watched", handleExternalWatchedEvent);
    };
  }, [videos, filter]);

  const handlePlayAndMarkWatched = (video: TwitchVodItem) => {
    onPlayVideo(video);
    // Nothing plays yet for a broadcast whose playlist isn't ready, so it must not be marked as watched
    if (isNotReady((video as any).availability)) return;

    if (isLoggedIn && watchSettings.markWatchedOnPlay) {
      const currentStatus = (video as any).watchStatus?.isWatched || false;
      if (!currentStatus) {
        handleToggleWatch(video.id, false, video.lengthSeconds, true, video.owner?.login);
      }
    }
  };

  const handleMiddleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const handleStreamerMiddleClick = (e: React.MouseEvent, login: string) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      window.open(`/?streamer=${encodeURIComponent(login)}`, "_blank", "noopener,noreferrer");
    }
  };

  // Continue Watching list (VODs in progress)
  const continueWatchingVideos = useMemo(() => {
    return videos.filter((v) => {
      const w = v.watchStatus;
      return w && !w.isWatched && (w.progressSeconds || 0) > 60 && !dismissingIds.has(String(v.id));
    });
  }, [videos, dismissingIds]);

  // Helper to reliably identify currently live/ongoing broadcasts
  const isVodOngoing = (v: TwitchVodItem): boolean => {
    if (v.isLive) return true;
    const raw = v.previewThumbnailURL || "";
    // 1. Processing thumbnails that Twitch assigns to active ongoing streams
    if (
      raw.includes("404_processing") ||
      raw.includes("_404/") ||
      (raw.endsWith(".png") && raw.includes("processing")) ||
      raw.includes("live_user_")
    ) {
      return true;
    }
    // 2. Known live streamer whose broadcast started recently (within 24h)
    const loginLower = (v.owner?.login || "").toLowerCase();
    const isStreamerOnline = Boolean(
      v.isStreamerLive ||
      (liveStreamerLogins && liveStreamerLogins.has(loginLower))
    );
    if (isStreamerOnline) {
      const timeDiff = new Date().getTime() - new Date(v.createdAt || v.publishedAt || 0).getTime();
      if (timeDiff < 24 * 3600 * 1000) {
        return true;
      }
    }
    return false;
  };

  // Counts for each filter tab
  const filterCounts = useMemo(() => {
    let unwatched = 0;
    let unwatchedNoLive = 0;
    let inProgress = 0;
    let unlisted = 0;

    for (const v of videos) {
      const w = v.watchStatus || {};
      const isLive = isVodOngoing(v);
      if (!w.isWatched) {
        unwatched++;
        if (!isLive) {
          unwatchedNoLive++;
        }
      }
      if ((w.progressSeconds || 0) > 0 && !w.isWatched) inProgress++;
      if (Boolean(v.isUnlisted || v.broadcastType === "UNLISTED")) unlisted++;
    }

    return {
      all: videos.length,
      unwatched,
      unwatchedNoLive,
      inProgress,
      unlisted,
    };
  }, [videos]);

  // Report per-creator unwatched counts (excluding ongoing broadcasts) for sidebar badges
  useEffect(() => {
    if (!onUnwatchedCounts || isLoading) return;
    const counts: Record<string, number> = {};
    for (const v of videos) {
      if (v.watchStatus?.isWatched || isVodOngoing(v)) continue;
      const login = (v.owner?.login || "").toLowerCase();
      if (login) counts[login] = (counts[login] || 0) + 1;
    }
    onUnwatchedCounts(counts);
  }, [videos, isLoading]);

  // Filter and sort videos
  const computeVisible = (source: any[]) => {
    let list = source.filter((v) => {
      if (
        selectedCategory &&
        (v.game?.name || "").toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }

      if (dismissingIds.has(String(v.id))) {
        return true;
      }

      const watch = v.watchStatus || {};
      if (filter === "unwatched") {
        return !watch.isWatched;
      }
      if (filter === "unwatched_no_live") {
        return !watch.isWatched && !isVodOngoing(v);
      }
      if (filter === "in_progress") {
        return (watch.progressSeconds || 0) > 0 && !watch.isWatched;
      }
      if (filter === "unlisted") {
        return Boolean(v.isUnlisted || v.broadcastType === "UNLISTED");
      }
      return true;
    });

    if (sortBy === "duration_desc") {
      list = [...list].sort((a, b) => (b.lengthSeconds || 0) - (a.lengthSeconds || 0));
    } else if (sortBy === "duration_asc") {
      list = [...list].sort((a, b) => (a.lengthSeconds || 0) - (b.lengthSeconds || 0));
    } else if (sortBy === "views") {
      list = [...list].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    } else if (sortBy === "creator_asc") {
      list = [...list].sort((a, b) => {
        const nameA = (a.owner?.displayName || a.owner?.login || "").toLowerCase();
        const nameB = (b.owner?.displayName || b.owner?.login || "").toLowerCase();
        const cmp = nameA.localeCompare(nameB);
        if (cmp !== 0) return cmp;
        const timeA = new Date(a.publishedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.publishedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });
    } else if (sortBy === "creator_desc") {
      list = [...list].sort((a, b) => {
        const nameA = (a.owner?.displayName || a.owner?.login || "").toLowerCase();
        const nameB = (b.owner?.displayName || b.owner?.login || "").toLowerCase();
        const cmp = nameB.localeCompare(nameA);
        if (cmp !== 0) return cmp;
        const timeA = new Date(a.publishedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.publishedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });
    }

    return list;
  };
  computeVisibleRef.current = computeVisible;

  const filteredVideos = useMemo(
    () => computeVisible(videos),
    [videos, selectedCategory, filter, dismissingIds, sortBy]
  );

  const acceptPendingFeed = () => {
    if (!pendingFeed) return;
    setVideos(applyWatchOverrides(pendingFeed.videos, pendingFeed.loadStartedAt));
    if (pendingFeed.favoriteCategories) setFavoriteCategories(pendingFeed.favoriteCategories);
    setPendingFeed(null);
    setFocusedVodId(null);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    feedTopRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  const handleCopyAllFeedLinks = async () => {
    if (filteredVideos.length === 0) return;
    const links = filteredVideos.map((v) => getVideoLink(v)).filter(Boolean);
    if (links.length === 0) return;
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      setCopiedLinks(true);
      showToast(`Copied ${links.length} link${links.length === 1 ? "" : "s"} to clipboard`);
      setTimeout(() => setCopiedLinks(false), 2000);
    } catch (err) {
      console.error("Failed to copy links:", err);
      showToast("Failed to copy links to clipboard", "error");
    }
  };

  // Selection Mode Helpers
  const isAllSelectedOnPage = useMemo(() => {
    if (filteredVideos.length === 0) return false;
    return filteredVideos.every((v) => selectedVodIds.has(String(v.id)));
  }, [filteredVideos, selectedVodIds]);

  const handleSelectAll = () => {
    if (isAllSelectedOnPage) {
      setSelectedVodIds((prev) => {
        const next = new Set(prev);
        filteredVideos.forEach((v) => next.delete(String(v.id)));
        return next;
      });
    } else {
      setSelectedVodIds((prev) => {
        const next = new Set(prev);
        filteredVideos.forEach((v) => next.add(String(v.id)));
        return next;
      });
    }
  };

  const handleToggleSelect = (vodId: string) => {
    setSelectedVodIds((prev) => {
      const next = new Set(prev);
      const strId = String(vodId);
      if (next.has(strId)) {
        next.delete(strId);
      } else {
        next.add(strId);
      }
      return next;
    });
  };

  const handleMarkSelectedWatched = async () => {
    if (selectedVodIds.size === 0) return;
    if (!isLoggedIn) {
      onOpenAuth();
      return;
    }

    const idsToMark: string[] = Array.from(selectedVodIds);
    const targetVideos = videos.filter((v) => selectedVodIds.has(String(v.id)));

    setIsBulkUpdating(true);
    try {
      const items = targetVideos.map((v) => ({
        vodId: String(v.id),
        streamerLogin: v.owner?.login || "",
        totalSeconds: v.lengthSeconds || v.watchStatus?.totalSeconds || 0,
      }));

      // Snapshot prior state so Undo can restore each item's previous progress
      const previous = targetVideos.flatMap((v, i) =>
        v.watchStatus?.isWatched
          ? []
          : [{ item: items[i], progress: (v.watchStatus?.progressSeconds as number) || 0 }]
      );

      const err = await saveBulkWatch(items);

      if (!err) {
        const undoBulk = async () => {
          previous.forEach((p) => setWatchState(p.item.vodId, false, p.progress));
          const clean = previous.filter((p) => p.progress === 0).map((p) => p.item);
          const partial = previous.filter((p) => p.progress > 0);
          const results = await Promise.all([
            clean.length > 0 ? saveBulkWatch(clean, false) : Promise.resolve(null),
            ...partial.map((p) =>
              saveWatchStatus({
                vodId: p.item.vodId,
                streamerLogin: p.item.streamerLogin,
                isWatched: false,
                progressSeconds: p.progress,
                totalSeconds: p.item.totalSeconds,
              })
            ),
          ]);
          const undoErr = results.find(Boolean);
          if (undoErr) {
            showToast(undoErr, "error");
            loadFeed(true);
          }
        };
        showToast(
          `Marked ${items.length} broadcast${items.length === 1 ? "" : "s"} as watched`,
          "success",
          previous.length > 0 ? { label: "Undo", onClick: undoBulk } : undefined
        );
        handleBulkMarkWatched(idsToMark);
        setSelectedVodIds(new Set());
        setIsSelectionMode(false);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("twitch_vods_marked_watched", { detail: { vodIds: idsToMark } })
          );
        }
      } else {
        showToast(err, "error");
      }
    } catch (err) {
      console.error("Bulk mark watched error:", err);
      showToast("Failed to mark broadcasts as watched", "error");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleAddSelectedToQueue = () => {
    if (selectedVodIds.size === 0) return;
    const targetVideos = filteredVideos.filter((v) => selectedVodIds.has(String(v.id)));
    if (targetVideos.length === 0) return;

    if (onBatchAddToQueue) {
      onBatchAddToQueue(targetVideos);
    } else if (onAddToQueue) {
      targetVideos.forEach((v) => onAddToQueue(v));
      showToast(`Added ${targetVideos.length} broadcast${targetVideos.length === 1 ? "" : "s"} to playback queue`);
    }
    setSelectedVodIds(new Set());
    setIsSelectionMode(false);
  };

  // Keyboard triage: j/k (or arrows once a card is focused) move, Enter plays, w/Space toggles watched, q queues.
  // The handler lives in a ref so the listener is registered once but always sees fresh state.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
    // The player modal owns the keyboard while it is open
    if (document.querySelector("video")) return;
    if (filteredVideos.length === 0) return;

    const list = filteredVideos;
    const key = e.key;
    const idx = focusedVodId ? list.findIndex((v) => String(v.id) === focusedVodId) : -1;

    const moveTo = (to: number) => {
      const id = String(list[Math.max(0, Math.min(list.length - 1, to))].id);
      setFocusedVodId(id);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-vod-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" })
      );
    };

    if (key === "j" || (key === "ArrowDown" && idx >= 0)) {
      e.preventDefault();
      moveTo(idx + 1);
      return;
    }
    if (key === "k" || (key === "ArrowUp" && idx >= 0)) {
      e.preventDefault();
      moveTo(idx < 0 ? 0 : idx - 1);
      return;
    }
    if (idx < 0) return;

    const video = list[idx];
    // Let focused buttons/links keep their native Enter/Space behaviour
    const onControl = tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
    const lower = key.toLowerCase();

    if (key === "Escape") {
      setFocusedVodId(null);
    } else if (key === "Enter" && !onControl) {
      e.preventDefault();
      handlePlayAndMarkWatched(video);
    } else if (key === " " && !onControl && isSelectionMode) {
      e.preventDefault();
      handleToggleSelect(String(video.id));
    } else if (lower === "w" || (key === " " && !onControl)) {
      e.preventDefault();
      handleToggleWatch(
        video.id,
        Boolean(video.watchStatus?.isWatched),
        video.lengthSeconds || video.watchStatus?.totalSeconds || 0,
        false,
        video.owner?.login
      );
    } else if (lower === "q") {
      e.preventDefault();
      onAddToQueue?.(video);
    }
  };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      {/*
        Held refresh. Sticky to the top of the scrolling feed column (so it is centred on the feed, not the whole
        window) and zero-height, so it never moves anything. It sits outside the spaced container below so its
        presence cannot add a gap above the header.
      */}
      {pendingFeed && (
        <div className="sticky top-6 z-40 h-0 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={acceptPendingFeed}
            className="pointer-events-auto animate-fade-in-up flex items-center gap-2 px-6 py-3 rounded-full bg-[#9146ff] hover:bg-[#772ce8] text-white text-sm font-semibold shadow-xl shadow-black/60 ring-1 ring-white/25 transition-colors cursor-pointer active:scale-[0.97]"
            title="Apply the refreshed feed (cards may move)"
          >
            <ArrowUp className="w-4 h-4" />
            {pendingFeed.newCount > 0
              ? `${pendingFeed.newCount} new broadcast${pendingFeed.newCount === 1 ? "" : "s"} · Show`
              : "Feed updated · Show"}
          </button>
        </div>
      )}

    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fade-in-up">
      {/* Feed Header */}
      <div
        ref={feedTopRef}
        className="p-4 rounded-lg bg-[#18181b] border border-[#2d2d34] flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-base sm:text-lg font-bold text-[#efeff1] flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-[#9146ff]/15 flex items-center justify-center text-[#bf94ff]">
              <Bookmark className="w-4 h-4 text-[#9146ff]" />
            </span>
            <span>My VOD Feed</span>
            {/* Always rendered at a fixed size and only faded, so refreshing never shifts the layout */}
            <Loader2
              className={`w-3.5 h-3.5 text-[#bf94ff] animate-spin transition-opacity duration-200 ${
                isRefreshing && !isLoading ? "opacity-100" : "opacity-0"
              }`}
              role="status"
              aria-label={isRefreshing && !isLoading ? "Updating feed" : undefined}
              aria-hidden={!(isRefreshing && !isLoading)}
            />
            {outages.length > 0 && (
              <span
                role="status"
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap bg-amber-400/10 border-amber-400/30 text-amber-300"
                title={
                  outages
                    .map((o) => o.message + (o.lastSuccessAt ? ` Last worked ${formatAgo(o.lastSuccessAt)}.` : ""))
                    .join("\n") + (dataAsOf ? `\nShowing saved data from ${formatAgo(dataAsOf)}.` : "")
                }
              >
                <AlertTriangle className="w-3 h-3" />
                {outages[0].label} {outages[0].state === "down" ? "unreachable" : "unstable"}
                {outages.length > 1 ? ` +${outages.length - 1}` : ""}
                {dataAsOf ? ` · saved ${formatAgo(dataAsOf)}` : ""}
              </span>
            )}
          </h1>
          <p className="text-xs text-[#767682] mt-0.5 max-w-xl">
            Aggregated broadcasts from your pinned creators. Favorited categories appear towards the top.
          </p>
        </div>

        {/* Filters, Sort and Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Smart Sort Dropdown */}
          <div className="flex items-center gap-1.5 bg-[#26262c] px-2.5 py-1 rounded border border-[#3f3f46]/50 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#adadb8]" />
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as any)}
              className="bg-transparent text-[#efeff1] text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="recent" className="bg-[#1f1f23]">Most Recent</option>
              <option value="duration_desc" className="bg-[#1f1f23]">Longest First</option>
              <option value="duration_asc" className="bg-[#1f1f23]">Shortest First</option>
              <option value="views" className="bg-[#1f1f23]">Most Views</option>
              <option value="creator_asc" className="bg-[#1f1f23]">Creator (A-Z)</option>
              <option value="creator_desc" className="bg-[#1f1f23]">Creator (Z-A)</option>
            </select>
          </div>

          {/* Copy Links Button */}
          <button
            type="button"
            onClick={handleCopyAllFeedLinks}
            disabled={filteredVideos.length === 0}
            className={`px-2.5 py-1 text-xs font-semibold rounded border transition-all cursor-pointer flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${
              copiedLinks
                ? "bg-[#00f59b]/15 border-[#00f59b]/40 text-[#00f59b]"
                : "bg-[#26262c] border-[#3f3f46]/50 text-[#efeff1] hover:text-[#bf94ff] hover:border-[#9146ff]/40"
            }`}
            title={`Copy links for all ${filteredVideos.length} currently visible broadcasts`}
            aria-label="Copy all links in current view"
          >
            {copiedLinks ? (
              <Check className="w-3.5 h-3.5 text-[#00f59b]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#adadb8]" />
            )}
            <span>{copiedLinks ? "Copied!" : "Copy Links"}</span>
          </button>

          {/* Filter chips with clear role colors */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => handleFilterChange("all")}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
                filter === "all"
                  ? "bg-[#9146ff] text-white shadow-sm"
                  : "bg-[#26262c] text-[#adadb8] hover:text-[#efeff1]"
              }`}
            >
              All ({filterCounts.all})
            </button>
            <button
              onClick={() => handleFilterChange("unwatched")}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-all active:scale-[0.98] ${
                filter === "unwatched"
                  ? "bg-[#00f59b] text-black shadow-sm"
                  : "bg-[#26262c] text-[#adadb8] hover:text-[#00f59b]"
              }`}
              title="Hide watched broadcasts (includes live streams)"
            >
              Hide Watched ({filterCounts.unwatched})
            </button>
            <button
              onClick={() => handleFilterChange("unwatched_no_live")}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-all active:scale-[0.98] ${
                filter === "unwatched_no_live"
                  ? "bg-[#00f59b] text-black shadow-sm"
                  : "bg-[#26262c] text-[#adadb8] hover:text-[#00f59b]"
              }`}
              title="Hide watched broadcasts and hide currently live broadcasts"
            >
              Hide Watched + Live ({filterCounts.unwatchedNoLive})
            </button>
            <button
              onClick={() => handleFilterChange("in_progress")}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-all active:scale-[0.98] ${
                filter === "in_progress"
                  ? "bg-[#f5a623] text-black shadow-sm"
                  : "bg-[#26262c] text-[#adadb8] hover:text-[#f5a623]"
              }`}
            >
              In Progress ({filterCounts.inProgress})
            </button>
            <button
              onClick={() => handleFilterChange("unlisted")}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
                filter === "unlisted"
                  ? "bg-[#26262c] text-[#ff7070] border border-[#eb0400]/40 shadow-sm"
                  : "bg-[#26262c] text-[#adadb8] hover:text-[#ff7070]"
              }`}
            >
              Unlisted ({filterCounts.unlisted})
            </button>

            {/* Subtle Divider */}
            <div className="h-4 w-px bg-[#3f3f46]/50 mx-0.5 hidden sm:block" />

            {/* Multi-Select Toggle Button (Far Right) */}
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode((prev) => {
                  const next = !prev;
                  if (!next) setSelectedVodIds(new Set());
                  return next;
                });
              }}
              disabled={filteredVideos.length === 0}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded border transition-all cursor-pointer flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${
                isSelectionMode
                  ? "bg-[#9146ff] border-[#9146ff] text-white shadow-sm"
                  : "bg-[#26262c] border-[#3f3f46]/50 text-[#efeff1] hover:text-[#bf94ff] hover:border-[#9146ff]/40"
              }`}
              title="Select specific broadcasts to mark watched or add to queue"
              aria-label="Toggle selection mode"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Select</span>
            </button>
          </div>
        </div>
      </div>

      {/* Selection Mode Action Bar */}
      {isSelectionMode && (
        <div className="flex items-center justify-between flex-wrap gap-2.5 p-3 bg-[#1f1a2e] border border-[#9146ff]/50 rounded-xl animate-fade-in-up shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-white px-2.5 py-1.5 rounded-md bg-[#9146ff]/30 border border-[#9146ff]/50 flex items-center gap-1.5">
              <CheckSquare className="w-3.5 h-3.5 text-[#bf94ff]" />
              <span>{selectedVodIds.size} Selected</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Select All on Tab Button */}
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={filteredVideos.length === 0}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer ${
                isAllSelectedOnPage
                  ? "bg-[#9146ff]/20 hover:bg-[#9146ff]/30 text-[#bf94ff] border-[#9146ff]/50"
                  : "bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] hover:text-white border-[#3f3f46]/60"
              }`}
              title={isAllSelectedOnPage ? "Deselect all broadcasts on current tab" : "Select all broadcasts on current tab"}
            >
              <CheckSquare className={`w-3.5 h-3.5 ${isAllSelectedOnPage ? "text-[#bf94ff]" : "text-[#adadb8]"}`} />
              <span>{isAllSelectedOnPage ? "Deselect All on Tab" : `Select All on Tab (${filteredVideos.length})`}</span>
            </button>

            {/* Mark Selected as Watched */}
            <button
              type="button"
              onClick={handleMarkSelectedWatched}
              disabled={selectedVodIds.size === 0 || isBulkUpdating}
              className="px-3 py-1.5 bg-[#00f59b] hover:bg-[#00f59b]/90 text-black text-xs font-bold rounded-md flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer shadow-sm shadow-[#00f59b]/20"
              title={`Mark ${selectedVodIds.size} selected broadcast${selectedVodIds.size === 1 ? "" : "s"} as watched`}
            >
              {isBulkUpdating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Mark as Watched ({selectedVodIds.size})</span>
            </button>

            {/* Add Selected to Playback Queue */}
            <button
              type="button"
              onClick={handleAddSelectedToQueue}
              disabled={selectedVodIds.size === 0}
              className="px-3 py-1.5 bg-[#9146ff] hover:bg-[#772ce8] text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer shadow-sm shadow-[#9146ff]/25"
              title={`Add ${selectedVodIds.size} selected broadcast${selectedVodIds.size === 1 ? "" : "s"} to playback queue`}
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Add to Queue ({selectedVodIds.size})</span>
            </button>

            {/* Cancel Selection */}
            <button
              type="button"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedVodIds(new Set());
              }}
              className="p-1.5 rounded-md text-[#adadb8] hover:text-white hover:bg-[#26262c] transition-colors cursor-pointer ml-1"
              title="Cancel selection"
              aria-label="Cancel selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Active Filter Indicator Banner */}
      {!isLoading && videos.length > 0 && (filter !== "all" || selectedCategory !== null) && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#18181b] border border-[#2d2d34] text-xs animate-tab-fade-in">
          <div className="flex items-center gap-2 text-[#adadb8]">
            <span className="w-2 h-2 rounded-full bg-[#9146ff] animate-pulse flex-shrink-0" />
            <span>
              Showing <strong className="text-[#efeff1] font-semibold">{filteredVideos.length}</strong> of <strong className="text-[#efeff1] font-semibold">{videos.length}</strong> broadcasts
              {filter === "unwatched" && (
                <span> ({videos.length - filterCounts.unwatched} watched broadcasts hidden)</span>
              )}
              {filter === "unwatched_no_live" && (
                <span> ({videos.length - filterCounts.unwatchedNoLive} watched &amp; live broadcasts hidden)</span>
              )}
              {filter === "in_progress" && (
                <span> (only broadcasts currently in progress)</span>
              )}
              {filter === "unlisted" && (
                <span> (only unlisted/recovered broadcasts)</span>
              )}
              {selectedCategory && (
                <span> &bull; Filtered by <strong className="text-amber-300 font-semibold">{selectedCategory}</strong></span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              handleFilterChange("all");
              setSelectedCategory(null);
            }}
            className="flex items-center gap-1 text-xs text-[#9146ff] hover:text-[#bf94ff] font-semibold hover:underline cursor-pointer flex-shrink-0 ml-3"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Continue Watching Shelf */}
      {continueWatchingVideos.length > 0 && filter !== "unwatched" && filter !== "unwatched_no_live" && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-[#18181b] to-[#1f1f23] border border-[#9146ff]/30 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-[#9146ff]/20 text-[#bf94ff]">
                <Clock className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-white">Continue Watching</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#9146ff]/20 text-[#bf94ff]">
                {continueWatchingVideos.length}
              </span>
            </div>
            <span className="text-xs text-gray-400">Pick up where you left off</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {continueWatchingVideos.slice(0, 3).map((video) => {
              const progress = video.watchStatus?.progressSeconds || 0;
              const total = video.lengthSeconds || video.watchStatus?.totalSeconds || 1;
              const pct = Math.min(100, Math.round((progress / total) * 100));
              const remaining = Math.max(0, total - progress);

              return (
                <div
                  key={video.id}
                  onClick={() => handlePlayAndMarkWatched(video)}
                  className="group relative flex gap-3 p-2.5 rounded-lg bg-[#0e0e10]/80 border border-[#2d2d34] hover:border-[#9146ff] transition-all cursor-pointer overflow-hidden"
                >
                  <div className="relative w-28 aspect-video rounded overflow-hidden flex-shrink-0 bg-black">
                    <img
                      src={video.previewThumbnailURL || "/placeholder.jpg"}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-6 h-6 text-white fill-white" />
                    </div>
                    {/* Mini Progress Bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
                      <div className="h-full bg-[#9146ff]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-white truncate group-hover:text-[#bf94ff] transition-colors">
                        {video.title}
                      </h4>
                      <div className="text-[11px] text-gray-400 truncate">
                        {video.owner?.displayName || video.owner?.login}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#00f59b] font-mono">
                      {formatDuration(remaining)} remaining ({pct}%)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Favorite categories bar */}
      {favoriteCategories.length > 0 && (
        <div className="p-3 rounded-lg bg-[#18181b]/80 border border-amber-500/20 flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px] uppercase tracking-wider mr-1">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>Top Categories:</span>
          </div>
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              selectedCategory === null
                ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                : "bg-[#26262c] text-[#adadb8] hover:text-[#efeff1] border border-[#3f3f46]/40"
            }`}
          >
            All Categories
          </button>
          {favoriteCategories.map((cat) => {
            const isSelected = selectedCategory?.toLowerCase() === cat.toLowerCase();
            const count = videos.filter(
              (v) => (v.game?.name || "").toLowerCase() === cat.toLowerCase()
            ).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(isSelected ? null : cat)}
                className={`px-2.5 py-1 rounded text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? "bg-amber-400/25 text-amber-200 border-amber-400/60 shadow-sm"
                    : "bg-[#26262c] text-[#adadb8] border-[#3f3f46]/40 hover:text-amber-300 hover:border-amber-400/30"
                }`}
              >
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>{cat}</span>
                {count > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 text-amber-300/80 font-mono">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5 sm:gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-lg bg-[#18181b] border border-[#2d2d34] overflow-hidden space-y-2.5 p-3.5 sm:p-4">
              <div className="aspect-video w-full skeleton"></div>
              <div className="h-3.5 w-3/4 skeleton"></div>
              <div className="h-3 w-1/2 skeleton"></div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        /* Empty State */
        <div className="p-8 text-center rounded-lg bg-[#18181b] border border-[#2d2d34] max-w-xl mx-auto space-y-4">
          <div className="w-12 h-12 rounded-full bg-[#9146ff]/15 border border-[#9146ff]/30 flex items-center justify-center text-[#bf94ff] mx-auto">
            <Film className="w-6 h-6 text-[#9146ff]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#efeff1]">No Broadcasts in Feed</h2>
            <p className="text-xs text-[#767682] mt-1 max-w-sm mx-auto leading-relaxed">
              {!isLoggedIn
                ? "Sign in to pin creators and automatically aggregate their broadcasts."
                : "Search any channel or pick from popular creators below to pin them to your feed."}
            </p>
          </div>

          {!isLoggedIn && (
            <button
              onClick={onOpenAuth}
              className="px-4 py-2 bg-[#9146ff] hover:bg-[#772ce8] text-white font-semibold text-xs rounded-md transition-colors active:scale-[0.98] cursor-pointer shadow-sm shadow-[#9146ff]/30"
            >
              Sign In
            </button>
          )}

          <div className="pt-3 border-t border-[#2d2d34]">
            <span className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider block mb-2">
              Popular Streamers
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {POPULAR_SUGGESTIONS.map((s) => (
                <a
                  key={s.login}
                  href={`/?streamer=${encodeURIComponent(s.login)}`}
                  onClick={(e) => {
                    if (!e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      onSelectStreamer(s.login);
                    }
                  }}
                  onMouseDown={handleMiddleMouseDown}
                  onAuxClick={(e) => handleStreamerMiddleClick(e, s.login)}
                  className="px-2.5 py-1 rounded bg-[#26262c] hover:bg-[#32323a] text-xs text-[#efeff1] border border-[#3f3f46]/40 flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.name}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="p-8 text-center rounded-lg bg-[#18181b] border border-[#2d2d34]">
          <p className="text-sm text-[#adadb8]">
            No broadcasts match the selected filter.
          </p>
          <div className="mt-2 flex items-center justify-center gap-3">
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory(null)}
                className="text-xs text-amber-400 hover:underline font-semibold"
              >
                Clear Category Filter
              </button>
            )}
            {filter !== "all" && (
              <button
                onClick={() => handleFilterChange("all")}
                className="text-xs text-[#9146ff] hover:underline font-semibold"
              >
                Show all broadcasts
              </button>
            )}
          </div>
        </div>
      ) : (
        /* VOD Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5 sm:gap-6">
          {filteredVideos.map((video, idx) => (
            <VodCard
              key={video.id}
              video={video}
              onPlay={handlePlayAndMarkWatched}
              onRecoverCdn={onRecoverCdn}
              onToggleWatch={handleToggleWatch}
              onSelectStreamer={onSelectStreamer}
              isLoggedIn={isLoggedIn}
              isDismissing={dismissingIds.has(String(video.id))}
              staggerIndex={idx}
              selectionMode={isSelectionMode}
              isSelected={
                isSelectionMode
                  ? selectedVodIds.has(String(video.id))
                  : String(selectedVodId) === String(video.id) || focusedVodId === String(video.id)
              }
              onToggleSelect={handleToggleSelect}
              onAddToQueue={onAddToQueue}
              isInQueue={queueVodIds ? queueVodIds.has(String(video.id)) : false}
            />
          ))}
        </div>
      )}
    </div>
    </>
  );
}
