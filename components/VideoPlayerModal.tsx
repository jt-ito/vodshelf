"use client";

import { useBookmarks } from "@/hooks/useBookmarks";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  RotateCw,
  Settings,
  Check,
  Radio,
  Clock,
  Bookmark,
  ListVideo,
  Share2,
  Trash2,
  Plus,
  SkipForward,
  BarChart2,
  GripVertical,
} from "lucide-react";
import { formatDuration } from "./VodCard";
import { useToast } from "./Toast";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { getTwitchTrackerUrl } from "@/lib/twitch/tracker";

export interface BookmarkItem {
  id: string;
  vodId: string;
  streamerLogin: string;
  timestampSeconds: number;
  note: string;
  createdAt?: string;
}

interface VideoPlayerModalProps {
  streamUrl: string | null;
  title: string;
  vodId: string;
  streamerLogin: string;
  streamId?: string;
  initialProgressSeconds?: number;
  onClose: () => void;
  onProgressUpdate?: (vodId: string, progressSeconds: number, totalSeconds: number) => void;
  onMarkWatched?: (vodId: string) => void;
  queue?: TwitchVodItem[];
  onPlayNext?: () => void;
  onSelectQueueItem?: (video: TwitchVodItem) => void;
  onRemoveFromQueue?: (vodId: string) => void;
  onReorderQueue?: (newQueue: TwitchVodItem[]) => void;
}

const VOLUME_STORAGE_KEY = "twitch_player_volume";
const MUTED_STORAGE_KEY = "twitch_player_muted";

export default function VideoPlayerModal({
  streamUrl,
  title,
  vodId,
  streamerLogin,
  streamId,
  initialProgressSeconds = 0,
  onClose,
  onProgressUpdate,
  onMarkWatched,
  queue = [],
  onPlayNext,
  onSelectQueueItem,
  onRemoveFromQueue,
  onReorderQueue,
}: VideoPlayerModalProps) {
  const { showToast } = useToast();
  const trackerUrl = getTwitchTrackerUrl(streamerLogin, { id: vodId, streamId, title });
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (saved !== null) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          return parsed;
        }
      }
    } catch {}
    return 1;
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = localStorage.getItem(MUTED_STORAGE_KEY);
      if (saved !== null) {
        return saved === "true";
      }
    } catch {}
    return false;
  });
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [qualities, setQualities] = useState<Array<{ id: number; name: string }>>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
  const [showSettings, setShowSettings] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const hasResumedRef = useRef(false);
  // Position playback resumed from; drives the "Resumed at … / Start over" prompt
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const hasMarkedCompletedRef = useRef(false);
  const hasAdvancedQueueRef = useRef(false);

  // Reset video state & guard refs when loading a new VOD/stream
  useEffect(() => {
    hasResumedRef.current = false;
    hasMarkedCompletedRef.current = false;
    hasAdvancedQueueRef.current = false;
    setResumedFrom(null);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
  }, [vodId, streamUrl]);

  // The resume prompt dismisses itself after a few seconds
  useEffect(() => {
    if (resumedFrom === null) return;
    const t = setTimeout(() => setResumedFrom(null), 8000);
    return () => clearTimeout(t);
  }, [resumedFrom]);

  const handleStartOver = () => {
    if (videoRef.current) videoRef.current.currentTime = 0;
    setResumedFrom(null);
  };

  // Bookmarks & Queue drawers
  const { bookmarks, add: addBookmark, remove: handleDeleteBookmark } = useBookmarks(vodId, streamerLogin);
  const [showBookmarksDrawer, setShowBookmarksDrawer] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [showAddBookmarkPrompt, setShowAddBookmarkPrompt] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);

  const currentQueueIndex = useMemo(() => {
    return queue.findIndex(
      (item) =>
        String(item.id) === String(vodId) ||
        (streamId && String(item.id) === String(streamId)) ||
        ((item as any).streamId && String((item as any).streamId) === String(streamId || vodId))
    );
  }, [queue, vodId, streamId]);

  const hasNextInQueue = currentQueueIndex === -1 ? queue.length > 0 : currentQueueIndex < queue.length - 1;

  // Drag-and-drop state for in-player queue drawer
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const [queueDropPosition, setQueueDropPosition] = useState<"before" | "after">("before");

  const handleDropQueueItem = (
    sourceId: string,
    targetId: string,
    position: "before" | "after"
  ) => {
    if (!onReorderQueue || sourceId === targetId) return;

    const list = [...queue];
    const sourceIdx = list.findIndex((item) => String(item.id) === String(sourceId));
    if (sourceIdx === -1) return;

    const [draggedItem] = list.splice(sourceIdx, 1);
    const targetIdx = list.findIndex((item) => String(item.id) === String(targetId));
    if (targetIdx === -1) return;

    const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
    list.splice(insertIdx, 0, draggedItem);

    onReorderQueue(list);
  };

  // Initialize HLS.js
  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        setIsBuffering(false);
        // Set volume according to saved preference
        video.volume = volume;
        video.muted = isMuted;

        // Map available quality levels
        const levels = data.levels.map((lvl, index) => ({
          id: index,
          name:
            lvl.height && lvl.height > 0
              ? `${lvl.height}p${lvl.frameRate ? ` (${Math.round(lvl.frameRate)}fps)` : ""}`
              : "Source (Original)",
        }));
        setQualities(levels);

        // DEFAULT TO HIGHEST QUALITY LEVEL
        if (levels.length > 0) {
          const highestLevelIndex = levels.length - 1;
          hls!.currentLevel = highestLevelIndex;
          setCurrentQuality(highestLevelIndex);
        }

        // Resume playback from saved progress
        if (initialProgressSeconds > 5 && !hasResumedRef.current) {
          video.currentTime = initialProgressSeconds;
          hasResumedRef.current = true;
          setResumedFrom(initialProgressSeconds);
        }

        video.play().catch(() => {
          // Autoplay blocked without user interaction
          setIsPlaying(false);
        });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls!.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls!.recoverMediaError();
              break;
            default:
              hls!.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari HLS
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        setIsBuffering(false);
        video.volume = volume;
        video.muted = isMuted;
        if (initialProgressSeconds > 5 && !hasResumedRef.current) {
          video.currentTime = initialProgressSeconds;
          hasResumedRef.current = true;
          setResumedFrom(initialProgressSeconds);
        }
        video.play().catch(() => setIsPlaying(false));
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [streamUrl, initialProgressSeconds]);

  // Keep video element volume and muted properties in sync
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  const markCompleted = useCallback(async () => {
    if (!vodId || !streamerLogin) return;
    if (hasMarkedCompletedRef.current) return;
    hasMarkedCompletedRef.current = true;

    try {
      const totalSec = Math.floor(videoRef.current?.duration || duration);
      const res = await fetch("/api/watch/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodId,
          streamerLogin,
          progressSeconds: totalSec,
          totalSeconds: totalSec,
          isWatched: true,
        }),
      });

      if (!res.ok) {
        hasMarkedCompletedRef.current = false;
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to mark VOD as completed", "error");
        return;
      }

      if (onProgressUpdate) {
        onProgressUpdate(vodId, totalSec, totalSec);
      }
      if (onMarkWatched) {
        onMarkWatched(vodId);
      }
    } catch (err) {
      hasMarkedCompletedRef.current = false;
      console.error("Failed to mark VOD watched on completion:", err);
    }
  }, [vodId, streamerLogin, duration, onProgressUpdate, onMarkWatched, showToast]);

  // Video ended handler - advance to next in queue
  const handleVideoEnded = useCallback(() => {
    // Ensure marked as watched if not already completed by threshold
    if (!hasMarkedCompletedRef.current) {
      markCompleted();
    }

    // Auto-advance to next in queue if available
    if (hasNextInQueue && onPlayNext && !hasAdvancedQueueRef.current) {
      hasAdvancedQueueRef.current = true;
      showToast("Playing next VOD in queue...");
      onPlayNext();
    }
  }, [hasNextInQueue, onPlayNext, markCompleted, showToast]);

  // Video event handlers
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const total = videoRef.current.duration || duration;
    setCurrentTime(current);

    if (total > 30 && (current / total >= 0.95 || current >= total - 5)) {
      if (!hasMarkedCompletedRef.current) {
        markCompleted();
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
  };

  // Heartbeat progress syncing (every 10s)
  useEffect(() => {
    if (!vodId || !streamerLogin) return;

    const interval = setInterval(() => {
      if (!videoRef.current || videoRef.current.paused) return;

      const currentSec = Math.floor(videoRef.current.currentTime);
      const totalSec = Math.floor(videoRef.current.duration || duration);

      if (currentSec > 0) {
        fetch("/api/watch/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vodId,
            streamerLogin,
            progressSeconds: currentSec,
            totalSeconds: totalSec,
          }),
          keepalive: true,
        }).catch((err) => console.error("Watch progress sync error:", err));

        if (onProgressUpdate) {
          onProgressUpdate(vodId, currentSec, totalSec);
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [vodId, streamerLogin, duration, onProgressUpdate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;

      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekDelta(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekDelta(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          adjustVolume(0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          adjustVolume(-0.05);
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
        case "b":
        case "B":
          e.preventDefault();
          setShowAddBookmarkPrompt(true);
          break;
        case "Escape":
          e.preventDefault();
          if (showAddBookmarkPrompt) {
            setShowAddBookmarkPrompt(false);
          } else if (showBookmarksDrawer) {
            setShowBookmarksDrawer(false);
          } else if (showQueueDrawer) {
            setShowQueueDrawer(false);
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAddBookmarkPrompt, showBookmarksDrawer, showQueueDrawer, onClose]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekDelta = (seconds: number) => {
    if (!videoRef.current) return;
    const currentDur = videoRef.current.duration || duration;
    const newTime = Math.max(0, Math.min(currentDur, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (currentDur > 0 && newTime < currentDur - 10) {
      hasAdvancedQueueRef.current = false;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const target = parseFloat(e.target.value);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    const currentDur = videoRef.current.duration || duration;
    if (currentDur > 0 && target < currentDur - 10) {
      hasAdvancedQueueRef.current = false;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    try {
      localStorage.setItem(MUTED_STORAGE_KEY, String(nextMuted));
    } catch {}
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    const clamped = Math.max(0, Math.min(1, isNaN(val) ? 1 : val));
    videoRef.current.volume = clamped;
    setVolume(clamped);
    const muted = clamped === 0;
    videoRef.current.muted = muted;
    setIsMuted(muted);
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
      localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
    } catch {}
  };

  const adjustVolume = (delta: number) => {
    if (!videoRef.current) return;
    const current = isMuted ? 0 : volume;
    const next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
    videoRef.current.volume = next;
    setVolume(next);
    const muted = next === 0;
    videoRef.current.muted = muted;
    setIsMuted(muted);
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
      localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
    } catch {}
  };

  const handleQualityChange = (levelIndex: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = levelIndex;
    setCurrentQuality(levelIndex);
    setShowSettings(false);
  };

  const handleSpeedChange = (speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSettings(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Add bookmark
  const handleSaveBookmark = async () => {
    setIsSavingBookmark(true);
    const timestamp = Math.floor(currentTime);
    const saved = await addBookmark(timestamp, bookmarkNote);
    if (saved) {
      showToast(`Bookmark saved at ${formatDuration(timestamp)}`);
      setBookmarkNote("");
      setShowAddBookmarkPrompt(false);
    }
    setIsSavingBookmark(false);
  };

  // Copy shareable deep link with current timestamp
  const handleCopyShareLink = () => {
    const timestamp = Math.floor(currentTime);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const shareUrl = `${origin}/?vod=${encodeURIComponent(vodId)}&t=${timestamp}`;

    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast(`Copied share link with timestamp (${formatDuration(timestamp)})!`);
    }).catch(() => {
      showToast("Failed to copy share link", "error");
    });
  };

  if (!streamUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-0 sm:p-4 animate-fade-in-up">
      <div
        ref={containerRef}
        className="relative w-full max-w-5xl bg-black rounded-none sm:rounded-lg overflow-hidden border-0 sm:border border-[#2d2d34] shadow-2xl flex flex-col group animate-scale-in max-h-screen"
      >
        {/* Top bar with title, share, and close */}
        <div className="absolute top-0 left-0 right-0 z-20 p-3 sm:p-4 bg-gradient-to-b from-black/90 to-transparent flex items-center justify-between pointer-events-none opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <div className="pointer-events-auto max-w-xl">
            <h3 className="text-sm sm:text-base font-bold text-white truncate drop-shadow">{title}</h3>
            <p className="text-xs text-[#adadb8] drop-shadow">VOD ID: {vodId}</p>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Open in TwitchTracker */}
            {streamerLogin && (
              <a
                href={trackerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-full bg-black/60 hover:bg-[#38bdf8] text-white transition-colors"
                title="Open stream in TwitchTracker (stats & chat analytics)"
                aria-label="Open in TwitchTracker"
              >
                <BarChart2 className="w-4 h-4" />
              </a>
            )}
            {/* Copy Share Link */}
            <button
              onClick={handleCopyShareLink}
              className="p-2 rounded-full bg-black/60 hover:bg-[#9146ff] text-white transition-colors"
              title="Copy share link with current timestamp"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-black/60 hover:bg-[#eb0400] text-white transition-colors"
              title="Close (Esc)"
              aria-label="Close video player"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Video Element */}
        <div className="relative aspect-video w-full bg-black flex items-center justify-center cursor-pointer" onClick={togglePlay}>
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
            onEnded={handleVideoEnded}
            playsInline
          />

          {resumedFrom !== null && (
            <div
              className="absolute bottom-3 left-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-md bg-black/80 border border-[#9146ff]/40 text-xs text-white animate-tab-fade-in"
              onClick={(e) => e.stopPropagation()}
              role="status"
            >
              <span>
                Resumed at <strong className="font-mono">{formatDuration(resumedFrom)}</strong>
              </span>
              <button
                type="button"
                onClick={handleStartOver}
                className="px-2 py-0.5 rounded bg-[#9146ff] hover:bg-[#772ce8] font-semibold transition-colors cursor-pointer"
              >
                Start over
              </button>
            </div>
          )}

          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
              <div className="w-12 h-12 border-4 border-[#9146ff] border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>

        {/* Video Controls Bar */}
        <div className="p-3 bg-[#18181b] border-t border-[#2d2d34] flex flex-col gap-2 relative">
          {/* Progress Bar Slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#adadb8] tabular-nums mono-font">
              {formatDuration(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={1}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1.5 bg-[#2d2d34] rounded-lg appearance-none cursor-pointer accent-[#9146ff]"
            />
            <span className="text-xs text-[#adadb8] tabular-nums mono-font">
              {formatDuration(duration)}
            </span>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-[#efeff1]">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="p-2 rounded-lg hover:bg-[#26262c] transition-colors"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              </button>

              {/* Skip 10s */}
              <button
                onClick={() => seekDelta(-10)}
                className="p-1.5 rounded-lg hover:bg-[#26262c] text-[#adadb8] hover:text-white transition-colors"
                title="Rewind 10s"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => seekDelta(10)}
                className="p-1.5 rounded-lg hover:bg-[#26262c] text-[#adadb8] hover:text-white transition-colors"
                title="Forward 10s"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Volume (hidden on small mobile screens where physical volume buttons are used) */}
              <div className="hidden sm:flex items-center gap-1.5 ml-2">
                <button
                  onClick={toggleMute}
                  className="p-1.5 rounded-lg hover:bg-[#26262c] text-[#adadb8] hover:text-white transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-[#2d2d34] rounded-lg appearance-none cursor-pointer accent-[#9146ff]"
                />
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center gap-2 relative">
              {/* Add Bookmark button */}
              <button
                onClick={() => setShowAddBookmarkPrompt(!showAddBookmarkPrompt)}
                className={`p-2 rounded-lg transition-colors ${
                  showAddBookmarkPrompt ? "bg-[#9146ff] text-white" : "hover:bg-[#26262c] text-[#adadb8] hover:text-white"
                }`}
                title="Bookmark timestamp (b)"
              >
                <Bookmark className="w-4 h-4" />
              </button>

              {/* Saved Bookmarks Drawer Toggle */}
              {bookmarks.length > 0 && (
                <button
                  onClick={() => {
                    setShowBookmarksDrawer(!showBookmarksDrawer);
                    setShowQueueDrawer(false);
                  }}
                  className={`px-2 py-1 text-xs rounded-md flex items-center gap-1 transition-colors ${
                    showBookmarksDrawer ? "bg-[#9146ff] text-white" : "bg-[#26262c] text-[#adadb8] hover:text-white"
                  }`}
                  title="View bookmarks"
                >
                  <Bookmark className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono">{bookmarks.length}</span>
                </button>
              )}

              {/* Queue Drawer Toggle */}
              {queue.length > 0 && (
                <button
                  onClick={() => {
                    setShowQueueDrawer(!showQueueDrawer);
                    setShowBookmarksDrawer(false);
                  }}
                  className={`px-2 py-1 text-xs rounded-md flex items-center gap-1 transition-colors ${
                    showQueueDrawer ? "bg-[#9146ff] text-white" : "bg-[#26262c] text-[#adadb8] hover:text-white"
                  }`}
                  title="Playback queue"
                >
                  <ListVideo className="w-3.5 h-3.5" />
                  <span className="font-mono">{queue.length}</span>
                </button>
              )}

              {/* Next in Queue button */}
              {hasNextInQueue && onPlayNext && (
                <button
                  onClick={onPlayNext}
                  className="p-2 rounded-lg hover:bg-[#26262c] text-[#adadb8] hover:text-[#00f59b] transition-colors"
                  title="Skip to next VOD in queue"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              )}

              {/* Settings Menu Button */}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings ? "bg-[#9146ff] text-white" : "hover:bg-[#26262c] text-[#adadb8] hover:text-white"
                }`}
                title="Stream Settings & Quality"
              >
                <Settings className="w-4 h-4" />
              </button>

              {/* Settings Dropdown Popover */}
              {showSettings && (
                <div className="absolute bottom-full right-0 mb-2 w-56 bg-[#1f1f23] border border-[#2d2d34] rounded-xl shadow-2xl p-3 z-30 space-y-3 animate-scale-in origin-bottom-right">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#767682] mb-1.5">
                      Stream Quality (Default Highest)
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      <button
                        onClick={() => handleQualityChange(-1)}
                        className={`w-full px-2 py-1 text-xs rounded-md flex items-center justify-between text-left ${
                          currentQuality === -1 ? "bg-[#9146ff] text-white font-bold" : "text-[#adadb8] hover:bg-[#26262c]"
                        }`}
                      >
                        <span>Auto (Adaptive)</span>
                        {currentQuality === -1 && <Check className="w-3.5 h-3.5" />}
                      </button>
                      {qualities.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => handleQualityChange(q.id)}
                          className={`w-full px-2 py-1 text-xs rounded-md flex items-center justify-between text-left ${
                            currentQuality === q.id ? "bg-[#9146ff] text-white font-bold" : "text-[#adadb8] hover:bg-[#26262c]"
                          }`}
                        >
                          <span>{q.name}</span>
                          {currentQuality === q.id && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#2d2d34]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#767682] mb-1.5">
                      Speed
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0.75, 1, 1.25, 1.5].map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSpeedChange(s)}
                          className={`py-1 text-xs rounded text-center font-medium ${
                            playbackSpeed === s ? "bg-[#9146ff] text-white" : "text-[#adadb8] bg-[#26262c] hover:bg-[#32323a]"
                          }`}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg hover:bg-[#26262c] text-[#adadb8] hover:text-white transition-colors"
                title="Fullscreen (F)"
              >
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Bookmark Input Prompt */}
          {showAddBookmarkPrompt && (
            <div className="absolute bottom-full right-4 mb-2 w-72 bg-[#1f1f23] border border-[#2d2d34] rounded-xl shadow-2xl p-3 z-30 space-y-2 animate-scale-in">
              <div className="flex items-center justify-between text-xs font-semibold text-white">
                <span className="flex items-center gap-1.5 text-[#bf94ff]">
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Bookmark at {formatDuration(currentTime)}</span>
                </span>
                <button
                  onClick={() => setShowAddBookmarkPrompt(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={bookmarkNote}
                onChange={(e) => setBookmarkNote(e.target.value)}
                placeholder="Optional note (e.g. clutch ace)"
                className="w-full px-2.5 py-1.5 bg-[#0e0e10] border border-[#2d2d34] rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#9146ff]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveBookmark();
                }}
              />
              <button
                onClick={handleSaveBookmark}
                disabled={isSavingBookmark}
                className="w-full py-1 bg-[#9146ff] hover:bg-[#772ce8] text-white text-xs font-semibold rounded transition-colors flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save Bookmark</span>
              </button>
            </div>
          )}

          {/* Bookmarks Drawer */}
          {showBookmarksDrawer && (
            <div className="absolute bottom-full right-4 mb-2 w-80 bg-[#1f1f23] border border-[#2d2d34] rounded-xl shadow-2xl p-3 z-30 space-y-2 max-h-60 overflow-y-auto animate-scale-in">
              <div className="flex items-center justify-between text-xs font-bold text-[#efeff1] pb-1 border-b border-[#2d2d34]">
                <span>Saved Bookmarks ({bookmarks.length})</span>
                <button onClick={() => setShowBookmarksDrawer(false)} className="text-gray-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {bookmarks.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#141417] hover:bg-[#26262c] text-xs transition-colors group/bm"
                  >
                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = b.timestampSeconds;
                          setCurrentTime(b.timestampSeconds);
                        }
                      }}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                    >
                      <span className="font-mono text-[#00f59b] font-semibold flex-shrink-0">
                        {formatDuration(b.timestampSeconds)}
                      </span>
                      <span className="truncate text-gray-200">{b.note || "Bookmark"}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBookmark(b.id)}
                      className="opacity-0 group-hover/bm:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-opacity"
                      title="Delete bookmark"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queue Drawer */}
          {showQueueDrawer && (
            <div className="absolute bottom-full right-4 mb-2 w-84 bg-[#1f1f23] border border-[#2d2d34] rounded-xl shadow-2xl p-3 z-30 space-y-2 max-h-72 overflow-y-auto animate-scale-in">
              <div className="flex items-center justify-between text-xs font-bold text-[#efeff1] pb-1 border-b border-[#2d2d34]">
                <div className="flex items-center gap-1.5">
                  <ListVideo className="w-4 h-4 text-[#9146ff]" />
                  <span>Playback Queue ({queue.length})</span>
                </div>
                <button
                  onClick={() => setShowQueueDrawer(false)}
                  className="p-1 text-gray-400 hover:text-white rounded transition-colors cursor-pointer"
                  title="Close queue drawer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {queue.map((item, idx) => {
                  const isCurrent = idx === currentQueueIndex;
                  const isPast = currentQueueIndex !== -1 && idx < currentQueueIndex;
                  const isBeingDragged = draggedQueueId === String(item.id);
                  const isDropTarget = dragOverQueueId === String(item.id) && !isBeingDragged;

                  return (
                    <div
                      key={item.id}
                      draggable={Boolean(onReorderQueue)}
                      onDragStart={(e) => {
                        setDraggedQueueId(String(item.id));
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(item.id));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (draggedQueueId && draggedQueueId !== String(item.id)) {
                          setDragOverQueueId(String(item.id));
                          const rect = e.currentTarget.getBoundingClientRect();
                          const mid = rect.top + rect.height / 2;
                          setQueueDropPosition(e.clientY < mid ? "before" : "after");
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          if (dragOverQueueId === String(item.id)) {
                            setDragOverQueueId(null);
                          }
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggedQueueId && draggedQueueId !== String(item.id)) {
                          handleDropQueueItem(draggedQueueId, String(item.id), queueDropPosition);
                        }
                        setDraggedQueueId(null);
                        setDragOverQueueId(null);
                      }}
                      onDragEnd={() => {
                        setDraggedQueueId(null);
                        setDragOverQueueId(null);
                      }}
                      onClick={() => {
                        if (draggedQueueId) return;
                        if (!isCurrent && onSelectQueueItem) {
                          onSelectQueueItem(item);
                        }
                      }}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs group/q transition-all select-none border ${
                        isBeingDragged
                          ? "opacity-30 bg-[#26262c]/50 border-2 border-dashed border-[#9146ff] scale-[0.99]"
                          : isDropTarget
                          ? queueDropPosition === "before"
                            ? "bg-[#9146ff]/15 border-t-2 border-t-[#9146ff] border-x border-b border-transparent shadow-md"
                            : "bg-[#9146ff]/15 border-b-2 border-b-[#9146ff] border-x border-t border-transparent shadow-md"
                          : isCurrent
                          ? "bg-[#9146ff]/20 border border-[#9146ff]/50 text-white cursor-default"
                          : isPast
                          ? "bg-[#141417]/60 hover:bg-[#1f1f23] text-[#767682] hover:text-[#efeff1] opacity-60 hover:opacity-100 cursor-pointer border border-transparent hover:border-[#3d3d46]"
                          : "bg-[#18181b] hover:bg-[#26262c] text-[#efeff1] cursor-pointer border border-transparent hover:border-[#9146ff]/30"
                      }`}
                      title={isCurrent ? "Currently Playing" : `Click to play: ${item.title}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {/* Drag Handle */}
                        {onReorderQueue && (
                          <div
                            className="p-0.5 text-[#767682] hover:text-[#bf94ff] active:text-[#9146ff] cursor-grab active:cursor-grabbing rounded hover:bg-[#26262c] transition-colors flex-shrink-0"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                          >
                            <GripVertical className="w-3 h-3" />
                          </div>
                        )}
                        <span
                          className={`font-mono text-[10px] w-4 flex-shrink-0 ${
                            isCurrent ? "text-[#bf94ff] font-bold" : isPast ? "text-[#555560]" : "text-[#767682]"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`truncate font-medium ${
                                isCurrent
                                  ? "text-white font-semibold"
                                  : isPast
                                  ? "text-[#8a8a93] group-hover/q:text-[#efeff1]"
                                  : "text-[#efeff1]"
                              }`}
                            >
                              {item.title}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.2 text-[8px] font-extrabold uppercase tracking-wider bg-[#9146ff] text-white rounded flex-shrink-0 shadow-sm">
                                Playing
                              </span>
                            )}
                            {isPast && (
                              <span className="px-1.5 py-0.2 text-[8px] font-semibold uppercase tracking-wider bg-[#26262c] text-[#767682] rounded flex-shrink-0">
                                Past
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#767682] flex items-center gap-1 mt-0.5">
                            <span>{formatDuration(item.lengthSeconds)}</span>
                            {item.owner?.displayName && (
                              <>
                                <span>•</span>
                                <span className="truncate">{item.owner.displayName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Hover X remove button for past, current, and future items */}
                      {onRemoveFromQueue && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFromQueue(item.id);
                          }}
                          className="opacity-0 group-hover/q:opacity-100 p-1 text-[#767682] hover:text-[#ff7070] hover:bg-[#eb0400]/15 rounded transition-all ml-1 flex-shrink-0 cursor-pointer"
                          title="Remove from queue"
                          aria-label={`Remove ${item.title} from queue`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
