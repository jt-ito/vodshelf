"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Film, User, LogOut, Bookmark, Loader2, Settings, Keyboard, Menu } from "lucide-react";
import { useToast } from "./Toast";
import { TwitchVodItem } from "@/lib/twitch/gql";
import QueueDropdown from "./QueueDropdown";

interface SearchChannel {
  login: string;
  displayName: string;
  avatar: string;
}

interface NavbarProps {
  currentUser: { id: string; username: string } | null;
  onOpenAuth: () => void;
  onLogout: () => void;
  onSelectStreamer: (login: string) => void;
  activeView: "home" | "streamer" | "feed" | "settings";
  onSelectFeed: () => void;
  onSelectHome: () => void;
  onSelectSettings: () => void;
  pinnedLogins?: Set<string>;
  onTogglePinStreamer?: (streamer: { login: string; displayName: string; avatarUrl: string }) => void;
  onOpenShortcuts?: () => void;
  queue?: TwitchVodItem[];
  onPlayQueueItem?: (video: TwitchVodItem) => void;
  onRemoveFromQueue?: (vodId: string) => void;
  onClearQueue?: () => void;
  onReorderQueue?: (newQueue: TwitchVodItem[]) => void;
  currentPlayingVodId?: string | null;
  onToggleMobileSidebar?: () => void;
  onMarkAllWatched?: () => Promise<void> | void;
}

export default function Navbar({
  currentUser,
  onOpenAuth,
  onLogout,
  onSelectStreamer,
  activeView,
  onSelectFeed,
  onSelectHome,
  onSelectSettings,
  pinnedLogins,
  onTogglePinStreamer,
  onOpenShortcuts,
  queue = [],
  onPlayQueueItem,
  onRemoveFromQueue,
  onClearQueue,
  onReorderQueue,
  currentPlayingVodId,
  onToggleMobileSidebar,
  onMarkAllWatched,
}: NavbarProps) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchChannel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchCacheRef = useRef<Map<string, SearchChannel[]>>(new Map());

  // Debounced channel search with client-side cache
  useEffect(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    // Check client-side cache first to avoid redundant network hit
    if (searchCacheRef.current.has(trimmed)) {
      setResults(searchCacheRef.current.get(trimmed)!);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/twitch/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          const channels = data.channels || [];
          searchCacheRef.current.set(trimmed, channels);
          setResults(channels);
        }
      } catch {
        // Silently handle error
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside to close search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectChannel = (login: string) => {
    onSelectStreamer(login);
    setQuery("");
    setResults([]);
    setIsOpen(false);
  };

  const handleMiddleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const handleChannelMiddleClick = (e: React.MouseEvent, login: string) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      window.open(`/?streamer=${encodeURIComponent(login)}`, "_blank", "noopener,noreferrer");
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      handleSelectChannel(query.trim().toLowerCase());
    }
  };

  return (
    <header className="bg-[#18181b] flex-shrink-0 z-40 w-full px-3 sm:px-4 lg:px-6 py-2.5 flex items-center justify-between gap-2.5 sm:gap-4 border-b border-[#2d2d34]">
      {/* Brand / Logo & Mobile Menu Toggle */}
      <div className="flex items-center gap-2 sm:gap-6 flex-shrink-0">
        {/* Mobile Hamburger Menu Button */}
        {onToggleMobileSidebar && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="md:hidden p-1.5 -ml-1 text-[#adadb8] hover:text-[#efeff1] hover:bg-[#26262c] rounded-md transition-colors cursor-pointer"
            aria-label="Open sidebar menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={onSelectHome}
          className="flex items-center gap-2 sm:gap-2.5 text-left rounded-md p-1 cursor-pointer active:scale-[0.98]"
          aria-label="VodShelf Home"
        >
          <span className="w-8 h-8 rounded-md bg-[#9146ff] flex items-center justify-center text-white flex-shrink-0">
            <Film className="w-4 h-4" />
          </span>
          <span className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-[#efeff1] block">
              <span className="hidden sm:inline">VodShelf</span>
              <span className="inline sm:hidden">VodShelf</span>
            </span>
            <span className="text-[11px] text-[#767682] hidden sm:block">Your VOD library</span>
          </span>
        </button>

        {/* Navigation links */}
        <nav className="hidden md:flex items-center gap-1.5">
          <button
            onClick={onSelectHome}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer active:scale-[0.98] ${
              activeView === "home"
                ? "bg-[#9146ff]/15 text-[#ffffff] border border-[#9146ff]/30 font-semibold"
                : "text-[#adadb8] hover:text-[#efeff1] hover:bg-[#1f1f23]"
            }`}
          >
            Discover
          </button>
          <button
            onClick={onSelectFeed}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer active:scale-[0.98] ${
              activeView === "feed"
                ? "bg-[#9146ff]/15 text-[#ffffff] border border-[#9146ff]/30 font-semibold"
                : "text-[#adadb8] hover:text-[#efeff1] hover:bg-[#1f1f23]"
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${activeView === "feed" ? "text-[#9146ff]" : "text-[#767682]"}`} />
            <span>My Feed</span>
          </button>
        </nav>
      </div>

      {/* Center Search Bar */}
      <div className="flex-1 max-w-md relative min-w-0" ref={searchRef}>
        <form onSubmit={handleSearchSubmit} className="relative w-full">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#767682] absolute left-3 pointer-events-none" />
            <input
              id="navbar-search-input"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder="Search streamer (shroud, tarik)..."
              className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
              spellCheck={false}
              autoComplete="off"
            />
            {isSearching && (
              <Loader2 className="w-3.5 h-3.5 text-[#9146ff] animate-spin absolute right-3 pointer-events-none" />
            )}
          </div>
        </form>

        {/* Live Search Autocomplete Dropdown */}
        {isOpen && query.trim().length >= 2 && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-[#18181b] border border-[#2d2d34] rounded-md shadow-2xl overflow-hidden z-50 animate-dropdown">
            <div className="p-1.5 space-y-0.5 max-h-72 overflow-y-auto">
              {results.length > 0 ? (
                results.map((channel, idx) => {
                  const isPinned = pinnedLogins?.has(channel.login.toLowerCase());
                  const streamerUrl = `/?streamer=${encodeURIComponent(channel.login)}`;

                  return (
                    <div
                      key={channel.login}
                      style={{ animationDelay: `${idx * 25}ms` }}
                      onMouseDown={handleMiddleMouseDown}
                      onAuxClick={(e) => handleChannelMiddleClick(e, channel.login)}
                      className="group w-full px-2.5 py-1.5 rounded flex items-center justify-between gap-2.5 text-left hover:bg-[#26262c] text-[#efeff1] transition-all duration-150 active:scale-[0.98] animate-fade-in-up"
                    >
                      <a
                        href={streamerUrl}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            handleSelectChannel(channel.login);
                          }
                        }}
                        onMouseDown={handleMiddleMouseDown}
                        onAuxClick={(e) => handleChannelMiddleClick(e, channel.login)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                      >
                        <img
                          src={channel.avatar}
                          alt=""
                          className="w-6 h-6 rounded-full object-cover bg-[#26262c] flex-shrink-0 group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate leading-none">
                            {channel.displayName}
                          </div>
                          <div className="text-[10px] text-[#767682] truncate mt-0.5">
                            @{channel.login}
                          </div>
                        </div>
                      </a>

                      {/* Pin button on right side: appears on hover or stays visible if pinned */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!currentUser) {
                            onOpenAuth();
                            return;
                          }
                          onTogglePinStreamer?.({
                            login: channel.login,
                            displayName: channel.displayName,
                            avatarUrl: channel.avatar,
                          });
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onAuxClick={(e) => e.stopPropagation()}
                        className={`p-1.5 rounded transition-all active:scale-[0.92] ${
                          isPinned
                            ? "text-[#9146ff] bg-[#9146ff]/15 hover:bg-[#9146ff]/25 opacity-100"
                            : "text-[#767682] hover:text-[#efeff1] hover:bg-[#32323a] opacity-0 group-hover:opacity-100 focus:opacity-100"
                        }`}
                        title={isPinned ? "Unpin streamer" : "Pin streamer"}
                        aria-label={isPinned ? `Unpin ${channel.displayName}` : `Pin ${channel.displayName}`}
                      >
                        <Bookmark
                          className={`w-3.5 h-3.5 transition-colors ${
                            isPinned ? "fill-[#9146ff] text-[#9146ff]" : ""
                          }`}
                        />
                      </button>
                    </div>
                  );
                })
              ) : isSearching ? (
                <div className="py-4 text-center text-xs text-[#767682]">
                  Searching channels…
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-[#767682]">
                  No channel results found for &ldquo;{query}&rdquo;
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right User Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0" suppressHydrationWarning>
        {/* Playback Queue Button & Dropdown (visible when queue is active) */}
        {queue.length > 0 && onPlayQueueItem && onRemoveFromQueue && onClearQueue && (
          <QueueDropdown
            queue={queue}
            onPlayQueueItem={onPlayQueueItem}
            onRemoveFromQueue={onRemoveFromQueue}
            onClearQueue={onClearQueue}
            onReorderQueue={onReorderQueue}
            currentPlayingVodId={currentPlayingVodId}
            onMarkAllWatched={onMarkAllWatched}
          />
        )}
        {onOpenShortcuts && (
          <button
            onClick={onOpenShortcuts}
            className="hidden sm:block p-1.5 text-[#adadb8] hover:text-[#efeff1] hover:bg-[#26262c] rounded transition-colors"
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        )}
        {currentUser ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSelectSettings}
              className={`px-2.5 py-1 rounded border flex items-center gap-2 transition-all cursor-pointer group active:scale-[0.98] ${
                activeView === "settings"
                  ? "bg-[#26262c] border-[#9146ff] text-white"
                  : "bg-[#1f1f23] hover:bg-[#26262c] border-[#2d2d34] hover:border-[#9146ff]/50 text-[#efeff1]"
              }`}
              title="Account Settings"
              aria-label="Account Settings"
            >
              <span className="w-5 h-5 rounded-full bg-[#9146ff] flex items-center justify-center text-[10px] font-bold text-white group-hover:scale-105 transition-transform flex-shrink-0">
                {currentUser.username.charAt(0).toUpperCase()}
              </span>
              <span className="text-xs font-medium truncate max-w-[120px] hidden sm:inline">
                {currentUser.username}
              </span>
              <Settings className="w-3.5 h-3.5 text-[#767682] group-hover:text-[#efeff1] ml-0.5 transition-colors" />
            </button>
            <button
              onClick={onLogout}
              className="p-1.5 text-[#adadb8] hover:text-[#efeff1] hover:bg-[#26262c] rounded transition-colors active:scale-[0.98]"
              title="Sign Out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="px-3 py-1.5 bg-[#9146ff] hover:bg-[#772ce8] text-white text-xs font-semibold rounded transition-colors flex items-center gap-1.5 active:scale-[0.98] cursor-pointer"
          >
            <User className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
