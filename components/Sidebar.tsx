"use client";

import React, { useState, useMemo } from "react";
import {
  Bookmark,
  Users,
  X,
  Tv,
  Home,
  ChevronDown,
  ChevronRight,
  Folder,
  SlidersHorizontal,
  Search,
  Eye,
  EyeOff,
} from "lucide-react";

export interface PinnedStreamer {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  pinnedAt?: string;
  groupName?: string;
  isHidden?: boolean;
  sortOrder?: number;
  isLive?: boolean;
}

interface SidebarProps {
  pinnedStreamers: PinnedStreamer[];
  activeStreamerLogin: string | null;
  activeView: "home" | "streamer" | "feed" | "settings";
  onSelectStreamer: (login: string) => void;
  onSelectFeed: () => void;
  onSelectHome: () => void;
  onUnpinStreamer: (login: string) => void;
  onOpenAuth: () => void;
  onOpenManagement?: () => void;
  onToggleHideStreamer?: (login: string, isHidden: boolean) => void;
  isLoggedIn: boolean;
  isLoading?: boolean;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  /** Unwatched broadcast counts per creator (lowercase login), derived from the last loaded feed */
  unwatchedCounts?: Record<string, number>;
}

export default function Sidebar({
  pinnedStreamers,
  activeStreamerLogin,
  activeView,
  onSelectStreamer,
  onSelectFeed,
  onSelectHome,
  onUnpinStreamer,
  onOpenAuth,
  onOpenManagement,
  onToggleHideStreamer,
  isLoggedIn,
  isLoading = false,
  isOpenMobile = false,
  onCloseMobile,
  unwatchedCounts,
}: SidebarProps) {
  const [unpinningLogins, setUnpinningLogins] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showHiddenSection, setShowHiddenSection] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const handleSelectHome = () => {
    onSelectHome();
    onCloseMobile?.();
  };

  const handleSelectFeed = () => {
    onSelectFeed();
    onCloseMobile?.();
  };

  const handleSelectStreamer = (login: string) => {
    onSelectStreamer(login);
    onCloseMobile?.();
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

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Visible vs Hidden streamers
  const { visibleStreamers, hiddenStreamers } = useMemo(() => {
    const visible: PinnedStreamer[] = [];
    const hidden: PinnedStreamer[] = [];

    const sorted = [...pinnedStreamers].sort((a, b) => {
      const orderA = a.sortOrder ?? 0;
      const orderB = b.sortOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime();
    });

    sorted.forEach((s) => {
      if (s.isHidden) {
        hidden.push(s);
      } else {
        visible.push(s);
      }
    });

    return { visibleStreamers: visible, hiddenStreamers: hidden };
  }, [pinnedStreamers]);

  // Group visible streamers by groupName
  const groupedVisibleStreamers = useMemo(() => {
    const groups: { [group: string]: PinnedStreamer[] } = {};

    const filtered = visibleStreamers.filter(
      (s) =>
        s.displayName.toLowerCase().includes(filterQuery.toLowerCase()) ||
        s.login.toLowerCase().includes(filterQuery.toLowerCase())
    );

    filtered.forEach((s) => {
      const g = s.groupName?.trim() || "General";
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    });

    return groups;
  }, [visibleStreamers, filterQuery]);

  const groupKeys = Object.keys(groupedVisibleStreamers).sort((a, b) => {
    if (a === "General") return -1;
    if (b === "General") return 1;
    return a.localeCompare(b);
  });

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] h-full flex flex-col bg-[#18181b] border-r border-[#2d2d34] flex-shrink-0 select-none shadow-2xl transition-transform duration-300 ease-in-out md:static md:w-60 md:translate-x-0 md:shadow-none md:z-auto ${
        isOpenMobile ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Mobile Drawer Header */}
      <div className="md:hidden flex items-center justify-between px-3.5 py-3 border-b border-[#2d2d34] bg-[#1f1f23]">
        <div className="flex items-center gap-2 text-xs font-bold text-[#efeff1]">
          <span className="w-6 h-6 rounded-md bg-[#9146ff] flex items-center justify-center text-white">
            <Tv className="w-3.5 h-3.5" />
          </span>
          <span>Navigation</span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="p-1 rounded text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c] transition-colors"
          aria-label="Close navigation drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Top Main Navigation */}
      <div className="p-2 space-y-1 border-b border-[#2d2d34]">
        <button
          onClick={handleSelectHome}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs font-semibold transition-colors cursor-pointer ${
            activeView === "home"
              ? "bg-[#26262c] text-[#efeff1]"
              : "text-[#adadb8] hover:bg-[#1f1f23] hover:text-[#efeff1]"
          }`}
        >
          <Home className={`w-3.5 h-3.5 ${activeView === "home" ? "text-[#9146ff]" : "text-[#767682]"}`} />
          <span>Discover</span>
        </button>

        <button
          onClick={handleSelectFeed}
          className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-semibold transition-colors cursor-pointer ${
            activeView === "feed"
              ? "bg-[#26262c] text-[#efeff1]"
              : "text-[#adadb8] hover:bg-[#1f1f23] hover:text-[#efeff1]"
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Bookmark className={`w-3.5 h-3.5 ${activeView === "feed" ? "text-[#9146ff]" : "text-[#767682]"}`} />
            <span>My VOD Feed</span>
          </span>
        </button>
      </div>

      {/* Pinned Streamers Header */}
      <div className="px-3 pt-3 pb-1.5 border-b border-[#2d2d34]/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5" suppressHydrationWarning>
            <span className="text-[11px] font-bold tracking-wider uppercase text-[#767682]">
              Pinned Creators
            </span>
            {pinnedStreamers.length > 0 ? (
              <span className="text-[10px] text-[#767682] tabular-nums font-mono">
                {visibleStreamers.length}
              </span>
            ) : isLoading ? (
              <span className="w-2.5 h-2.5 rounded-full bg-[#26262c] animate-pulse inline-block" />
            ) : null}
          </div>

          {/* Action buttons: Filter & Manage */}
          {pinnedStreamers.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsSearching(!isSearching);
                  if (isSearching) setFilterQuery("");
                }}
                className={`p-1 rounded text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c] transition-colors cursor-pointer ${
                  isSearching || filterQuery ? "text-[#9146ff] bg-[#26262c]" : ""
                }`}
                title="Filter creators"
                aria-label="Filter creators"
              >
                <Search className="w-3.5 h-3.5" />
              </button>

              {onOpenManagement && (
                <button
                  onClick={onOpenManagement}
                  className="p-1 rounded text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c] transition-colors cursor-pointer"
                  title="Manage groups, visibility, and sorting"
                  aria-label="Manage pinned creators"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Quick Filter Search Input */}
        {isSearching && (
          <div className="mt-2 pb-1 animate-dropdown">
            <div className="relative">
              <input
                type="text"
                placeholder="Filter pinned..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                autoFocus
                className="w-full pl-7 pr-6 py-1 bg-[#0e0e10] border border-[#2d2d34] focus:border-[#9146ff] rounded text-[11px] text-[#efeff1] placeholder-[#767682] outline-none transition-colors"
              />
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[#767682]" />
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#767682] hover:text-[#efeff1]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Streamers List */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-2" suppressHydrationWarning>
        {isLoading && pinnedStreamers.length === 0 ? (
          <div className="space-y-1 p-1 animate-pulse">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-1.5 rounded bg-[#18181b]/40">
                <div className="w-7 h-7 rounded-full bg-[#26262c] flex-shrink-0" />
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="h-2.5 w-24 bg-[#26262c] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : pinnedStreamers.length === 0 ? (
          <div className="p-3 text-center">
            <div className="w-8 h-8 mx-auto rounded-full bg-[#1f1f23] flex items-center justify-center text-[#767682] mb-2">
              <Users className="w-4 h-4" />
            </div>
            <p className="text-xs text-[#adadb8] font-medium mb-1">No creators pinned</p>
            <p className="text-[11px] text-[#767682] mb-3 leading-relaxed">
              {isLoggedIn
                ? "Search any creator and pin them to track their broadcasts here."
                : "Sign in to pin channels and track watch progress."}
            </p>
            {!isLoggedIn && (
              <button
                onClick={onOpenAuth}
                className="w-full py-1.5 px-2 bg-[#9146ff] hover:bg-[#772ce8] text-white text-xs font-semibold rounded transition-colors active:scale-[0.98] shadow-sm cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Render Groups */}
            {groupKeys.map((groupName) => {
              const members = groupedVisibleStreamers[groupName] || [];
              if (members.length === 0) return null;
              const isCollapsed = collapsedGroups.has(groupName);

              return (
                <div key={groupName} className="space-y-0.5">
                  {/* Group Header (only shown if there are multiple groups or custom group name) */}
                  {(groupKeys.length > 1 || groupName !== "General") && (
                    <button
                      onClick={() => toggleGroupCollapse(groupName)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded text-[11px] font-semibold text-[#767682] hover:text-[#efeff1] hover:bg-[#1f1f23] transition-colors cursor-pointer group"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3 text-[#767682] group-hover:text-[#efeff1] transition-transform" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-[#767682] group-hover:text-[#efeff1] transition-transform" />
                        )}
                        <Folder className="w-3 h-3 text-[#9146ff]" />
                        <span className="truncate">{groupName}</span>
                      </span>
                      <span className="text-[10px] text-[#555560] tabular-nums font-mono px-1">
                        {members.length}
                      </span>
                    </button>
                  )}

                  {/* Group Members */}
                  {!isCollapsed && (
                    <div className="space-y-0.5 animate-tab-fade-in">
                      {members.map((s, index) => {
                        const isActive =
                          activeView === "streamer" &&
                          activeStreamerLogin?.toLowerCase() === s.login.toLowerCase();
                        const isUnpinning = unpinningLogins.has(s.login);

                        return (
                          <div
                            key={s.login}
                            style={{ animationDelay: `${index * 20}ms` }}
                            onMouseDown={handleMiddleMouseDown}
                            onAuxClick={(e) => handleStreamerMiddleClick(e, s.login)}
                            className={`group relative flex items-center justify-between px-2 py-1.5 rounded transition-all ${
                              isUnpinning ? "animate-slide-out-left" : "animate-fade-in-up"
                            } ${
                              isActive
                                ? "bg-[#9146ff]/15 text-[#ffffff] border-l-2 border-[#9146ff] font-medium"
                                : "text-[#adadb8] hover:bg-[#1f1f23] hover:text-[#efeff1]"
                            }`}
                          >
                            <a
                              href={`/?streamer=${encodeURIComponent(s.login)}`}
                              onClick={(e) => {
                                if (!e.ctrlKey && !e.metaKey) {
                                  e.preventDefault();
                                  handleSelectStreamer(s.login);
                                }
                              }}
                              onMouseDown={handleMiddleMouseDown}
                              onAuxClick={(e) => handleStreamerMiddleClick(e, s.login)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <span className="relative flex-shrink-0">
                                {s.avatarUrl ? (
                                  <img
                                    src={s.avatarUrl}
                                    alt=""
                                    className="w-7 h-7 rounded-full object-cover border border-[#2d2d34]"
                                  />
                                ) : (
                                  <span className="w-7 h-7 rounded-full bg-[#9146ff]/20 text-[#bf94ff] border border-[#9146ff]/30 flex items-center justify-center text-xs font-bold">
                                    {s.displayName.charAt(0)}
                                  </span>
                                )}
                                {s.isLive && (
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#eb0400] border-2 border-[#18181b] animate-pulse-live"
                                    title="Live Now"
                                  />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 block">
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="text-xs font-medium truncate leading-snug">
                                    {s.displayName}
                                  </span>
                                  {s.isLive && (
                                    <span
                                      className="w-2 h-2 rounded-full bg-[#eb0400] flex-shrink-0 animate-pulse-live shadow-[0_0_6px_rgba(235,4,0,0.8)]"
                                      title="Live Now"
                                    />
                                  )}
                                </span>
                                <span className="text-[10px] text-[#767682] truncate block">
                                  @{s.login}
                                </span>
                              </span>
                              {(unwatchedCounts?.[s.login.toLowerCase()] ?? 0) > 0 && (
                                <span
                                  className="flex-shrink-0 min-w-[18px] px-1 py-0.5 rounded-full bg-[#9146ff]/20 text-[#bf94ff] text-[10px] font-bold text-center leading-none"
                                  title={`${unwatchedCounts![s.login.toLowerCase()]} unwatched in your feed`}
                                >
                                  {unwatchedCounts![s.login.toLowerCase()]}
                                </span>
                              )}
                            </a>

                            {/* Quick Action buttons */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                              {/* Quick Hide */}
                              {onToggleHideStreamer && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleHideStreamer(s.login, true);
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onAuxClick={(e) => e.stopPropagation()}
                                  className="p-1 text-[#767682] hover:text-[#efeff1] rounded hover:bg-[#26262c] transition-all cursor-pointer"
                                  title="Hide creator"
                                  aria-label={`Hide ${s.displayName}`}
                                >
                                  <EyeOff className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Unpin button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUnpinningLogins((prev: Set<string>) => new Set(prev).add(s.login));
                                  setTimeout(() => {
                                    onUnpinStreamer(s.login);
                                    setUnpinningLogins((prev: Set<string>) => {
                                      const next = new Set(prev);
                                      next.delete(s.login);
                                      return next;
                                    });
                                  }, 200);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onAuxClick={(e) => e.stopPropagation()}
                                className="p-1 text-[#767682] hover:text-[#eb0400] rounded hover:bg-[#26262c] transition-all cursor-pointer active:scale-90"
                                title={`Unpin ${s.displayName}`}
                                aria-label={`Unpin ${s.displayName}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Hidden Creators Accordion Section (if any are hidden) */}
            {hiddenStreamers.length > 0 && (
              <div className="pt-2 border-t border-[#2d2d34]/60 space-y-1">
                <button
                  onClick={() => setShowHiddenSection(!showHiddenSection)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded text-[11px] font-semibold text-[#767682] hover:text-[#adadb8] hover:bg-[#1f1f23] transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    {showHiddenSection ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    <EyeOff className="w-3 h-3 text-[#adadb8]" />
                    <span>Hidden Creators</span>
                  </span>
                  <span className="text-[10px] text-[#767682] tabular-nums font-mono px-1">
                    {hiddenStreamers.length}
                  </span>
                </button>

                {showHiddenSection && (
                  <div className="space-y-0.5 pl-2 animate-tab-fade-in">
                    {hiddenStreamers.map((s) => (
                      <div
                        key={s.login}
                        onMouseDown={handleMiddleMouseDown}
                        onAuxClick={(e) => handleStreamerMiddleClick(e, s.login)}
                        className="group flex items-center justify-between px-2 py-1 rounded text-[#767682] hover:bg-[#1f1f23] hover:text-[#adadb8] transition-colors text-xs"
                      >
                        <a
                          href={`/?streamer=${encodeURIComponent(s.login)}`}
                          onClick={(e) => {
                            if (!e.ctrlKey && !e.metaKey) {
                              e.preventDefault();
                              handleSelectStreamer(s.login);
                            }
                          }}
                          onMouseDown={handleMiddleMouseDown}
                          onAuxClick={(e) => handleStreamerMiddleClick(e, s.login)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer opacity-70 hover:opacity-100"
                        >
                          <span className="w-5 h-5 rounded-full bg-[#2d2d34] flex items-center justify-center text-[10px] flex-shrink-0">
                            {s.displayName.charAt(0)}
                          </span>
                          <span className="truncate flex items-center gap-1.5">
                            <span className="truncate">{s.displayName}</span>
                            {s.isLive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-[#eb0400] flex-shrink-0 animate-pulse-live shadow-[0_0_6px_rgba(235,4,0,0.8)]"
                                title="Live Now"
                              />
                            )}
                          </span>
                        </a>

                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                          {onToggleHideStreamer && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleHideStreamer(s.login, false);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onAuxClick={(e) => e.stopPropagation()}
                              className="p-1 text-[#00f59b] hover:bg-[#00f59b]/20 rounded cursor-pointer"
                              title="Restore (Unhide)"
                              aria-label={`Unhide ${s.displayName}`}
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnpinStreamer(s.login);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onAuxClick={(e) => e.stopPropagation()}
                            className="p-1 text-[#767682] hover:text-[#eb0400] hover:bg-[#eb0400]/10 rounded cursor-pointer"
                            title="Unpin"
                            aria-label={`Unpin ${s.displayName}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom status */}
      <div className="p-2.5 border-t border-[#2d2d34] text-[11px] text-[#767682] flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#00f59b] animate-pulse"></span>
          <span className="text-[#00f59b] font-medium">CDN Ready</span>
        </span>
        <span className="mono-font text-[10px] text-[#555560]">PROXY v1</span>
      </div>
    </aside>
  );
}
