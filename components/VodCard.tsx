"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Check, Clock, Eye, Layers, CheckSquare, Square, Copy, Radio, Star, RefreshCw, User, Calendar, Link2, ListPlus, ListCheck, Share2, BarChart2, Lock } from "lucide-react";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { useToast } from "./Toast";
import { useDateFormat, formatDateWithPreference, DateFormatPreference } from "@/lib/date";
import { useWatchSettings } from "@/lib/watch-settings";
import { getTwitchTrackerUrl } from "@/lib/twitch/tracker";
import { AVAILABILITY_COPY, isNotReady } from "@/lib/twitch/availability";

interface VodCardProps {
  video: TwitchVodItem & {
    watchStatus?: {
      isWatched: boolean;
      progressSeconds: number;
      totalSeconds: number;
      isNew?: boolean;
      inProgress?: boolean;
    };
    tags?: string[];
    isUnlisted?: boolean;
    streamId?: string;
    masterPlaylistUrl?: string;
    proxiedUrl?: string;
  };
  onPlay: (video: TwitchVodItem) => void;
  onRecoverCdn: (vodId: string) => void;
  onToggleWatch: (
    vodId: string,
    currentStatus: boolean,
    totalSeconds: number,
    silent?: boolean,
    streamerLogin?: string
  ) => Promise<boolean | void> | boolean | void;
  isLoggedIn: boolean;
  onSelectStreamer?: (login: string) => void;
  isDismissing?: boolean;
  staggerIndex?: number;
  isSelected?: boolean;
  onToggleSelect?: (vodId: string) => void;
  selectionMode?: boolean;
  onAddToQueue?: (video: TwitchVodItem) => void;
  isInQueue?: boolean;
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatCompactNumber(num: number): string {
  if (!num || isNaN(num) || num <= 0) return "0";
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (num >= 10_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return num.toLocaleString();
}

export function formatRelativeDate(dateStr: string, mode?: DateFormatPreference): string {
  return formatDateWithPreference(dateStr, mode);
}

export default function VodCard({
  video,
  onPlay,
  onRecoverCdn,
  onToggleWatch,
  isLoggedIn,
  onSelectStreamer,
  isDismissing = false,
  staggerIndex = 0,
  isSelected = false,
  onToggleSelect,
  selectionMode = false,
  onAddToQueue,
  isInQueue = false,
}: VodCardProps) {
  const { showToast } = useToast();
  const dateFormat = useDateFormat();
  const watchSettings = useWatchSettings();
  const copyMenuRef = useRef<HTMLDivElement>(null);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [hasCopiedTitle, setHasCopiedTitle] = useState(false);
  const [displayedTitle, setDisplayedTitle] = useState(video.title);
  const [isRefreshingTitle, setIsRefreshingTitle] = useState(false);

  // Close context menu on outside click or escape key
  useEffect(() => {
    if (!showCopyMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCopyMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCopyMenu]);

  useEffect(() => {
    setDisplayedTitle(video.title);
  }, [video.title]);

  // Check if standard thumbnail is unavailable or a 404 placeholder
  const isUnlisted = Boolean((video as any).isUnlisted || video.broadcastType === "UNLISTED");

  // Check if standard thumbnail is unavailable, 404, or a low-res non-video asset (e.g. 40x56 box art or 50x50 profile image)
  const rawUrl = video.previewThumbnailURL || "";
  const isNonVideoThumb =
    !rawUrl ||
    rawUrl.includes("404_processing") ||
    rawUrl.includes("_404/") ||
    rawUrl.includes("ttv-boxart") ||
    rawUrl.includes("user_pictures") ||
    rawUrl.includes("-40x56") ||
    rawUrl.includes("-50x50") ||
    (rawUrl.endsWith(".png") && rawUrl.includes("processing"));

  // Only use live stream snapshot for active standard streams, never for past unlisted broadcasts
  const livePreviewUrl = (!isUnlisted && video.owner?.login)
    ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${video.owner.login.toLowerCase()}-440x248.jpg`
    : null;

  const [currentThumb, setCurrentThumb] = useState<string | null>(
    isNonVideoThumb ? livePreviewUrl : rawUrl.replace("%{width}", "384").replace("%{height}", "216")
  );
  const [isLiveFallback, setIsLiveFallback] = useState<boolean>(isNonVideoThumb && !!livePreviewUrl);
  const [thumbFailed, setThumbFailed] = useState<boolean>(!currentThumb);

  useEffect(() => {
    const raw = video.previewThumbnailURL || "";
    const isInvalid =
      !raw ||
      raw.includes("404_processing") ||
      raw.includes("_404/") ||
      raw.includes("ttv-boxart") ||
      raw.includes("user_pictures") ||
      raw.includes("-40x56") ||
      raw.includes("-50x50") ||
      (raw.endsWith(".png") && raw.includes("processing"));

    const live = (!isUnlisted && video.owner?.login)
      ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${video.owner.login.toLowerCase()}-440x248.jpg`
      : null;

    if (isInvalid) {
      if (live) {
        setIsLiveFallback(true);
        setCurrentThumb(live);
        setThumbFailed(false);
      } else {
        setIsLiveFallback(false);
        setCurrentThumb(null);
        setThumbFailed(true);
      }
    } else {
      setIsLiveFallback(false);
      setCurrentThumb(raw.replace("%{width}", "384").replace("%{height}", "216"));
      setThumbFailed(false);
    }
  }, [video.id, video.previewThumbnailURL, video.owner?.login, isUnlisted]);

  const handleImageError = () => {
    // If standard thumbnail failed, try live user snapshot as a secondary fallback (only for standard streams)
    if (!isLiveFallback && livePreviewUrl) {
      setIsLiveFallback(true);
      setCurrentThumb(livePreviewUrl);
    } else {
      // Both standard and live preview failed, show rich custom placeholder
      setThumbFailed(true);
      setCurrentThumb(null);
    }
  };

  const watch = video.watchStatus || {
    isWatched: false,
    progressSeconds: 0,
    totalSeconds: video.lengthSeconds || 0,
    isNew: true,
  };

  const progressPercent =
    watch.totalSeconds > 0
      ? Math.min(100, Math.round((watch.progressSeconds / watch.totalSeconds) * 100))
      : 0;

  const isUnlistedStream = Boolean((video as any).isUnlisted || video.broadcastType === "UNLISTED");
  const unlistedM3u8Url =
    (video as any).masterPlaylistUrl ||
    ((video as any).proxiedUrl?.includes("url=")
      ? decodeURIComponent((video as any).proxiedUrl.split("url=")[1])
      : (video as any).proxiedUrl) ||
    "";
  const trackerUrl = getTwitchTrackerUrl(video.owner?.login, video);
  const twitchVodUrl = isUnlistedStream ? trackerUrl : `https://www.twitch.tv/videos/${video.id}`;

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode && onToggleSelect) {
      e.stopPropagation();
      onToggleSelect(video.id);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showToast(`Copied ${label} to clipboard`);
    setShowCopyMenu(false);
  };

  const handleCopyTitle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(displayedTitle, "stream title");
    setHasCopiedTitle(true);
    setTimeout(() => setHasCopiedTitle(false), 2000);
  };

  const handleRefreshTitle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRefreshingTitle) return;

    setIsRefreshingTitle(true);
    try {
      const login = video.owner?.login || "";
      const url = `/api/twitch/vods/refresh-title?vodId=${encodeURIComponent(video.id)}&streamerLogin=${encodeURIComponent(login)}&currentTitle=${encodeURIComponent(displayedTitle || "")}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.updated && data.title) {
          setDisplayedTitle(data.title);
          showToast(`Stream title updated to "${data.title}"`);
        } else {
          showToast(data.message || "Stream title is already up to date.");
        }
      } else {
        showToast("Unable to refresh stream title", "error");
      }
    } catch {
      showToast("Failed to refresh stream title", "error");
    } finally {
      setIsRefreshingTitle(false);
    }
  };

  const streamerUrl = video.owner?.login ? `/?streamer=${encodeURIComponent(video.owner.login)}` : null;

  // Title is a real <a href>: let the browser open it natively on middle-click (no about:blank hop)
  const handleTitleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1 && watchSettings.markWatchedOnOpenLink && !watch.isWatched) {
      onToggleWatch(video.id, false, video.lengthSeconds, true, video.owner?.login);
    }
  };

  return (
    <div
      data-vod-id={String(video.id)}
      style={{ animationDelay: `${Math.min(staggerIndex * 40, 300)}ms` }}
      onClick={handleCardClick}
      className={`group rounded-lg border overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 ${
        isDismissing ? "animate-card-exit" : "animate-fade-in-up"
      } ${
        isSelected
          ? "bg-[#1f1a2e] border-[#9146ff] ring-2 ring-[#9146ff]/50 shadow-md shadow-[#9146ff]/10"
          : "bg-[#18181b] border-[#2d2d34] hover:border-[#9146ff]/50"
      } ${selectionMode ? "cursor-pointer select-none" : ""}`}
    >
      {/* Thumbnail Area */}
      <div
        className="relative aspect-video w-full bg-[#0e0e10] overflow-hidden flex items-center justify-center"
      >
        {currentThumb && !thumbFailed ? (
          <img
            src={currentThumb}
            alt={video.title}
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            className="w-full h-full object-cover group-hover:scale-[1.03] group-hover:brightness-105 transition-all duration-300 ease-out"
          />
        ) : isUnlisted ? (
          /* Sleek Unlisted Broadcast Card Showcase (proper aspect ratio, no stretching) */
          <div className="w-full h-full flex flex-col items-center justify-center p-3 relative overflow-hidden bg-gradient-to-br from-[#1c162b] via-[#12111a] to-[#0c0b12] select-none pointer-events-none">
            {/* Ambient blurred backdrop from high-res category box art if available */}
            {video.game?.boxArtURL && (
              <img
                src={video.game.boxArtURL}
                alt=""
                className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-20 scale-125 pointer-events-none"
              />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#9146ff]/15 via-transparent to-black/75 pointer-events-none" />

            <div className="relative z-10 flex items-center justify-center gap-3.5 max-w-[90%]">
              {/* Crisp mini category poster with native 3:4 aspect ratio */}
              {video.game?.boxArtURL ? (
                <div className="w-11 h-15 rounded-md overflow-hidden border border-[#3d3d46] shadow-xl flex-shrink-0 bg-[#141417]">
                  <img
                    src={video.game.boxArtURL}
                    alt={video.game.name || ""}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : null}

              <div className="flex flex-col items-start space-y-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  {video.owner?.profileImageURL ? (
                    <img
                      src={video.owner.profileImageURL}
                      alt={video.owner.displayName || ""}
                      className="w-5 h-5 rounded-full object-cover border border-[#9146ff]/70 shadow-sm flex-shrink-0"
                    />
                  ) : null}
                  <span className="text-xs font-bold text-[#efeff1] truncate max-w-[150px]">
                    {video.owner?.displayName || video.owner?.login}
                  </span>
                </div>

                <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#eb0400]/20 border border-[#eb0400]/35 text-[#ff7070] text-[9px] font-bold uppercase tracking-wider">
                  <Lock className="w-2.5 h-2.5" />
                  <span>Unlisted Broadcast</span>
                </div>

                {video.game?.name && (
                  <p className="text-[10px] text-[#adadb8] truncate max-w-[160px]">
                    {video.game.name}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Sleek Ongoing/Processing Broadcast Placeholder */
          <div className="w-full h-full flex flex-col items-center justify-center p-3 relative overflow-hidden bg-gradient-to-br from-[#1b1728] via-[#13121d] to-[#0e0e10] select-none">
            {/* Subtle background ambient glow */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#9146ff]/10 via-transparent to-transparent pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center text-center space-y-1.5">
              {video.owner?.profileImageURL ? (
                <div className="relative">
                  <img
                    src={video.owner.profileImageURL}
                    alt={video.owner.displayName || ""}
                    className="w-10 h-10 rounded-full object-cover border-2 border-[#9146ff]/60 shadow-lg shadow-[#9146ff]/25"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#eb0400] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#eb0400] border-2 border-[#18181b]"></span>
                  </span>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#9146ff]/15 border border-[#9146ff]/30 flex items-center justify-center text-[#bf94ff]">
                  <Radio className="w-5 h-5 text-[#9146ff] animate-pulse" />
                </div>
              )}

              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#9146ff]/15 border border-[#9146ff]/35 text-[#bf94ff] text-[10px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#eb0400] animate-pulse"></span>
                  <span>Ongoing Stream</span>
                </div>
                <p className="text-[10px] text-[#767682] max-w-[180px] truncate">
                  {video.owner?.displayName || "Streamer"} is live
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Live badge if ongoing live stream or showing live snapshot */}
        {(video.isLive || (isLiveFallback && !thumbFailed && currentThumb)) && (
          <div className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-[#eb0400]/95 text-white text-[9px] font-extrabold uppercase tracking-wide flex items-center gap-1 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            <span>{video.isLive ? "LIVE NOW" : "LIVE SNAPSHOT"}</span>
          </div>
        )}

        {/* Selection Checkbox (always visible when selectionMode is true, or on hover) */}
        {selectionMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(video.id);
            }}
            className={`absolute top-2 right-2 z-20 p-1 rounded-md transition-transform active:scale-90 ${
              isSelected
                ? "bg-[#9146ff] text-white shadow-md shadow-[#9146ff]/40"
                : "bg-black/75 text-[#adadb8] hover:text-white border border-[#3d3d46]"
            }`}
            aria-label={isSelected ? "Deselect VOD" : "Select VOD"}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-white" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Duration Badge */}
        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/85 text-white text-[11px] font-medium tabular-nums z-10">
          {formatDuration(video.lengthSeconds)}
        </div>

        {/* Quick Utility Actions (Refresh Title & Probe CDN) - top right, visible on hover alongside play button */}
        {!selectionMode && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
            <button
              type="button"
              onClick={handleRefreshTitle}
              disabled={isRefreshingTitle}
              className={`p-1.5 rounded-md bg-black/75 hover:bg-black/90 border border-white/10 text-[#adadb8] hover:text-[#bf94ff] shadow-md backdrop-blur-sm transition-all cursor-pointer active:scale-95 ${
                isRefreshingTitle ? "text-[#9146ff] bg-black/90" : ""
              }`}
              title="Refresh stream title (fetch latest updated title)"
              aria-label="Refresh stream title"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshingTitle ? "animate-spin text-[#9146ff]" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRecoverCdn(video.id);
              }}
              className="p-1.5 rounded-md bg-black/75 hover:bg-black/90 border border-white/10 text-[#adadb8] hover:text-[#00f59b] shadow-md backdrop-blur-sm transition-all cursor-pointer active:scale-95"
              title="Probe CDN m3u8 playlist"
              aria-label="Probe CDN manifest"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Watch Status Badges with Rich Color Contrast (Clickable toggle) */}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-30">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch(
                video.id,
                watch.isWatched,
                video.lengthSeconds,
                false,
                video.owner?.login
              );
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer active:scale-95 group/status ${
              watch.isWatched
                ? "bg-[#00f59b] text-black hover:bg-[#00e08b] animate-badge-pop"
                : watch.progressSeconds > 0
                ? "bg-[#f5a623] text-black hover:bg-[#e0941b]"
                : "bg-[#9146ff]/25 text-[#bf94ff] border border-[#9146ff]/40 hover:bg-[#00f59b]/25 hover:text-[#00f59b] hover:border-[#00f59b]/50"
            }`}
            title={watch.isWatched ? "Watched (Click to mark unwatched)" : "Click to mark as watched"}
            aria-label={watch.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
          >
            {watch.isWatched ? (
              <Check className="w-3 h-3" />
            ) : watch.progressSeconds > 0 ? (
              <Clock className="w-3 h-3" />
            ) : (
              <Check className="w-3 h-3 opacity-70 group-hover/status:opacity-100" />
            )}
            <span>
              {watch.isWatched
                ? "WATCHED"
                : watch.progressSeconds > 0
                ? formatDuration(watch.progressSeconds)
                : "NEW"}
            </span>
          </button>

          {video.broadcastType && video.broadcastType !== "ARCHIVE" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#26262c] text-[#adadb8] border border-[#3d3d46] uppercase">
              {video.broadcastType}
            </span>
          )}

          {isNotReady((video as any).availability) && !(video as any).isLive && (
            <span
              title={AVAILABILITY_COPY[(video as any).availability as "processing" | "no_data"].tip}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase flex items-center gap-1 ${
                (video as any).availability === "processing"
                  ? "bg-amber-400/15 text-amber-300 border-amber-400/35"
                  : "bg-[#26262c] text-[#adadb8] border-[#3d3d46]"
              }`}
            >
              <Clock className="w-2.5 h-2.5" />
              <span>{AVAILABILITY_COPY[(video as any).availability as "processing" | "no_data"].label}</span>
            </span>
          )}
        </div>

        {/* Play Overlay Button (only active when not in selection mode) */}
        {!selectionMode ? (
          <a
            href={isUnlistedStream && unlistedM3u8Url ? unlistedM3u8Url : twitchVodUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              // Modified clicks fall through to the browser's native new-tab handling
              if (e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              if (watchSettings.markWatchedOnPlay && !watch.isWatched) {
                onToggleWatch(video.id, false, video.lengthSeconds, true, video.owner?.login);
              }
              onPlay(video);
            }}
            onAuxClick={handleTitleAuxClick}
            className="absolute inset-0 z-20 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200 ease-out cursor-pointer backdrop-blur-[1px]"
            aria-label={`Play ${displayedTitle}`}
          >
            <span className="w-11 h-11 rounded-full bg-[#9146ff] hover:bg-[#772ce8] text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-all duration-200 ease-out active:scale-[0.95] pointer-events-auto">
              <Play className="w-4 h-4 ml-0.5 fill-current" />
            </span>
          </a>
        ) : null}

        {/* Progress bar line at bottom of thumbnail */}
        {watch.progressSeconds > 0 && !watch.isWatched && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-[#2d2d34] z-10">
            <div
              className="h-full bg-[#9146ff] transition-all shadow-sm shadow-[#9146ff]/50"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        )}
      </div>

      {/* Details Area */}
      <div className="p-3.5 sm:p-4 flex-1 flex flex-col justify-between">
        <div>
          {/* Creator & Game */}
          <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
            {streamerUrl ? (
              <a
                href={streamerUrl}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!e.ctrlKey && !e.metaKey && onSelectStreamer && video.owner?.login) {
                    e.preventDefault();
                    onSelectStreamer(video.owner.login);
                  }
                }}
                className="font-bold text-[#efeff1] hover:text-[#a970ff] hover:underline transition-colors truncate cursor-pointer text-left focus:outline-none focus:ring-1 focus:ring-[#9146ff]/50 rounded px-0.5 -mx-0.5"
                title={`Go to ${video.owner?.displayName || video.owner?.login}'s channel`}
              >
                {video.owner?.displayName || video.owner?.login}
              </a>
            ) : (
              <span className="font-bold text-[#efeff1] transition-colors truncate">
                {video.owner?.displayName || video.owner?.login || "Unknown"}
              </span>
            )}
            {video.game?.name && (
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded border truncate max-w-[140px] flex items-center gap-1 ${
                  (video as any).isFavoriteCategory
                    ? "bg-amber-400/15 text-amber-300 border-amber-400/35"
                    : "bg-[#9146ff]/15 text-[#bf94ff] border-[#9146ff]/30"
                }`}
                title={
                  (video as any).isFavoriteCategory
                    ? `${video.game.name} (Favorited Category)`
                    : video.game.name
                }
              >
                {(video as any).isFavoriteCategory && (
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 flex-shrink-0" />
                )}
                <span className="truncate">{video.game.name}</span>
              </span>
            )}
          </div>

          {/* Title: clicking title opens Twitch VOD or unlisted m3u8 in new tab */}
          <a
            href={isUnlistedStream && unlistedM3u8Url ? unlistedM3u8Url : twitchVodUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              if (watchSettings.markWatchedOnOpenLink && !watch.isWatched) {
                onToggleWatch(video.id, false, video.lengthSeconds, true, video.owner?.login);
              }
            }}
            onAuxClick={handleTitleAuxClick}
            className="text-xs font-semibold text-[#efeff1] line-clamp-2 leading-snug hover:text-[#a970ff] hover:underline cursor-pointer transition-colors block"
            title={
              isUnlistedStream
                ? `${displayedTitle} (Middle-click to open m3u8 link in new tab)`
                : `${displayedTitle} (Open on Twitch in new tab)`
            }
          >
            {displayedTitle}
          </a>
        </div>

        {/* Meta & Actions */}
        <div className="mt-2.5 pt-2 border-t border-[#2d2d34] flex items-center justify-between gap-1.5 sm:gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 sm:gap-2 text-[#767682] flex-shrink-0">
            <span suppressHydrationWarning className="tabular-nums">
              {formatRelativeDate(video.createdAt || video.publishedAt || "", dateFormat)}
            </span>
            {video.viewCount > 0 && (
              <span
                className="flex items-center gap-1 tabular-nums flex-shrink-0"
                title={`${video.viewCount.toLocaleString()} views`}
              >
                <Eye className="w-3 h-3 text-[#9146ff]" />
                <span>{formatCompactNumber(video.viewCount)}</span>
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Copy Stream Title button (Left-click copies title, Right-click opens menu) */}
            <div className="relative" ref={copyMenuRef}>
              <button
                type="button"
                onClick={handleCopyTitle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCopyMenu((prev) => !prev);
                }}
                className={`p-1.5 rounded transition-colors cursor-pointer active:scale-[0.98] ${
                  hasCopiedTitle
                    ? "text-[#00f59b] bg-[#00f59b]/15 hover:bg-[#00f59b]/25"
                    : "text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c]"
                }`}
                title={hasCopiedTitle ? "Copied title!" : "Copy stream title (Right-click for more options)"}
                aria-label={hasCopiedTitle ? "Copied stream title" : "Copy stream title"}
              >
                {hasCopiedTitle ? (
                  <Check className="w-3.5 h-3.5 text-[#00f59b]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Right-click Context Menu */}
              {showCopyMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full right-0 mb-1.5 w-44 bg-[#18181b] border border-[#3d3d46] rounded-md shadow-2xl py-1 text-xs z-50 animate-dropdown"
                >
                  <div className="px-2.5 py-1 text-[10px] font-semibold text-[#767682] uppercase tracking-wider border-b border-[#2d2d34]">
                    Copy Options
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(displayedTitle, "stream title")}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#bf94ff] flex-shrink-0" />
                    <span className="truncate">Stream Title</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        video.owner?.displayName || video.owner?.login || "Streamer",
                        "streamer name"
                      )
                    }
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-[#00f59b] flex-shrink-0" />
                    <span className="truncate">Streamer Name</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        formatRelativeDate(video.createdAt || video.publishedAt || "", dateFormat),
                        "date"
                      )
                    }
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[#f5a623] flex-shrink-0" />
                    <span className="truncate">Date</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(isUnlistedStream && unlistedM3u8Url ? unlistedM3u8Url : twitchVodUrl, isUnlistedStream ? "m3u8 link" : "VOD link")}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5 text-[#54a3ff] flex-shrink-0" />
                    <span className="truncate">{isUnlistedStream ? ".m3u8 Link" : "VOD Link"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(trackerUrl, "TwitchTracker link")}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <BarChart2 className="w-3.5 h-3.5 text-[#38bdf8] flex-shrink-0" />
                    <span className="truncate">TwitchTracker Link</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const origin = typeof window !== "undefined" ? window.location.origin : "";
                      copyText(`${origin}/?vod=${video.id}`, "share link");
                    }}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[#efeff1] hover:bg-[#26262c] hover:text-white transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#bf94ff] flex-shrink-0" />
                    <span className="truncate">Share Link</span>
                  </button>
                </div>
              )}
            </div>

            {/* Queue Toggle Button (Add / Remove) */}
            {onAddToQueue && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToQueue(video);
                }}
                className={`p-1.5 rounded transition-colors cursor-pointer active:scale-[0.98] ${
                  isInQueue
                    ? "text-[#bf94ff] bg-[#9146ff]/20 hover:bg-[#9146ff]/30 shadow-sm shadow-[#9146ff]/20"
                    : "text-[#767682] hover:text-[#9146ff] hover:bg-[#26262c]"
                }`}
                title={isInQueue ? "In playback queue (click to remove)" : "Add to playback queue"}
                aria-label={isInQueue ? "Remove from playback queue" : "Add to playback queue"}
              >
                {isInQueue ? (
                  <ListCheck className="w-3.5 h-3.5 text-[#bf94ff]" />
                ) : (
                  <ListPlus className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {/* Open on TwitchTracker button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(trackerUrl, "_blank", "noopener,noreferrer");
              }}
              className="p-1.5 rounded text-[#767682] hover:text-[#38bdf8] hover:bg-[#26262c] transition-colors cursor-pointer active:scale-[0.98]"
              title="Open stream in TwitchTracker (stats & analytics)"
              aria-label="Open in TwitchTracker"
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>

            {/* Watched toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch(
                  video.id,
                  watch.isWatched,
                  video.lengthSeconds,
                  false,
                  video.owner?.login
                );
              }}
              className={`p-1.5 rounded transition-colors cursor-pointer active:scale-[0.98] ${
                watch.isWatched
                  ? "text-[#00f59b] bg-[#00f59b]/10 hover:bg-[#00f59b]/20"
                  : "text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c]"
              }`}
              title={watch.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
              aria-label={watch.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

