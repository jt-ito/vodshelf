"use client";

import React, { useState, useEffect, useRef } from "react";
import StreamerHeader from "./StreamerHeader";
import VodCard from "./VodCard";
import CdnRecoveryTab from "./CdnRecoveryTab";
import StreamerCategoriesTab from "./StreamerCategoriesTab";
import { TwitchChannelMeta, TwitchVodItem } from "@/lib/twitch/gql";
import { Loader2, ArrowDownCircle, CheckSquare, CheckCheck, Square, X, Check, Search } from "lucide-react";
import { useToast } from "./Toast";
import { saveWatchStatus, saveBulkWatch, saveStreamerBulkWatch } from "@/lib/watch/client";
import { createWatchOverrides } from "@/lib/watch/overrides";
import { fetchOutageMessage } from "@/lib/twitch/outages";
import { useWatchSettings } from "@/lib/watch-settings";
import { isPageReload } from "@/lib/navigation";

interface StreamerViewProps {
  streamerLogin: string;
  isPinned: boolean;
  onTogglePin: (streamerMeta?: { login: string; displayName?: string; avatarUrl?: string; isLive?: boolean }) => void;
  onPlayVideo: (video: TwitchVodItem) => void;
  onPlayDirectStream: (streamUrl: string, title: string, vodId: string) => void;
  isLoggedIn: boolean;
  onOpenAuth?: () => void;
  onAddToQueue?: (video: TwitchVodItem) => void;
  queueVodIds?: Set<string>;
}

export default function StreamerView({
  streamerLogin,
  isPinned,
  onTogglePin,
  onPlayVideo,
  onPlayDirectStream,
  isLoggedIn,
  onOpenAuth,
  onAddToQueue,
  queueVodIds,
}: StreamerViewProps) {
  const { showToast } = useToast();
  const watchSettings = useWatchSettings();
  const [streamer, setStreamer] = useState<TwitchChannelMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"vods" | "categories" | "cdn">(() => {
    if (typeof window !== "undefined" && isPageReload()) {
      try {
        const tabParam = new URLSearchParams(window.location.search).get("tab");
        if (tabParam && ["vods", "categories", "cdn"].includes(tabParam)) {
          return tabParam as any;
        }
      } catch {}
    }
    return "vods";
  });
  const [activeType, setActiveType] = useState<"ALL" | "ARCHIVE" | "HIGHLIGHT" | "UPLOAD">("ALL");

  // Lazy-load secondary tabs on demand so their background network queries (e.g. /api/categories/favorites and 100-item GQL) don't fire on initial VOD load
  const [hasLoadedCategories, setHasLoadedCategories] = useState(activeTab === "categories");
  const [hasLoadedCdn, setHasLoadedCdn] = useState(activeTab === "cdn");

  useEffect(() => {
    if (activeTab === "categories") setHasLoadedCategories(true);
    if (activeTab === "cdn") setHasLoadedCdn(true);
  }, [activeTab]);

  // Reset to Public VODs and All Broadcasts whenever streamerLogin changes
  useEffect(() => {
    setActiveTab("vods");
    setActiveType("ALL");
    setSearchQuery("");
    setHasLoadedCategories(false);
    setHasLoadedCdn(false);
  }, [streamerLogin]);

  // Synchronize active tab to URL query for current streamer
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        if (activeTab === "vods") {
          url.searchParams.delete("tab");
        } else {
          url.searchParams.set("tab", activeTab);
        }
        const newPath = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
        window.history.replaceState(null, "", newPath);
      } catch {}
    }
  }, [activeTab]);

  // Local watch changes, re-applied over list/search responses fetched before they were saved
  const [watchOverrides] = useState(createWatchOverrides);

  const [videos, setVideos] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [categoriesCount, setCategoriesCount] = useState<number | undefined>();
  const [isLoadingStreamer, setIsLoadingStreamer] = useState(true);
  const [isLoadingVods, setIsLoadingVods] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [targetedCdnVodId, setTargetedCdnVodId] = useState<string>("");

  // Multi-select & Bulk Watched State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedVodIds, setSelectedVodIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Search State for full-catalog VOD search
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [totalSearched, setTotalSearched] = useState<number | null>(null);

  // Debounce user search input by 250ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset search state when switching streamers
  useEffect(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    setSearchResults(null);
    setTotalSearched(null);
  }, [streamerLogin]);

  // Perform full-catalog search on-demand
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      setTotalSearched(null);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    async function performSearch() {
      const searchStartedAt = Date.now();
      setIsSearching(true);
      try {
        const typeParam = activeType === "ALL" ? "" : `&type=${activeType}&broadcastType=${activeType}`;
        const url = `/api/twitch/vods/${encodeURIComponent(streamerLogin)}?q=${encodeURIComponent(debouncedQuery)}${typeParam}&_t=${Date.now()}`;
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          if (!isCancelled) {
            setSearchResults(watchOverrides.apply(data.videos || [], searchStartedAt));
            setTotalSearched(data.totalSearched !== undefined ? data.totalSearched : null);
          }
        } else {
          if (!isCancelled) {
            showToast("Failed to search VODs", "error");
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError" && !isCancelled) {
          showToast("Error searching VODs", "error");
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }

    performSearch();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [debouncedQuery, streamerLogin, activeType]);

  // Fetch streamer profile
  useEffect(() => {
    let isCancelled = false;
    async function loadStreamer() {
      setIsLoadingStreamer(true);
      try {
        const res = await fetch(`/api/twitch/user/${encodeURIComponent(streamerLogin)}`);
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled) setStreamer(data.streamer);
        }
      } catch {
        // Silently catch
      } finally {
        if (!isCancelled) setIsLoadingStreamer(false);
      }
    }

    loadStreamer();
    return () => {
      isCancelled = true;
    };
  }, [streamerLogin]);

  // Fetch initial VODs
  const loadVods = async (reset = true) => {
    const loadStartedAt = Date.now();
    if (reset) {
      setIsLoadingVods(true);
      setVideos([]);
      setCursor(null);
      setSelectedVodIds(new Set());
    } else {
      setIsLoadingMore(true);
    }

    try {
      const currentCursor = reset ? null : cursor;
      // Send both type and broadcastType for reliable server resolution
      const typeParam = activeType === "ALL" ? "" : `&type=${activeType}&broadcastType=${activeType}`;
      const cursorParam = currentCursor ? `&after=${encodeURIComponent(currentCursor)}` : "";
      const url = `/api/twitch/vods/${encodeURIComponent(streamerLogin)}?first=24${typeParam}${cursorParam}&_t=${Date.now()}`;

      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (res.ok) {
        const data = await res.json();
        const incoming = watchOverrides.apply(data.videos || [], loadStartedAt);

        if (reset) {
          setVideos(incoming);
        } else {
          setVideos((prev) => [...prev, ...incoming]);
        }
        setCursor(data.cursor);
        setHasNextPage(data.hasNextPage);
        if (reset) setTotalCount(data.totalCount);
      } else {
        // Explain why when a source is down instead of failing silently
        showToast((await fetchOutageMessage()) || "Failed to load VODs", "error");
      }
    } catch {
      showToast((await fetchOutageMessage()) || "Failed to load VODs", "error");
    } finally {
      setIsLoadingVods(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    loadVods(true);
  }, [streamerLogin, activeType, isLoggedIn]);

  const displayedVideos = searchResults !== null ? searchResults : videos;

  const handleSwitchToCdn = (vodId: string) => {
    setTargetedCdnVodId(vodId);
    setActiveTab("cdn");
  };

  // Applies watch state changes to both the VOD list and active search results
  const applyWatch = (updates: Map<string, { isWatched: boolean; progress: number }>) => {
    updates.forEach((u, id) => watchOverrides.record(id, u.isWatched, u.progress));
    const update = (list: any[]) =>
      list.map((v) => {
        const u = updates.get(String(v.id));
        return u
          ? {
              ...v,
              watchStatus: {
                ...v.watchStatus,
                isWatched: u.isWatched,
                progressSeconds: u.progress,
                isNew: !u.isWatched && u.progress === 0,
              },
            }
          : v;
      });
    setVideos((prev) => update(prev));
    setSearchResults((prev) => (prev ? update(prev) : prev));
  };

  const handleToggleWatch = async (
    vodId: string,
    currentStatus: boolean,
    totalSeconds: number,
    silent = false,
    streamerLoginParam?: string
  ): Promise<boolean> => {
    const loginToUse = streamerLoginParam || streamerLogin;
    if (!loginToUse) {
      showToast("Streamer information missing", "error");
      return false;
    }

    const id = String(vodId);
    const existing = [...videos, ...(searchResults || [])].find((v) => String(v.id) === id);
    const prevProgress = (existing?.watchStatus?.progressSeconds as number) || 0;
    const nextStatus = !currentStatus;
    const nextProgress = nextStatus ? totalSeconds : 0;

    // Optimistic update with rollback on failure
    applyWatch(new Map([[id, { isWatched: nextStatus, progress: nextProgress }]]));

    const err = await saveWatchStatus({
      vodId: id,
      streamerLogin: loginToUse,
      progressSeconds: nextProgress,
      totalSeconds,
      isWatched: nextStatus,
    });

    if (err) {
      applyWatch(new Map([[id, { isWatched: currentStatus, progress: prevProgress }]]));
      showToast(err, "error");
      return false;
    }

    if (!silent) {
      showToast(nextStatus ? "Marked as watched" : "Marked as unwatched", "success", {
        label: "Undo",
        onClick: async () => {
          applyWatch(new Map([[id, { isWatched: currentStatus, progress: prevProgress }]]));
          const undoErr = await saveWatchStatus({
            vodId: id,
            streamerLogin: loginToUse,
            progressSeconds: prevProgress,
            totalSeconds,
            isWatched: currentStatus,
          });
          if (undoErr) {
            applyWatch(new Map([[id, { isWatched: nextStatus, progress: nextProgress }]]));
            showToast(undoErr, "error");
          }
        },
      });
    }
    return true;
  };

  // Sync when queue manager bulk marks items as watched
  useEffect(() => {
    const handleExternalWatchedEvent = (e: any) => {
      const ids = e.detail?.vodIds;
      if (Array.isArray(ids) && ids.length > 0) {
        const idSet = new Set(ids.map(String));
        const markMatching = (list: any[]) =>
          list.map((v) =>
            idSet.has(String(v.id))
              ? {
                  ...v,
                  watchStatus: {
                    ...(v.watchStatus || {}),
                    isWatched: true,
                    progressSeconds: v.lengthSeconds || v.watchStatus?.totalSeconds || 0,
                    isNew: false,
                  },
                }
              : v
          );

        setVideos((prev) => markMatching(prev));
        if (searchResults !== null) {
          setSearchResults((prev) => (prev ? markMatching(prev) : null));
        }
      }
    };
    window.addEventListener("twitch_vods_marked_watched", handleExternalWatchedEvent);
    return () => {
      window.removeEventListener("twitch_vods_marked_watched", handleExternalWatchedEvent);
    };
  }, [searchResults]);

  const handlePlayVideoAndMarkWatched = (video: TwitchVodItem) => {
    const watch = (video as any).watchStatus;
    if (watchSettings.markWatchedOnPlay && !watch?.isWatched) {
      handleToggleWatch(video.id, false, video.lengthSeconds, true, video.owner?.login);
    }
    onPlayVideo(video);
  };

  const handlePlayDirectStreamAndMarkWatched = (streamUrl: string, title: string, vodId: string) => {
    if (watchSettings.markWatchedOnPlay && vodId) {
      handleToggleWatch(vodId, false, 0, true);
    }
    onPlayDirectStream(streamUrl, title, vodId);
  };

  // Multi-select handlers
  const handleToggleSelect = (vodId: string) => {
    setSelectedVodIds((prev) => {
      const next = new Set(prev);
      if (next.has(vodId)) {
        next.delete(vodId);
      } else {
        next.add(vodId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedVodIds.size === displayedVideos.length) {
      setSelectedVodIds(new Set());
    } else {
      setSelectedVodIds(new Set(displayedVideos.map((v) => v.id)));
    }
  };

  // Marks the given VODs watched (optimistically) and offers Undo restoring each one's prior progress
  const markVodsWatched = async (targetVideos: any[], label: string) => {
    const items = targetVideos.map((v) => ({
      vodId: String(v.id),
      streamerLogin,
      totalSeconds: v.lengthSeconds || 0,
    }));
    const previous = targetVideos.flatMap((v, i) =>
      v.watchStatus?.isWatched
        ? []
        : [{ item: items[i], progress: (v.watchStatus?.progressSeconds as number) || 0 }]
    );

    applyWatch(new Map(items.map((it) => [it.vodId, { isWatched: true, progress: it.totalSeconds }])));
    const err = await saveBulkWatch(items);

    if (err) {
      applyWatch(
        new Map(
          targetVideos.map((v) => [
            String(v.id),
            { isWatched: Boolean(v.watchStatus?.isWatched), progress: (v.watchStatus?.progressSeconds as number) || 0 },
          ])
        )
      );
      showToast(err, "error");
      return false;
    }

    const undo = async () => {
      applyWatch(new Map(previous.map((p) => [p.item.vodId, { isWatched: false, progress: p.progress }])));
      const clean = previous.filter((p) => p.progress === 0).map((p) => p.item);
      const results = await Promise.all([
        clean.length > 0 ? saveBulkWatch(clean, false) : Promise.resolve(null),
        ...previous
          .filter((p) => p.progress > 0)
          .map((p) =>
            saveWatchStatus({
              vodId: p.item.vodId,
              streamerLogin,
              isWatched: false,
              progressSeconds: p.progress,
              totalSeconds: p.item.totalSeconds,
            })
          ),
      ]);
      const undoErr = results.find(Boolean);
      if (undoErr) showToast(undoErr, "error");
    };
    showToast(label, "success", previous.length > 0 ? { label: "Undo", onClick: undo } : undefined);
    return true;
  };

  const handleMarkSelectedWatched = async () => {
    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }
    if (selectedVodIds.size === 0) return;

    setIsBulkUpdating(true);
    try {
      const targetVideos = displayedVideos.filter((v) => selectedVodIds.has(v.id));
      const ok = await markVodsWatched(targetVideos, `Marked ${targetVideos.length} VODs as watched`);
      if (ok) {
        setSelectedVodIds(new Set());
        setIsSelectionMode(false);
      }
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleMarkAllWatched = async () => {
    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }

    if (displayedVideos.length === 0) return;

    setIsBulkUpdating(true);
    try {
      if (watchSettings.markAllWatchedScope === "all") {
        const { error, updatedCount } = await saveStreamerBulkWatch(streamerLogin);
        if (error) {
          showToast(error, "error");
          return;
        }
        const markAll = (list: any[]) =>
          list.map((v) => ({
            ...v,
            watchStatus: { ...v.watchStatus, isWatched: true, progressSeconds: v.lengthSeconds || 0, isNew: false },
          }));
        setVideos((prev) => markAll(prev));
        setSearchResults((prev) => (prev ? markAll(prev) : prev));
        showToast(`Marked all ${updatedCount} VODs by ${streamerLogin} as watched`);
        setSelectedVodIds(new Set());
        setIsSelectionMode(false);
      } else {
        // Loaded VODs only (default)
        const ok = await markVodsWatched(displayedVideos, `Marked all ${displayedVideos.length} loaded VODs as watched`);
        if (ok) {
          setSelectedVodIds(new Set());
          setIsSelectionMode(false);
        }
      }
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Mark every VOD of this channel older than a chosen date as watched (server-side, covers all pages)
  const [showCutoff, setShowCutoff] = useState(false);
  const [cutoffDate, setCutoffDate] = useState("");

  const handleMarkOlderThan = async () => {
    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }
    if (!cutoffDate) return;

    // Local start-of-day of the chosen date
    const cutoff = new Date(`${cutoffDate}T00:00:00`);
    if (Number.isNaN(cutoff.getTime())) return;

    setIsBulkUpdating(true);
    try {
      const { error, updatedCount } = await saveStreamerBulkWatch(streamerLogin, cutoff.toISOString());
      if (error) {
        showToast(error, "error");
        return;
      }
      const cutoffMs = cutoff.getTime();
      const markOld = (list: any[]) =>
        list.map((v) => {
          const created = Date.parse(String(v.createdAt || v.publishedAt || ""));
          return !Number.isNaN(created) && created < cutoffMs
            ? {
                ...v,
                watchStatus: { ...v.watchStatus, isWatched: true, progressSeconds: v.lengthSeconds || 0, isNew: false },
              }
            : v;
        });
      setVideos((prev) => markOld(prev));
      setSearchResults((prev) => (prev ? markOld(prev) : prev));
      showToast(
        updatedCount === 0
          ? `No VODs older than ${cutoffDate}`
          : `Marked ${updatedCount} VOD${updatedCount === 1 ? "" : "s"} older than ${cutoffDate} as watched`
      );
      setShowCutoff(false);
      setCutoffDate("");
    } finally {
      setIsBulkUpdating(false);
    }
  };

  return (
    <div className="w-full">
      {/* Streamer Profile Header */}
      {isLoadingStreamer ? (
        <div className="h-44 w-full bg-[#18181b] animate-pulse"></div>
      ) : streamer ? (
        <StreamerHeader
          streamer={streamer}
          isPinned={isPinned}
          onTogglePin={() =>
            onTogglePin({
              login: streamer.login,
              displayName: streamer.displayName,
              avatarUrl: streamer.profileImageURL,
              isLive: streamer.isLive,
            })
          }
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          vodCount={totalCount}
          categoriesCount={categoriesCount}
        />
      ) : (
        <div className="p-8 text-center bg-[#18181b] text-xs text-[#767682]">
          Channel metadata could not be resolved.
        </div>
      )}

      {/* Tab Contents */}
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 w-full">
        {/* Public VODs Tab */}
        <div className={activeTab === "vods" ? "space-y-4 animate-tab-fade-in" : "hidden"}>
          {/* Filter & Actions Toolbar */}
          <div className="space-y-2.5 pb-2 border-b border-[#2d2d34]">
            <div className="flex items-center justify-between flex-wrap gap-2.5">
              {/* Broadcast Type Filter Buttons */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full pb-0.5">
                {(
                  [
                    { id: "ALL", label: "All Broadcasts" },
                    { id: "ARCHIVE", label: "Past Broadcasts" },
                    { id: "HIGHLIGHT", label: "Highlights" },
                    { id: "UPLOAD", label: "Uploads" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveType(t.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap active:scale-[0.98] ${
                      activeType === t.id
                        ? "bg-[#26262c] text-[#efeff1]"
                        : "text-[#767682] hover:text-[#efeff1]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Search Bar for Full-Catalog VOD Search */}
              <div className="relative w-full sm:w-auto sm:flex-1 min-w-[180px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#adadb8]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search all VODs by title or game..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-[#18181b] border border-[#2d2d34] rounded-md text-[#efeff1] placeholder-[#767682] focus:outline-none focus:border-[#9146ff] focus:ring-1 focus:ring-[#9146ff] transition-all"
                />
                {isSearching ? (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-[#9146ff]" />
                ) : searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[#767682] hover:text-white hover:bg-[#26262c] transition-colors"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Right Side Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[#767682] tabular-nums hidden sm:inline">
                  {searchResults !== null
                    ? `Showing ${searchResults.length} of ${totalSearched !== null ? totalSearched : searchResults.length} VODs`
                    : `Showing ${videos.length} ${totalCount !== undefined ? `of ${totalCount}` : ""} VODs`}
                </span>

                {!isSelectionMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsSelectionMode(true)}
                      disabled={displayedVideos.length === 0}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-[#2d2d34] bg-[#18181b] hover:bg-[#26262c] text-[#efeff1] flex items-center gap-1.5 transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                      title="Select VODs to mark as watched"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-[#adadb8]" />
                      <span>Select</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleMarkAllWatched}
                      disabled={isBulkUpdating || displayedVideos.length === 0}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-[#2d2d34] bg-[#18181b] hover:bg-[#26262c] text-[#efeff1] hover:text-[#00f59b] flex items-center gap-1.5 transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                      title={
                        searchResults !== null
                          ? "Mark all matching search results as watched"
                          : "Mark all currently loaded VODs as watched"
                      }
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-[#00f59b]" />
                      <span>Mark All as Watched</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowCutoff((p) => !p)}
                      disabled={isBulkUpdating}
                      aria-expanded={showCutoff}
                      className={`px-2.5 py-1 text-xs font-medium rounded border bg-[#18181b] hover:bg-[#26262c] flex items-center gap-1.5 transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer ${
                        showCutoff ? "border-[#9146ff]/60 text-[#bf94ff]" : "border-[#2d2d34] text-[#efeff1]"
                      }`}
                      title="Mark every VOD older than a chosen date as watched"
                    >
                      <span>Older than&hellip;</span>
                    </button>
                    {showCutoff && (
                      <div className="flex items-center gap-1.5 animate-tab-fade-in">
                        <input
                          type="date"
                          value={cutoffDate}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setCutoffDate(e.target.value)}
                          className="px-2 py-1 text-xs rounded border border-[#3d3d46] bg-[#0e0e10] text-[#efeff1] [color-scheme:dark]"
                          aria-label="Mark VODs older than this date as watched"
                        />
                        <button
                          type="button"
                          onClick={handleMarkOlderThan}
                          disabled={!cutoffDate || isBulkUpdating}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-[#00f59b] hover:bg-[#00f59b]/90 text-black disabled:opacity-40 cursor-pointer active:scale-[0.98]"
                        >
                          Mark watched
                        </button>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>

            {/* Active Search Results Banner */}
            {searchResults !== null && !isSearching && (
              <div className="flex items-center justify-between text-xs py-1.5 px-3 bg-[#18181b] border border-[#2d2d34] rounded-md animate-tab-fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-[#adadb8]">
                    Found <strong className="text-white">{searchResults.length}</strong>{" "}
                    {searchResults.length === 1 ? "broadcast" : "broadcasts"} matching{" "}
                    <span className="text-[#9146ff] font-medium">&ldquo;{debouncedQuery}&rdquo;</span>
                    {totalSearched !== null ? ` across all ${totalSearched} broadcasts` : " across all broadcasts"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-[11px] text-[#adadb8] hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
                >
                  Clear Search
                </button>
              </div>
            )}

            {/* Selection Mode Action Bar */}
            {isSelectionMode && (
              <div className="flex items-center justify-between flex-wrap gap-2.5 p-2.5 bg-[#1f1a2e] border border-[#9146ff]/40 rounded-lg animate-fade-in-up">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white px-2 py-0.5 rounded bg-[#9146ff]/30 border border-[#9146ff]/50">
                    {selectedVodIds.size} Selected
                  </span>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-xs text-[#adadb8] hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {selectedVodIds.size === displayedVideos.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleMarkSelectedWatched}
                    disabled={selectedVodIds.size === 0 || isBulkUpdating}
                    className="px-3 py-1 bg-[#00f59b] hover:bg-[#00f59b]/90 text-black text-xs font-semibold rounded flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer shadow-sm shadow-[#00f59b]/20"
                  >
                    {isBulkUpdating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Mark Selected as Watched ({selectedVodIds.size})</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleMarkAllWatched}
                    disabled={displayedVideos.length === 0 || isBulkUpdating}
                    className="px-3 py-1 bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] text-xs font-medium rounded border border-[#3d3d46] flex items-center gap-1.5 transition-colors active:scale-[0.98] disabled:opacity-40 cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-[#00f59b]" />
                    <span>Mark All as Watched</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedVodIds(new Set());
                    }}
                    className="p-1 rounded text-[#adadb8] hover:text-white hover:bg-[#26262c] transition-colors cursor-pointer"
                    title="Cancel selection"
                    aria-label="Cancel selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* VOD Cards Grid */}
          {isSearching || (searchResults === null && isLoadingVods) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="rounded-lg bg-[#18181b] border border-[#2d2d34] overflow-hidden space-y-2.5 p-3">
                  <div className="aspect-video w-full skeleton"></div>
                  <div className="h-3.5 w-3/4 skeleton"></div>
                  <div className="h-3 w-1/2 skeleton"></div>
                </div>
              ))}
            </div>
          ) : searchResults !== null && searchResults.length === 0 ? (
            <div className="p-10 text-center rounded-lg bg-[#18181b] border border-[#2d2d34] space-y-3">
              <p className="text-xs text-[#efeff1] font-medium">
                No broadcasts found matching &ldquo;{debouncedQuery}&rdquo;
              </p>
              <p className="text-[11px] text-[#767682]">
                Searched across all {totalSearched !== null ? `${totalSearched} ` : ""}broadcasts for this channel.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="px-3 py-1.5 text-xs font-medium rounded border border-[#2d2d34] bg-[#26262c] hover:bg-[#32323a] text-white transition-colors cursor-pointer"
              >
                Clear Search
              </button>
            </div>
          ) : displayedVideos.length === 0 ? (
            <div className="p-10 text-center rounded-lg bg-[#18181b] border border-[#2d2d34]">
              <p className="text-xs text-[#767682]">No {activeType.toLowerCase()} VODs found for this channel.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
              {displayedVideos.map((video, idx) => (
                <VodCard
                  key={video.id}
                  video={video}
                  onPlay={handlePlayVideoAndMarkWatched}
                  onRecoverCdn={handleSwitchToCdn}
                  onToggleWatch={handleToggleWatch}
                  isLoggedIn={isLoggedIn}
                  staggerIndex={idx}
                  isSelected={selectedVodIds.has(video.id)}
                  onToggleSelect={handleToggleSelect}
                  selectionMode={isSelectionMode}
                  onAddToQueue={onAddToQueue}
                  isInQueue={queueVodIds ? queueVodIds.has(String(video.id)) : false}
                />
              ))}
            </div>
          )}

          {/* Pagination Button (only in normal browsing mode, not search) */}
          {searchResults === null && hasNextPage && !isLoadingVods && (
            <div className="pt-4 text-center">
              <button
                onClick={() => loadVods(false)}
                disabled={isLoadingMore}
                className="px-5 py-2 bg-[#18181b] hover:bg-[#26262c] text-[#efeff1] font-semibold text-xs rounded-md border border-[#2d2d34] transition-colors flex items-center justify-center gap-2 mx-auto active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {isLoadingMore ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9146ff]" />
                ) : (
                  <ArrowDownCircle className="w-3.5 h-3.5 text-[#adadb8]" />
                )}
                <span>Load More Broadcasts</span>
              </button>
            </div>
          )}
        </div>

        {/* Categories Tab (mounted lazily on demand) */}
        {hasLoadedCategories && (
          <div className={activeTab === "categories" ? "block animate-tab-fade-in" : "hidden"}>
            <StreamerCategoriesTab
              streamerLogin={streamerLogin}
              onPlayVideo={handlePlayVideoAndMarkWatched}
              onRecoverCdn={handleSwitchToCdn}
              onToggleWatch={handleToggleWatch}
              isLoggedIn={isLoggedIn}
              onOpenAuth={onOpenAuth}
              onCategoriesCountResolved={setCategoriesCount}
            />
          </div>
        )}

        {/* Streams & CDN Recovery Tab (mounted lazily on demand) */}
        {hasLoadedCdn && (
          <div className={activeTab === "cdn" ? "block animate-tab-fade-in" : "hidden"}>
            <CdnRecoveryTab
              initialVodId={targetedCdnVodId}
              streamerLogin={streamerLogin}
              onPlayStream={handlePlayDirectStreamAndMarkWatched}
              isLoggedIn={isLoggedIn}
              onOpenAuth={onOpenAuth}
              onToggleWatch={handleToggleWatch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
