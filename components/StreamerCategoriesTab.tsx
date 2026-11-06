"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Star, Gamepad2, ArrowLeft, Search, Layers, Play, Calendar, Film, Loader2, RefreshCw } from "lucide-react";
import VodCard, { formatRelativeDate } from "./VodCard";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { useToast } from "./Toast";
import { useDateFormat } from "@/lib/date";

interface StreamerCategoriesTabProps {
  streamerLogin: string;
  videos?: any[];
  onPlayVideo: (video: TwitchVodItem) => void;
  onRecoverCdn: (vodId: string) => void;
  onToggleWatch: (
    vodId: string,
    currentStatus: boolean,
    totalSeconds: number,
    silent?: boolean,
    streamerLogin?: string
  ) => Promise<boolean | void> | boolean | void;
  isLoggedIn: boolean;
  onOpenAuth?: () => void;
  onCategoriesCountResolved?: (count: number) => void;
}

interface CategoryGroup {
  name: string;
  boxArtUrl: string;
  videos: any[];
  count: number;
  latestDate: string;
}

export default function StreamerCategoriesTab({
  streamerLogin,
  videos: initialVideos,
  onPlayVideo,
  onRecoverCdn,
  onToggleWatch,
  isLoggedIn,
  onOpenAuth,
  onCategoriesCountResolved,
}: StreamerCategoriesTabProps) {
  const { showToast } = useToast();
  const dateFormat = useDateFormat();
  const [channelVideos, setChannelVideos] = useState<any[]>(initialVideos || []);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<"ALL" | "ARCHIVE" | "HIGHLIGHT" | "UPLOAD">("ALL");
  const [favoriteCategoryNames, setFavoriteCategoryNames] = useState<Set<string>>(new Set());
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);

  // Load broadcasts across ALL types (not restricted by activeType)
  const loadChannelBroadcasts = async (reset = true) => {
    if (reset) {
      setIsLoadingVideos(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const cursorParam = !reset && nextCursor ? `&after=${encodeURIComponent(nextCursor)}` : "";
      // Fetch across ALL broadcast types (no type parameter) with maximum page size
      const res = await fetch(
        `/api/twitch/vods/${encodeURIComponent(streamerLogin)}?first=100${cursorParam}&_t=${Date.now()}`,
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const incoming = data.videos || [];
        if (reset) {
          setChannelVideos(incoming);
        } else {
          setChannelVideos((prev) => [...prev, ...incoming]);
        }
        setNextCursor(data.cursor || null);
        setHasNextPage(Boolean(data.hasNextPage));
      }
    } catch {
      showToast("Failed to load channel categories", "error");
    } finally {
      setIsLoadingVideos(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (streamerLogin) {
      setSelectedCategory(null);
      loadChannelBroadcasts(true);
    }
  }, [streamerLogin, isLoggedIn]);

  // Load user's favorite categories
  const loadFavorites = async () => {
    if (!isLoggedIn) {
      setFavoriteCategoryNames(new Set());
      return;
    }
    setIsLoadingFavorites(true);
    try {
      const res = await fetch("/api/categories/favorites");
      if (res.ok) {
        const data = await res.json();
        const names = new Set<string>((data.categories || []).map((c: any) => String(c.name).toLowerCase()));
        setFavoriteCategoryNames(names);
      }
    } catch {
      // Silently catch
    } finally {
      setIsLoadingFavorites(false);
    }
  };

  useEffect(() => {
    loadFavorites();
  }, [isLoggedIn]);

  // Group videos across all broadcasts by category name
  const categories = useMemo<CategoryGroup[]>(() => {
    const map = new Map<string, CategoryGroup>();

    for (const v of channelVideos) {
      const catName = v.game?.name || "Other Broadcasts";
      const gameId = v.game?.id;
      let boxArt = "";

      if (v.game?.boxArtURL) {
        if (v.game.boxArtURL.startsWith("/api/categories/thumbnail/")) {
          boxArt = v.game.boxArtURL;
        } else {
          const match = v.game.boxArtURL.match(/ttv-boxart\/([a-zA-Z0-9_-]+?)(?:-\d+x\d+|-\{width\}x\{height\}|\.(?:jpg|png|jpeg))/i);
          const slug = match ? match[1] : (gameId ? String(gameId).replace(/[^a-zA-Z0-9_]/g, "") : "");
          const highRes = v.game.boxArtURL
            .replace(/-\d+x\d+\.(jpg|png|jpeg)/i, "-285x380.$1")
            .replace(/\{width\}x\{height\}/i, "285x380");
          if (slug) {
            boxArt = `/api/categories/thumbnail/${slug}?url=${encodeURIComponent(highRes)}`;
          } else {
            boxArt = highRes;
          }
        }
      } else if (gameId) {
        boxArt = `/api/categories/thumbnail/${String(gameId).replace(/[^a-zA-Z0-9_]/g, "")}`;
      }

      if (!map.has(catName)) {
        map.set(catName, {
          name: catName,
          boxArtUrl: boxArt,
          videos: [v],
          count: 1,
          latestDate: v.createdAt || v.publishedAt || "",
        });
      } else {
        const existing = map.get(catName)!;
        existing.videos.push(v);
        existing.count += 1;
        if (!existing.boxArtUrl && boxArt) {
          existing.boxArtUrl = boxArt;
        }
      }
    }

    const list = Array.from(map.values());
    // Sort by stream count descending, then by name
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return list;
  }, [channelVideos]);

  // Inform parent of total category count
  useEffect(() => {
    onCategoriesCountResolved?.(categories.length);
  }, [categories.length, onCategoriesCountResolved]);

  // Toggle favorite status on a category
  const handleToggleFavorite = async (categoryName: string, boxArtUrl?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }

    const cleanLower = categoryName.toLowerCase();
    const isCurrentlyFav = favoriteCategoryNames.has(cleanLower);

    try {
      if (isCurrentlyFav) {
        // Remove
        const res = await fetch(`/api/categories/favorites?name=${encodeURIComponent(categoryName)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setFavoriteCategoryNames((prev) => {
            const next = new Set(prev);
            next.delete(cleanLower);
            return next;
          });
          showToast(`Removed "${categoryName}" from favorites`);
        } else {
          const data = await res.json().catch(() => ({}));
          showToast(data.error || "Failed to remove favorite category", "error");
        }
      } else {
        // Add
        const res = await fetch("/api/categories/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryName, boxArtUrl }),
        });
        if (res.ok) {
          setFavoriteCategoryNames((prev) => new Set(prev).add(cleanLower));
          showToast(`Added "${categoryName}" to favorites`);
        } else {
          const data = await res.json().catch(() => ({}));
          showToast(data.error || "Failed to add favorite category", "error");
        }
      }
    } catch {
      showToast("Failed to update favorite category", "error");
    }
  };

  // Filtered categories for the overview grid
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      const matchesSearch = cat.name.toLowerCase().includes(searchQuery.toLowerCase());
      const isFav = favoriteCategoryNames.has(cat.name.toLowerCase());
      if (showOnlyFavorites) {
        return matchesSearch && isFav;
      }
      return matchesSearch;
    });
  }, [categories, searchQuery, showOnlyFavorites, favoriteCategoryNames]);

  // Current category details when drilled down
  const activeCategoryGroup = useMemo(() => {
    if (!selectedCategory) return null;
    return categories.find((c) => c.name.toLowerCase() === selectedCategory.toLowerCase());
  }, [categories, selectedCategory]);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Category Drilldown View */}
      {selectedCategory && activeCategoryGroup ? (
        <div className="space-y-5">
          {/* Back button & Category Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-[#18181b] border border-[#2d2d34]">
            <div className="flex items-center gap-4 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className="px-3 py-1.5 rounded-md bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-[0.98] flex-shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>All Categories</span>
              </button>

              <div className="flex items-center gap-3 min-w-0">
                {activeCategoryGroup.boxArtUrl ? (
                  <img
                    src={activeCategoryGroup.boxArtUrl}
                    alt={activeCategoryGroup.name}
                    className="w-10 h-14 rounded object-cover border border-[#2d2d34] flex-shrink-0 bg-[#0e0e10]"
                  />
                ) : (
                  <div className="w-10 h-14 rounded bg-[#26262c] border border-[#2d2d34] flex items-center justify-center text-[#9146ff] flex-shrink-0">
                    <Gamepad2 className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white truncate">
                    {activeCategoryGroup.name}
                  </h2>
                  <p className="text-xs text-[#767682]">
                    {activeCategoryGroup.count} {activeCategoryGroup.count === 1 ? "stream" : "streams"} by @{streamerLogin}
                  </p>
                </div>
              </div>
            </div>

            {/* Favorite Category Toggle Button */}
            <button
              type="button"
              onClick={(e) => handleToggleFavorite(activeCategoryGroup.name, activeCategoryGroup.boxArtUrl, e)}
              className={`px-3 py-1.5 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98] ${
                favoriteCategoryNames.has(activeCategoryGroup.name.toLowerCase())
                  ? "bg-amber-400/15 border-amber-400/50 text-amber-300 hover:bg-amber-400/25"
                  : "bg-[#26262c] hover:bg-[#32323a] border-[#3d3d46] text-[#adadb8] hover:text-white"
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  favoriteCategoryNames.has(activeCategoryGroup.name.toLowerCase())
                    ? "fill-amber-400 text-amber-400"
                    : "text-[#adadb8]"
                }`}
              />
              <span>
                {favoriteCategoryNames.has(activeCategoryGroup.name.toLowerCase())
                  ? "Favorited Category"
                  : "Favorite Category"}
              </span>
            </button>
          </div>

          {/* Type Filter Toolbar within Category (if multiple types exist) */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: "ALL", label: "All Streams" },
                  { id: "ARCHIVE", label: "Past Broadcasts" },
                  { id: "HIGHLIGHT", label: "Highlights" },
                  { id: "UPLOAD", label: "Uploads" },
                ] as const
              ).map((t) => {
                const count =
                  t.id === "ALL"
                    ? activeCategoryGroup.videos.length
                    : activeCategoryGroup.videos.filter(
                        (v) => (v.broadcastType || "").toUpperCase() === t.id
                      ).length;
                if (t.id !== "ALL" && count === 0) return null;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCategoryTypeFilter(t.id)}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
                      categoryTypeFilter === t.id
                        ? "bg-[#9146ff] text-white shadow-sm"
                        : "bg-[#26262c] text-[#adadb8] hover:text-[#efeff1]"
                    }`}
                  >
                    {t.label} ({count})
                  </button>
                );
              })}
            </div>

            <span className="text-xs text-[#767682] tabular-nums">
              Showing{" "}
              {categoryTypeFilter === "ALL"
                ? activeCategoryGroup.videos.length
                : activeCategoryGroup.videos.filter(
                    (v) => (v.broadcastType || "").toUpperCase() === categoryTypeFilter
                  ).length}{" "}
              streams
            </span>
          </div>

          {/* Grid of VODs in this category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
            {activeCategoryGroup.videos
              .filter((v) => {
                if (categoryTypeFilter === "ALL") return true;
                return (v.broadcastType || "").toUpperCase() === categoryTypeFilter;
              })
              .map((video, idx) => (
                <VodCard
                  key={video.id}
                  video={video}
                  onPlay={onPlayVideo}
                  onRecoverCdn={onRecoverCdn}
                  onToggleWatch={async (vodId, currentStatus, totalSec, silent, streamerLogin) => {
                    const result = await onToggleWatch(vodId, currentStatus, totalSec, silent, streamerLogin);
                    if (result !== false) {
                      setChannelVideos((prev) =>
                        prev.map((v) => {
                          if (v.id === vodId) {
                            return {
                              ...v,
                              watchStatus: {
                                ...v.watchStatus,
                                isWatched: !currentStatus,
                                progressSeconds: currentStatus ? 0 : totalSec,
                                isNew: currentStatus,
                              },
                            };
                          }
                          return v;
                        })
                      );
                    }
                  }}
                  isLoggedIn={isLoggedIn}
                  staggerIndex={idx}
                />
              ))}
          </div>
        </div>
      ) : (
        /* Categories Overview Grid */
        <div className="space-y-5">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#2d2d34]">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#767682] absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search categories (e.g. VALORANT, Just Chatting)…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowOnlyFavorites((prev) => !prev)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md border flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98] ${
                  showOnlyFavorites
                    ? "bg-amber-400/15 border-amber-400/50 text-amber-300"
                    : "bg-[#18181b] hover:bg-[#26262c] border-[#2d2d34] text-[#adadb8] hover:text-[#efeff1]"
                }`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    showOnlyFavorites ? "fill-amber-400 text-amber-400" : "text-[#adadb8]"
                  }`}
                />
                <span>Favorited Only</span>
              </button>

              <span className="text-[11px] text-[#767682] tabular-nums">
                {filteredCategories.length} {filteredCategories.length === 1 ? "category" : "categories"}
              </span>
            </div>
          </div>

          {/* Loading Skeleton */}
          {isLoadingVideos && channelVideos.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="rounded-lg bg-[#18181b] border border-[#2d2d34] overflow-hidden space-y-2 p-2">
                  <div className="aspect-[3/4] w-full skeleton rounded"></div>
                  <div className="h-3 w-3/4 skeleton rounded"></div>
                  <div className="h-2.5 w-1/2 skeleton rounded"></div>
                </div>
              ))}
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="p-10 text-center rounded-lg bg-[#18181b] border border-[#2d2d34] space-y-2">
              <Gamepad2 className="w-8 h-8 text-[#767682] mx-auto opacity-50" />
              <p className="text-xs text-[#767682]">
                {showOnlyFavorites
                  ? "No favorited categories found for this creator. Star a category to add it to your favorites!"
                  : "No categories found matching your search."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {filteredCategories.map((cat, idx) => {
                const isFav = favoriteCategoryNames.has(cat.name.toLowerCase());

                return (
                  <div
                    key={cat.name}
                    style={{ animationDelay: `${Math.min(idx * 30, 240)}ms` }}
                    onClick={() => {
                      setSelectedCategory(cat.name);
                      setCategoryTypeFilter("ALL");
                    }}
                    className="group bg-[#18181b] rounded-lg border border-[#2d2d34] hover:border-[#9146ff]/60 overflow-hidden flex flex-col transition-all cursor-pointer animate-fade-in-up hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#9146ff]/10"
                  >
                    {/* Box Art Cover Poster (3:4 ratio) */}
                    <div className="relative aspect-[3/4] w-full bg-[#0e0e10] overflow-hidden">
                      {cat.boxArtUrl ? (
                        <img
                          src={cat.boxArtUrl}
                          alt={cat.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = "none";
                            const fallback = (e.currentTarget.parentElement as HTMLElement)?.querySelector(".category-fallback");
                            if (fallback) (fallback as HTMLElement).style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        className="category-fallback w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-[#18181b] to-[#0e0e10]"
                        style={{ display: cat.boxArtUrl ? "none" : "flex" }}
                      >
                        <Gamepad2 className="w-8 h-8 text-[#9146ff]/50 mb-1" />
                        <span className="text-[11px] font-semibold text-[#adadb8] line-clamp-2">
                          {cat.name}
                        </span>
                      </div>

                      {/* Favorite Star Button (top right) */}
                      <button
                        type="button"
                        onClick={(e) => handleToggleFavorite(cat.name, cat.boxArtUrl, e)}
                        className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-all active:scale-90 z-20 ${
                          isFav
                            ? "bg-black/85 text-amber-400 shadow-md"
                            : "bg-black/60 text-[#adadb8] hover:text-white opacity-0 group-hover:opacity-100"
                        }`}
                        title={isFav ? `Unfavorite ${cat.name}` : `Favorite ${cat.name}`}
                        aria-label={isFav ? `Unfavorite ${cat.name}` : `Favorite ${cat.name}`}
                      >
                        <Star className={`w-3.5 h-3.5 ${isFav ? "fill-amber-400 text-amber-400" : ""}`} />
                      </button>

                      {/* Stream Count Badge */}
                      <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/85 text-white text-[10px] font-semibold tabular-nums z-10 flex items-center gap-1 shadow-sm">
                        <Film className="w-2.5 h-2.5 text-[#9146ff]" />
                        <span>{cat.count} {cat.count === 1 ? "stream" : "streams"}</span>
                      </div>
                    </div>

                    {/* Category Title & Info */}
                    <div className="p-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h3
                          className="text-xs font-bold text-[#efeff1] group-hover:text-[#bf94ff] line-clamp-1 transition-colors"
                          title={cat.name}
                        >
                          {cat.name}
                        </h3>
                        {cat.latestDate && (
                          <p className="text-[10px] text-[#767682] mt-0.5">
                            Last streamed {formatRelativeDate(cat.latestDate, dateFormat)}
                          </p>
                        )}
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-[#2d2d34]/60 flex items-center justify-between text-[10px] text-[#9146ff] font-semibold">
                        <span>View Streams</span>
                        <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More Streams to Discover More Categories */}
          {hasNextPage && !isLoadingVideos && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => loadChannelBroadcasts(false)}
                disabled={isLoadingMore}
                className="px-4 py-2 bg-[#18181b] hover:bg-[#26262c] text-[#efeff1] font-semibold text-xs rounded-md border border-[#2d2d34] transition-colors flex items-center justify-center gap-2 mx-auto active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {isLoadingMore ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9146ff]" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-[#adadb8]" />
                )}
                <span>Scan Earlier Broadcasts for More Categories</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
