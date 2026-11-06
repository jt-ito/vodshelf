"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Navbar from "@/components/Navbar";
import Sidebar, { PinnedStreamer } from "@/components/Sidebar";
import FeedView from "@/components/FeedView";
import StreamerView from "@/components/StreamerView";
import LandingHero from "@/components/LandingHero";
import VideoPlayerModal from "@/components/VideoPlayerModal";
import AuthModal from "@/components/AuthModal";
import PinnedManagementModal from "@/components/PinnedManagementModal";
import UserSettingsView from "@/components/UserSettingsView";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import MobileNavBar from "@/components/MobileNavBar";
import { usePinnedStreamers } from "@/hooks/usePinnedStreamers";
import { ToastProvider, useToast } from "@/components/Toast";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { isPageReload } from "@/lib/navigation";
import { saveWatchStatus, saveBulkWatch, SESSION_EXPIRED_EVENT } from "@/lib/watch/client";
import { FEED_CACHE_KEY } from "@/lib/watch/feed-cache";
import { AVAILABILITY_COPY, isNotReady } from "@/lib/twitch/availability";
import { setStoredDateFormat } from "@/lib/date";
import { setStoredWatchSettings, DEFAULT_WATCH_SETTINGS, useWatchSettings } from "@/lib/watch-settings";

const SESSION_VIEW_KEY = "twitch_session_view";
const QUEUE_STORAGE_KEY = "twitch_playback_queue";
const MAX_PERSISTED_QUEUE = 100;

export default function Home({
  searchParams,
}: {
  searchParams?: { streamer?: string; view?: string };
}) {
  return (
    <ToastProvider>
      <HomeContent searchParams={searchParams} />
    </ToastProvider>
  );
}

function HomeContent({
  searchParams,
}: {
  searchParams?: { streamer?: string; view?: string };
}) {
  const { showToast } = useToast();
  const watchSettings = useWatchSettings();
  // Synchronous initialization to eliminate the brief flash on reload or new tab
  const getInitialStreamer = () => {
    if (searchParams?.streamer) return searchParams.streamer.trim().toLowerCase();
    if (typeof window !== "undefined") {
      try {
        const s = new URLSearchParams(window.location.search).get("streamer");
        if (s) return s.trim().toLowerCase();
      } catch {}
    }
    return "";
  };

  const getInitialView = (streamerLogin: string): "home" | "streamer" | "feed" | "settings" => {
    if (streamerLogin) return "streamer";
    const v =
      searchParams?.view ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("view") || ""
        : "");
    if (v && ["feed", "settings", "home"].includes(v)) return v as any;
    return "home";
  };

  const initialStreamer = getInitialStreamer();
  const initialView = getInitialView(initialStreamer);

  const [currentUser, setCurrentUser] = useState<{ id: string; username: string } | null>(null);
  const [activeView, setActiveView] = useState<"home" | "streamer" | "feed" | "settings">(initialView);
  const [activeStreamerLogin, setActiveStreamerLogin] = useState<string>(initialStreamer);
  const pinned = usePinnedStreamers();
  const pinnedStreamers = pinned.streamers;
  const isLoadingPinned = pinned.isLoading;
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [unwatchedCounts, setUnwatchedCounts] = useState<Record<string, number>>({});
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const expiredUsernameRef = useRef<string | undefined>(undefined);
  const [isPinnedManagementOpen, setIsPinnedManagementOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [playbackQueue, setPlaybackQueue] = useState<TwitchVodItem[]>([]);
  const [selectedVodId, setSelectedVodId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const applyUserSettings = (user: any) => {
    if (!user) return;
    if (user.dateFormat === "exact" || user.dateFormat === "relative") {
      setStoredDateFormat(user.dateFormat);
    }
    setStoredWatchSettings({
      markWatchedOnOpenLink: Boolean(user.markWatchedOnOpenLink),
      markWatchedOnPlay: Boolean(user.markWatchedOnPlay),
      markAllWatchedScope: user.markAllWatchedScope === "all" ? "all" : "loaded",
    });
  };

  // Rehydrate cache in client mount effect in case SSR returned initial empty state
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("twitch_cached_user");
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed?.id) {
          setCurrentUser(parsed);
          applyUserSettings(parsed);
        }
      }
    } catch {}
  }, []);

  // Explicit navigation handlers that synchronize URL query and session storage
  const navigateToStreamer = (login: string) => {
    const cleanLogin = login.trim().toLowerCase();
    setActiveStreamerLogin(cleanLogin);
    setActiveView("streamer");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("streamer", cleanLogin);
      url.searchParams.delete("view");
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString() + url.hash);
      try {
        sessionStorage.setItem(SESSION_VIEW_KEY, JSON.stringify({ activeView: "streamer", activeStreamerLogin: cleanLogin }));
      } catch {}
    }
  };

  const navigateToFeed = () => {
    setActiveStreamerLogin("");
    setActiveView("feed");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("streamer");
      url.searchParams.delete("tab");
      url.searchParams.set("view", "feed");
      window.history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString() + url.hash);
      try {
        sessionStorage.setItem(SESSION_VIEW_KEY, JSON.stringify({ activeView: "feed", activeStreamerLogin: "" }));
      } catch {}
    }
  };

  const navigateToHome = () => {
    setActiveStreamerLogin("");
    setActiveView("home");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("streamer");
      url.searchParams.delete("tab");
      url.searchParams.delete("view");
      const search = url.searchParams.toString();
      window.history.replaceState(null, "", url.pathname + (search ? "?" + search : "") + url.hash);
      try {
        sessionStorage.setItem(SESSION_VIEW_KEY, JSON.stringify({ activeView: "home", activeStreamerLogin: "" }));
      } catch {}
    }
  };

  const navigateToSettings = () => {
    setActiveStreamerLogin("");
    setActiveView("settings");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("streamer");
      url.searchParams.delete("tab");
      url.searchParams.set("view", "settings");
      window.history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString() + url.hash);
      try {
        sessionStorage.setItem(SESSION_VIEW_KEY, JSON.stringify({ activeView: "settings", activeStreamerLogin: "" }));
      } catch {}
    }
  };

  // Restore view on mount: explicit URL query params take priority, then tab session
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem("twitch_active_view");

      const params = new URLSearchParams(window.location.search);
      const urlStreamer = params.get("streamer");
      const urlView = params.get("view");

      // 1. Explicit URL parameter (e.g. from page reload on /?streamer=megalodonvt)
      if (urlStreamer) {
        setActiveStreamerLogin(urlStreamer);
        setActiveView("streamer");
        return;
      }
      if (urlView && ["feed", "settings", "home"].includes(urlView)) {
        setActiveView(urlView as any);
        return;
      }

      // 2. Tab session storage fallback
      const rawSession = sessionStorage.getItem(SESSION_VIEW_KEY);
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        if (parsed?.activeView === "streamer" && parsed?.activeStreamerLogin) {
          navigateToStreamer(parsed.activeStreamerLogin);
          return;
        }
        if (parsed?.activeView === "feed") {
          navigateToFeed();
          return;
        }
        if (parsed?.activeView === "settings") {
          navigateToSettings();
          return;
        }
      }

      // 3. Fresh root visit (http://localhost:3000) -> Home/Discover
      setActiveView("home");
      setActiveStreamerLogin("");
    } catch {}
  }, []);

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const streamer = params.get("streamer");
      const view = params.get("view");
      if (streamer) {
        setActiveStreamerLogin(streamer);
        setActiveView("streamer");
      } else if (view && ["feed", "settings", "home"].includes(view)) {
        setActiveStreamerLogin("");
        setActiveView(view as any);
      } else {
        setActiveStreamerLogin("");
        setActiveView("home");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Deep linking: play VOD if ?vod=... is present in URL query
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const vodId = params.get("vod");
    const timestamp = parseInt(params.get("t") || "0", 10);
    if (vodId) {
      fetch(`/api/twitch/cdn/${encodeURIComponent(vodId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.recovery) {
            const streamUrl = data.recovery.proxiedMasterUrl || data.recovery.qualities?.[0]?.proxiedUrl;
            if (streamUrl) {
              setPlayingStream({
                url: streamUrl,
                title: `Broadcast ${vodId}`,
                vodId,
                streamerLogin: "",
                progressSeconds: timestamp || 0,
              });
            }
          }
        })
        .catch(() => {});
    }
  }, []);

  // Global keyboard shortcuts (? for cheat sheet, / for search)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeTag = (e.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA"].includes(activeTag)) return;

      if (e.key === "?") {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.getElementById("navbar-search-input");
        if (searchInput) {
          searchInput.focus();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Queue actions
  const [watchedInSessionIds, setWatchedInSessionIds] = useState<Set<string>>(new Set());

  // Persist the playback queue across reloads (capped; storage is best-effort)
  // State (not a ref) so React Strict Mode's double-run can't persist the empty initial queue over the saved one
  const [queueHydrated, setQueueHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPlaybackQueue(parsed.filter((v) => v && v.id).slice(0, MAX_PERSISTED_QUEUE));
        }
      }
    } catch {}
    setQueueHydrated(true);
  }, []);

  useEffect(() => {
    if (!queueHydrated) return;
    try {
      if (playbackQueue.length === 0) localStorage.removeItem(QUEUE_STORAGE_KEY);
      else localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(playbackQueue.slice(0, MAX_PERSISTED_QUEUE)));
    } catch {}
  }, [playbackQueue, queueHydrated]);

  const queueVodIds = useMemo(
    () => new Set(playbackQueue.map((v) => String(v.id))),
    [playbackQueue]
  );

  const handleMarkWatched = (vodId: string) => {
    setWatchedInSessionIds((prev) => new Set(prev).add(String(vodId)));
  };

  const handleAddToQueue = (video: TwitchVodItem) => {
    const stringId = String(video.id);
    if (playbackQueue.some((v) => String(v.id) === stringId)) {
      setPlaybackQueue((prev) => prev.filter((v) => String(v.id) !== stringId));
      showToast("Removed from playback queue");
      return;
    }
    showToast(`Added to playback queue (${playbackQueue.length + 1})`);
    setPlaybackQueue((prev) => [...prev, video]);
  };

  const handleBatchAddToQueue = (videosToAdd: TwitchVodItem[]) => {
    if (!videosToAdd || videosToAdd.length === 0) return;
    setPlaybackQueue((prev) => {
      const existingIds = new Set(prev.map((v) => String(v.id)));
      const toAdd = videosToAdd.filter((v) => !existingIds.has(String(v.id)));
      if (toAdd.length === 0) {
        showToast("Selected broadcasts are already in playback queue");
        return prev;
      }
      showToast(`Added ${toAdd.length} broadcast${toAdd.length === 1 ? "" : "s"} to playback queue`);
      return [...prev, ...toAdd];
    });
  };

  const handleMarkQueueAllWatched = async () => {
    if (playbackQueue.length === 0) return;
    if (!currentUser) {
      setIsAuthOpen(true);
      return;
    }
    try {
      const items = playbackQueue.map((v) => ({
        vodId: String(v.id),
        streamerLogin: v.owner?.login || "",
        totalSeconds: v.lengthSeconds || 0,
      }));
      const err = await saveBulkWatch(items);
      if (!err) {
        const vodIds = playbackQueue.map((v) => String(v.id));
        showToast(`Marked all ${playbackQueue.length} queue items as watched`);
        setWatchedInSessionIds((prev) => {
          const next = new Set(prev);
          vodIds.forEach((id) => next.add(id));
          return next;
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("twitch_vods_marked_watched", { detail: { vodIds } })
          );
        }
      } else {
        showToast(err, "error");
      }
    } catch {
      showToast("Failed to mark queue as watched", "error");
    }
  };

  const handleRemoveFromQueue = (vodId: string) => {
    setPlaybackQueue((prev) => prev.filter((v) => String(v.id) !== String(vodId)));
    showToast("Removed from queue");
  };

  const handlePlayNextInQueue = () => {
    if (playbackQueue.length === 0) return;
    const currentIdx = playingStream
      ? playbackQueue.findIndex(
          (v) =>
            String(v.id) === String(playingStream.vodId) ||
            (playingStream.streamId && String(v.id) === String(playingStream.streamId)) ||
            ((v as any).streamId && String((v as any).streamId) === String(playingStream.streamId || playingStream.vodId))
        )
      : -1;

    const nextIdx = currentIdx === -1 ? 0 : currentIdx + 1;
    if (nextIdx < playbackQueue.length) {
      handlePlayVod(playbackQueue[nextIdx]);
    }
  };

  const handleSelectQueueItem = (video: TwitchVodItem) => {
    handlePlayVod(video);
  };

  const handleClearQueue = () => {
    setPlaybackQueue([]);
    showToast("Playback queue cleared");
  };

  const handleReorderQueue = (newQueue: TwitchVodItem[]) => {
    setPlaybackQueue(newQueue);
  };

  const handleClosePlayer = async () => {
    setPlayingStream(null);

    const queueIds = playbackQueue.map((v) => String(v.id));
    let dbWatchedIds = new Set<string>();

    if (currentUser && queueIds.length > 0) {
      try {
        const res = await fetch(`/api/watch/progress?vodIds=${encodeURIComponent(queueIds.join(","))}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progressMap) {
            for (const [vId, status] of Object.entries(data.progressMap as Record<string, any>)) {
              if (status?.isWatched) {
                dbWatchedIds.add(String(vId));
              }
            }
          }
        }
      } catch (err) {
        console.warn("Failed to check queue watch status on exit:", err);
      }
    }

    setPlaybackQueue((prev) => {
      return prev.filter((item) => {
        const idStr = String(item.id);
        const streamIdStr = (item as any).streamId ? String((item as any).streamId) : "";
        if (watchedInSessionIds.has(idStr) || (streamIdStr && watchedInSessionIds.has(streamIdStr))) {
          return false;
        }
        if (dbWatchedIds.has(idStr) || (streamIdStr && dbWatchedIds.has(streamIdStr))) {
          return false;
        }
        if ((item as any).watchStatus?.isWatched) {
          return false;
        }
        return true;
      });
    });

    setWatchedInSessionIds(new Set());
  };

  // Active video for playback modal
  const [playingStream, setPlayingStream] = useState<{
    url: string;
    title: string;
    vodId: string;
    streamerLogin: string;
    streamId?: string;
    progressSeconds?: number;
  } | null>(null);

  // Load current user session on mount
  // Signs the UI out and opens the sign-in modal with an explanation (only if a user was signed in)
  const expireSession = () => {
    if (!currentUserRef.current) return;
    expiredUsernameRef.current = currentUserRef.current.username;
    setCurrentUser(null);
    try {
      localStorage.removeItem("twitch_cached_user");
      localStorage.removeItem(FEED_CACHE_KEY);
    } catch {}
    setAuthNotice("Your session expired. Please sign in again to continue.");
    setIsAuthOpen(true);
  };

  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setCurrentUser(data.user);
          applyUserSettings(data.user);
          try {
            localStorage.setItem("twitch_cached_user", JSON.stringify(data.user));
          } catch {}
        } else if (currentUserRef.current) {
          expireSession();
        } else {
          try {
            localStorage.removeItem("twitch_cached_user");
          } catch {}
        }
      } else if (res.status === 401) {
        expireSession();
      }
      // Other failures (429/5xx) are transient: keep the current UI state rather than signing out
    } catch (err) {
      console.error("Session check error:", err);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  // After a long idle, re-validate the session once (no polling) and react to 401s from any action
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) {
        hiddenAt = 0;
        checkSession();
      }
    };
    const onExpired = () => expireSession();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setCurrentUser(null);
      pinned.clear();
      setActiveView("home");
      try {
        localStorage.removeItem("twitch_cached_user");
        localStorage.removeItem(FEED_CACHE_KEY);
      } catch {}
      setStoredDateFormat("relative");
      setStoredWatchSettings(DEFAULT_WATCH_SETTINGS);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleAuthSuccess = (user: { id: string; username: string; [key: string]: any }) => {
    setCurrentUser(user);
    if (user) {
      applyUserSettings(user);
      try {
        localStorage.setItem("twitch_cached_user", JSON.stringify(user));
      } catch {}
    }
    pinned.reload();
  };

  const handleTogglePinStreamer = (streamer: {
    login: string;
    displayName?: string;
    avatarUrl?: string;
    isLive?: boolean;
  }) => {
    if (!currentUser) {
      setIsAuthOpen(true);
      return;
    }
    pinned.toggle(streamer);
  };

  const handleTogglePin = async (streamerMeta?: {
    login?: string;
    displayName?: string;
    avatarUrl?: string;
  }) => {
    const loginToPin = streamerMeta?.login || activeStreamerLogin;
    if (loginToPin) {
      handleTogglePinStreamer({
        login: loginToPin,
        displayName: streamerMeta?.displayName,
        avatarUrl: streamerMeta?.avatarUrl,
      });
    }
  };

  const handleUnpinStreamer = pinned.unpin;
  const handleUpdatePinnedStreamer = pinned.update;
  const handleReorderStreamers = pinned.reorder;
  const handleRenameGroup = pinned.renameGroup;
  const handleDeleteGroup = pinned.deleteGroup;

  const handleToggleHideStreamer = (login: string, isHidden: boolean) => {
    handleUpdatePinnedStreamer(login, { isHidden });
  };

  // Play regular VOD (fetches or constructs stream URL through CDN or proxy)
  const handlePlayVod = async (video: TwitchVodItem) => {
    // VODVOD's playlist 404s until it has captured the stream: say so instead of opening a dead player
    const availability = (video as any).availability;
    if (isNotReady(availability)) {
      showToast(AVAILABILITY_COPY[availability].toast, "info");
      return;
    }

    const watchProgress = (video as any).watchStatus?.progressSeconds || 0;
    const streamLogin = video.owner?.login || activeStreamerLogin;
    const directStreamId = (video as any).streamId;

    // Auto-mark as watched when launching playback (if enabled), on every playback path
    if (currentUser && watchSettings.markWatchedOnPlay && streamLogin) {
      setWatchedInSessionIds((prev) => new Set(prev).add(String(video.id)));
      saveWatchStatus({
        vodId: String(video.id),
        streamerLogin: streamLogin,
        totalSeconds: video.lengthSeconds || 0,
        progressSeconds: watchProgress || video.lengthSeconds || 0,
        isWatched: true,
      }).then((err) => {
        if (err) showToast(err, "error");
      });
    }

    // Fast-path: Check if video already has direct proxied or master playlist url (e.g. from unlisted stream)
    const rawDirectUrl = (video as any).proxiedUrl || (video as any).masterPlaylistUrl;
    if (rawDirectUrl) {
      const playableUrl = rawDirectUrl.startsWith("/api/proxy/m3u8")
        ? rawDirectUrl
        : `/api/proxy/m3u8?url=${encodeURIComponent(rawDirectUrl)}`;

      setPlayingStream({
        url: playableUrl,
        title: video.title,
        vodId: video.id,
        streamerLogin: streamLogin,
        streamId: directStreamId,
        progressSeconds: watchProgress,
      });

      return;
    }

    // Fallback resolution for unlisted streams if direct URL was missing on video object
    const isUnlisted = Boolean((video as any).isUnlisted || video.broadcastType === "UNLISTED");
    if (isUnlisted && streamLogin) {
      try {
        const cdnListRes = await fetch(`/api/twitch/cdn-list/${encodeURIComponent(streamLogin)}`);
        if (cdnListRes.ok) {
          const cdnListData = await cdnListRes.json();
          const match = (cdnListData.streams || []).find(
            (s: any) => String(s.id) === String(video.id) || String(s.streamId) === String(directStreamId || video.id)
          );
          if (match && (match.proxiedUrl || match.masterPlaylistUrl)) {
            const resolvedUrl = match.proxiedUrl || `/api/proxy/m3u8?url=${encodeURIComponent(match.masterPlaylistUrl)}`;
            setPlayingStream({
              url: resolvedUrl,
              title: video.title,
              vodId: video.id,
              streamerLogin: streamLogin,
              streamId: match.streamId || directStreamId,
              progressSeconds: watchProgress,
            });
            return;
          }
        }
      } catch (err) {
        console.warn("Failed to resolve unlisted stream via cdn-list:", err);
      }
    }

    // Check CDN recovery to get proxied stream url
    try {
      const res = await fetch(`/api/twitch/cdn/${video.id}`);
      if (res.ok) {
        const data = await res.json();
        const recovery = data.recovery;
        const streamUrl = recovery.proxiedMasterUrl || recovery.qualities[0]?.proxiedUrl;
        if (streamUrl) {
          setPlayingStream({
            url: streamUrl,
            title: video.title,
            vodId: video.id,
            streamerLogin: streamLogin,
            streamId: recovery.streamId || directStreamId,
            progressSeconds: watchProgress,
          });
          return;
        }
      }
    } catch (err) {
      console.warn("CDN probe failed, falling back to direct playlist", err);
    }

    // Fallback direct url if available
    setPlayingStream({
      url: `/api/proxy/m3u8?url=${encodeURIComponent(`https://d2vjef5jvl6bfs.cloudfront.net/${video.id}/chunked/index-dvr.m3u8`)}`,
      title: video.title,
      vodId: video.id,
      streamerLogin: streamLogin,
      streamId: directStreamId,
      progressSeconds: watchProgress,
    });
  };

  // Play custom direct CDN stream
  const handlePlayDirectStream = (
    streamUrl: string,
    title: string,
    vodId: string,
    streamerLoginParam?: string
  ) => {
    const loginToUse = streamerLoginParam || activeStreamerLogin;
    if (currentUser && watchSettings.markWatchedOnPlay && vodId && loginToUse) {
      fetch("/api/watch/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId,
          streamerLogin: loginToUse,
          isWatched: true,
        }),
      }).catch(() => {});
    }

    setPlayingStream({
      url: streamUrl,
      title,
      vodId,
      streamerLogin: loginToUse,
      streamId: vodId,
    });
  };

  const handleRecoverVodId = async (vodId: string) => {
    try {
      const res = await fetch(`/api/twitch/cdn/${vodId}`);
      if (res.ok) {
        const data = await res.json();
        const recovery = data.recovery;
        if (recovery && recovery.streamerLogin) {
          navigateToStreamer(recovery.streamerLogin);
        } else {
          setActiveView("streamer");
        }
        const streamUrl = recovery.proxiedMasterUrl || recovery.qualities?.[0]?.proxiedUrl;
        if (streamUrl) {
          setPlayingStream({
            url: streamUrl,
            title: recovery.title || `VOD ${vodId}`,
            vodId,
            streamerLogin: recovery.streamerLogin || "",
          });
        }
      }
    } catch (err) {
      console.error("Recover VOD ID error:", err);
    }
  };

  const isStreamerPinned = pinnedStreamers.some(
    (s) => s.login.toLowerCase() === activeStreamerLogin.toLowerCase()
  );

  return (
    <div className="h-screen w-full max-w-full flex flex-col bg-[#0e0e10] text-[#efeff1] overflow-x-hidden overflow-y-hidden">
        {/* Top Navigation */}
        <Navbar
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthOpen(true)}
          onLogout={handleLogout}
          onSelectStreamer={navigateToStreamer}
          activeView={activeView}
          onSelectFeed={navigateToFeed}
          onSelectHome={navigateToHome}
          onSelectSettings={navigateToSettings}
          pinnedLogins={new Set(pinnedStreamers.map((s) => s.login.toLowerCase()))}
          onTogglePinStreamer={handleTogglePinStreamer}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          queue={playbackQueue}
          onPlayQueueItem={handleSelectQueueItem}
          onRemoveFromQueue={handleRemoveFromQueue}
          onClearQueue={handleClearQueue}
          onReorderQueue={handleReorderQueue}
          currentPlayingVodId={playingStream?.vodId || playingStream?.streamId || null}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
          onMarkAllWatched={handleMarkQueueAllWatched}
        />

        {/* Main Layout Area */}
        <div className="flex-1 flex overflow-hidden min-h-0 w-full max-w-full relative">
          {/* Mobile Sidebar Backdrop Overlay */}
          {isMobileSidebarOpen && (
            <div
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden transition-opacity"
              aria-label="Close sidebar backdrop"
            />
          )}

          {/* Left Sidebar */}
          <Sidebar
            pinnedStreamers={pinnedStreamers}
            activeStreamerLogin={activeStreamerLogin}
            activeView={activeView}
            onSelectStreamer={navigateToStreamer}
            onSelectFeed={navigateToFeed}
            onSelectHome={navigateToHome}
            onUnpinStreamer={handleUnpinStreamer}
            onOpenAuth={() => setIsAuthOpen(true)}
            onOpenManagement={() => setIsPinnedManagementOpen(true)}
            onToggleHideStreamer={handleToggleHideStreamer}
            isLoggedIn={!!currentUser}
            isLoading={isLoadingPinned}
            isOpenMobile={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
            unwatchedCounts={currentUser ? unwatchedCounts : undefined}
          />

          {/* Center Content with Independent Scroll (No horizontal overflow, mobile bottom nav clearance) */}
          <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden pb-20 md:pb-16">
            {activeView === "settings" && currentUser ? (
              <UserSettingsView
                currentUser={currentUser}
                onUsernameUpdated={(newU) => {
                  setCurrentUser({ ...currentUser, username: newU });
                }}
                onBack={navigateToHome}
                onLogout={handleLogout}
              />
            ) : activeView === "home" ? (
              <LandingHero
                onSearchStreamer={navigateToStreamer}
                onRecoverVodId={handleRecoverVodId}
              />
            ) : activeView === "feed" ? (
              <FeedView
                onPlayVideo={handlePlayVod}
                onRecoverCdn={(vodId) => {
                  handleRecoverVodId(vodId);
                }}
                onSelectStreamer={navigateToStreamer}
                isLoggedIn={!!currentUser}
                onOpenAuth={() => setIsAuthOpen(true)}
                onAddToQueue={handleAddToQueue}
                onBatchAddToQueue={handleBatchAddToQueue}
                queueVodIds={queueVodIds}
                liveStreamerLogins={new Set(pinnedStreamers.filter((s) => s.isLive).map((s) => s.login.toLowerCase()))}
                onUnwatchedCounts={setUnwatchedCounts}
              />
            ) : activeStreamerLogin ? (
              <StreamerView
                key={activeStreamerLogin}
                streamerLogin={activeStreamerLogin}
                isPinned={isStreamerPinned}
                onTogglePin={handleTogglePin}
                onPlayVideo={handlePlayVod}
                onPlayDirectStream={handlePlayDirectStream}
                isLoggedIn={!!currentUser}
                onOpenAuth={() => setIsAuthOpen(true)}
                onAddToQueue={handleAddToQueue}
                queueVodIds={queueVodIds}
              />
            ) : (
              <LandingHero
                onSearchStreamer={navigateToStreamer}
                onRecoverVodId={handleRecoverVodId}
              />
            )}
          </main>
        </div>

        {/* Embedded HLS Video Player Modal */}
        {playingStream && (
          <VideoPlayerModal
            streamUrl={playingStream.url}
            title={playingStream.title}
            vodId={playingStream.vodId}
            streamerLogin={playingStream.streamerLogin}
            streamId={playingStream.streamId}
            initialProgressSeconds={playingStream.progressSeconds}
            onClose={handleClosePlayer}
            queue={playbackQueue}
            onPlayNext={handlePlayNextInQueue}
            onSelectQueueItem={handleSelectQueueItem}
            onRemoveFromQueue={handleRemoveFromQueue}
            onReorderQueue={handleReorderQueue}
            onMarkWatched={handleMarkWatched}
          />
        )}

        {/* User Login/Register Modal */}
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => {
            setIsAuthOpen(false);
            setAuthNotice(null);
          }}
          onSuccess={handleAuthSuccess}
          notice={authNotice}
          initialUsername={authNotice ? expiredUsernameRef.current : undefined}
        />

        {/* Pinned Streamers Management Modal */}
        <PinnedManagementModal
          isOpen={isPinnedManagementOpen}
          onClose={() => setIsPinnedManagementOpen(false)}
          streamers={pinnedStreamers}
          onUpdateStreamer={handleUpdatePinnedStreamer}
          onReorderStreamers={handleReorderStreamers}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onUnpinStreamer={handleUnpinStreamer}
        />

        {/* Keyboard Shortcuts Cheatsheet Modal */}
        <KeyboardShortcutsModal
          isOpen={isShortcutsOpen}
          onClose={() => setIsShortcutsOpen(false)}
        />

        {/* Mobile Bottom Navigation Bar (strictly hidden on desktop) */}
        <MobileNavBar
          activeView={activeView}
          onSelectHome={() => {
            navigateToHome();
            setIsMobileSidebarOpen(false);
          }}
          onSelectFeed={() => {
            navigateToFeed();
            setIsMobileSidebarOpen(false);
          }}
          onSelectSettings={() => {
            navigateToSettings();
            setIsMobileSidebarOpen(false);
          }}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
          isMobileSidebarOpen={isMobileSidebarOpen}
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthOpen(true)}
          pinnedCount={pinnedStreamers.filter((s) => !s.isHidden).length}
        />
      </div>
  );
}
