"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Play,
  Copy,
  Download,
  Search,
  Check,
  AlertCircle,
  Clock,
  Calendar,
  Lock,
  Loader2,
  Tv,
  EyeOff,
  Layers,
  BarChart2,
  ArrowUpDown,
  X,
} from "lucide-react";
import { formatDuration, formatRelativeDate } from "./VodCard";
import { useToast } from "./Toast";
import { AVAILABILITY_COPY, isNotReady, type Availability } from "@/lib/twitch/availability";
import { saveWatchStatus } from "@/lib/watch/client";
import { useDateFormat } from "@/lib/date";
import { getTwitchTrackerUrl } from "@/lib/twitch/tracker";

interface CdnStreamItem {
  id: string;
  streamId: string;
  vodId?: string;
  twitchTrackerStreamId?: string;
  trackerUrl?: string;
  streamerLogin?: string;
  title: string;
  gameName: string;
  startTime: string;
  durationSeconds: number;
  masterPlaylistUrl: string;
  proxiedUrl: string;
  isUnlisted: boolean;
  availability?: Availability;
  qualities: Array<{ name: string; url: string }>;
  watchStatus?: {
    isWatched: boolean;
    progressSeconds: number;
    totalSeconds: number;
  };
}

interface CdnRecoveryTabProps {
  initialVodId?: string;
  streamerLogin: string;
  onPlayStream: (streamUrl: string, title: string, vodId: string) => void;
  isLoggedIn?: boolean;
  onOpenAuth?: () => void;
  onToggleWatch?: (
    vodId: string,
    currentStatus: boolean,
    totalSeconds: number,
    silent?: boolean,
    streamerLogin?: string
  ) => Promise<boolean | void> | boolean | void;
}

export default function CdnRecoveryTab({
  initialVodId = "",
  streamerLogin,
  onPlayStream,
  isLoggedIn = false,
  onOpenAuth,
  onToggleWatch,
}: CdnRecoveryTabProps) {
  const { showToast } = useToast();
  const dateFormat = useDateFormat();
  const [streamList, setStreamList] = useState<CdnStreamItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [singleResult, setSingleResult] = useState<any | null>(null);
  const [isProbingSingle, setIsProbingSingle] = useState(false);
  const [manualInput, setManualInput] = useState(initialVodId);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unlisted">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateSort, setDateSort] = useState<"newest" | "oldest">("newest");
  const [error, setError] = useState<string | null>(null);

  // Restore saved date sort preference on mount
  useEffect(() => {
    try {
      const cookieMatch = document.cookie.match(/(?:^|;\s*)twitch_cdn_date_sort=([^;]*)/);
      if (cookieMatch && ["newest", "oldest"].includes(cookieMatch[1])) {
        setDateSort(cookieMatch[1] as any);
        return;
      }
      const savedSort = localStorage.getItem("twitch_cdn_date_sort");
      if (savedSort === "newest" || savedSort === "oldest") {
        setDateSort(savedSort);
      }
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const handleDateSortChange = (newSort: "newest" | "oldest") => {
    setDateSort(newSort);
    try {
      localStorage.setItem("twitch_cdn_date_sort", newSort);
      document.cookie = `twitch_cdn_date_sort=${newSort}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore
    }
  };

  const handleToggleStreamWatch = async (stream: CdnStreamItem) => {
    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }

    const vodId = stream.streamId || stream.id;
    const currentStatus = Boolean(stream.watchStatus?.isWatched);
    const duration = stream.durationSeconds || 0;
    const login = stream.streamerLogin || streamerLogin;

    // Optimistically update stream list state
    setStreamList((prev) =>
      prev.map((s) => {
        if (s.id === stream.id || (stream.streamId && s.streamId === stream.streamId)) {
          return {
            ...s,
            watchStatus: {
              isWatched: !currentStatus,
              progressSeconds: !currentStatus ? duration : 0,
              totalSeconds: duration,
            },
          };
        }
        return s;
      })
    );

    if (onToggleWatch) {
      const ok = await onToggleWatch(vodId, currentStatus, duration, false, login);
      if (ok === false) {
        // Parent already reported the error; roll back the optimistic update
        setStreamList((prev) =>
          prev.map((s) =>
            s.id === stream.id || (stream.streamId && s.streamId === stream.streamId)
              ? { ...s, watchStatus: { isWatched: currentStatus, progressSeconds: currentStatus ? duration : 0, totalSeconds: duration } }
              : s
          )
        );
      }
    } else {
      const err = await saveWatchStatus({
        vodId,
        streamerLogin: login,
        isWatched: !currentStatus,
        progressSeconds: !currentStatus ? duration : 0,
        totalSeconds: duration,
      });
      if (err) {
        showToast(err, "error");
        // Roll back the optimistic update
        setStreamList((prev) =>
          prev.map((s) =>
            s.id === stream.id || (stream.streamId && s.streamId === stream.streamId)
              ? { ...s, watchStatus: { isWatched: currentStatus, progressSeconds: currentStatus ? duration : 0, totalSeconds: duration } }
              : s
          )
        );
      } else {
        showToast(!currentStatus ? "Marked as watched" : "Marked as unwatched");
      }
    }
  };

  const handleToggleSingleResultWatch = async () => {
    if (!singleResult) return;
    if (!isLoggedIn) {
      onOpenAuth?.();
      return;
    }

    const vodId = singleResult.vodId;
    const currentStatus = Boolean(singleResult.watchStatus?.isWatched);
    const duration = singleResult.durationSeconds || 0;
    const login = singleResult.streamerLogin || streamerLogin;

    setSingleResult((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        watchStatus: {
          isWatched: !currentStatus,
          progressSeconds: !currentStatus ? duration : 0,
          totalSeconds: duration,
        },
      };
    });

    if (onToggleWatch) {
      const ok = await onToggleWatch(vodId, currentStatus, duration, false, login);
      if (ok === false) {
        setSingleResult((prev: any) =>
          prev
            ? { ...prev, watchStatus: { isWatched: currentStatus, progressSeconds: currentStatus ? duration : 0, totalSeconds: duration } }
            : prev
        );
      }
    } else {
      const err = await saveWatchStatus({
        vodId,
        streamerLogin: login,
        isWatched: !currentStatus,
        progressSeconds: !currentStatus ? duration : 0,
        totalSeconds: duration,
      });
      if (err) {
        showToast(err, "error");
        setSingleResult((prev: any) =>
          prev
            ? { ...prev, watchStatus: { isWatched: currentStatus, progressSeconds: currentStatus ? duration : 0, totalSeconds: duration } }
            : prev
        );
      } else {
        showToast(!currentStatus ? "Marked as watched" : "Marked as unwatched");
      }
    }
  };

  // Load channel indexed streams
  const loadChannelCdnStreams = async () => {
    if (!streamerLogin) return;
    setIsLoadingList(true);
    setError(null);

    try {
      const res = await fetch(`/api/twitch/cdn-list/${encodeURIComponent(streamerLogin)}`);
      if (res.ok) {
        const data = await res.json();
        setStreamList(data.streams || []);
      }
    } catch {
      setError("Unable to query unlisted stream index for this channel.");
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadChannelCdnStreams();
  }, [streamerLogin]);

  useEffect(() => {
    if (initialVodId) {
      setManualInput(initialVodId);
      handleManualProbe(initialVodId);
    }
  }, [initialVodId]);

  // Probe specific manual stream/VOD ID
  const handleManualProbe = async (id: string) => {
    const cleanId = id.replace(/[^0-9]/g, "");
    if (!cleanId) return;

    setIsProbingSingle(true);
    setError(null);

    try {
      const res = await fetch(`/api/twitch/cdn/${cleanId}`);
      if (res.ok) {
        const data = await res.json();
        setSingleResult(data.recovery);
        showToast(`Manifest resolved for ${cleanId}`);
      } else {
        throw new Error("CloudFront manifests not found for this ID.");
      }
    } catch (err: any) {
      setError(err.message || "CloudFront probing failed.");
      showToast(err.message || "Probing failed", "error");
    } finally {
      setIsProbingSingle(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      handleManualProbe(manualInput.trim());
    }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    showToast("Copied .m3u8 link to clipboard");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleDownloadM3u8 = (url: string, filename = "stream.m3u8") => {
    const element = document.createElement("a");
    element.setAttribute("href", url);
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showToast("Downloaded .m3u8 playlist file");
  };

  const filteredStreams = useMemo(() => {
    let list = streamList.filter((s) => {
      if (filter === "unlisted" && !s.isUnlisted) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = (s.title || "").toLowerCase().includes(q);
        const matchGame = (s.gameName || "").toLowerCase().includes(q);
        const matchId = (s.id || "").toLowerCase().includes(q) || (s.streamId || "").toLowerCase().includes(q);
        if (!matchTitle && !matchGame && !matchId) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      const timeA = new Date(a.startTime || 0).getTime();
      const timeB = new Date(b.startTime || 0).getTime();
      return dateSort === "oldest" ? timeA - timeB : timeB - timeA;
    });

    return list;
  }, [streamList, filter, searchQuery, dateSort]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-2 animate-fade-in-up">
      {/* Search / Probe Console Bar */}
      <div className="p-4 rounded-lg bg-[#18181b] border border-[#2d2d34]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm sm:text-base font-bold text-[#efeff1] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#9146ff]" />
              <span>CDN Stream Recovery</span>
            </h2>
            <p className="text-xs text-[#767682] max-w-xl leading-relaxed">
              Reconstruct and probe CloudFront HLS stream manifests for <span className="text-[#efeff1]">@{streamerLogin}</span>.
            </p>
          </div>

          {/* Manual Input for custom ID */}
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2 flex-shrink-0">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Probe VOD / Stream ID…"
              className="w-48 sm:w-56 px-3 py-1.5 text-xs bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
            />
            <button
              type="submit"
              disabled={isProbingSingle || !manualInput.trim()}
              className="px-3 py-1.5 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-50 text-white font-semibold text-xs rounded-md flex items-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer"
            >
              {isProbingSingle ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Probe</span>
            </button>
          </form>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 rounded-md bg-[#18181b] border border-[#eb0400]/40 text-[#ff8080] flex items-center gap-2.5 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#eb0400]" />
          <span>{error}</span>
        </div>
      )}

      {/* Single Probe Result (if user searched a specific ID) */}
      {singleResult && (
        <div className="p-4 rounded-lg bg-[#18181b] border border-[#2d2d34] space-y-3 animate-fade-in-up">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00f59b]/15 text-[#00f59b] border border-[#00f59b]/30 flex items-center gap-1">
                <Check className="w-2.5 h-2.5" />
                <span>Edge Manifest Verified</span>
              </span>
              {singleResult.watchStatus?.isWatched && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00f59b] text-black flex items-center gap-1 shadow-sm animate-badge-pop">
                  <Check className="w-2.5 h-2.5" />
                  <span>WATCHED</span>
                </span>
              )}
            </div>
            <span className="mono-font text-[11px] text-[#767682]">
              ID: {singleResult.vodId}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[#efeff1]">{singleResult.title || "Stream Broadcast"}</h3>
              <p className="text-xs text-[#767682] mt-0.5">
                Edge Node: <span className="mono-font text-[#adadb8]">{singleResult.edgeDomain}</span>
              </p>
            </div>

            {singleResult.proxiedMasterUrl && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPlayStream(singleResult.proxiedMasterUrl, singleResult.title, singleResult.vodId)}
                  className="px-3 py-1.5 bg-[#9146ff] hover:bg-[#772ce8] text-white font-semibold text-xs rounded-md flex items-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play in Browser</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleSingleResultWatch}
                  className={`p-1.5 rounded-md border transition-colors cursor-pointer active:scale-[0.98] inline-flex items-center justify-center ${
                    singleResult.watchStatus?.isWatched
                      ? "text-[#00f59b] bg-[#00f59b]/15 border-[#00f59b]/40 hover:bg-[#00f59b]/25"
                      : "text-[#767682] hover:text-[#efeff1] bg-[#26262c] hover:bg-[#32323a] border-[#2d2d34]"
                  }`}
                  title={singleResult.watchStatus?.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
                  aria-label={singleResult.watchStatus?.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <a
                  href={singleResult.trackerUrl || getTwitchTrackerUrl(streamerLogin, singleResult)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#adadb8] hover:text-[#38bdf8] rounded-md border border-[#2d2d34] transition-colors cursor-pointer active:scale-[0.98] inline-flex items-center justify-center"
                  title="Open stream in TwitchTracker"
                  aria-label="Open in TwitchTracker"
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => handleCopy(singleResult.masterPlaylistUrl)}
                  className="p-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] rounded-md border border-[#2d2d34] transition-colors active:scale-[0.98]"
                  title="Copy direct .m3u8"
                >
                  {copiedUrl === singleResult.masterPlaylistUrl ? (
                    <Check className="w-3.5 h-3.5 text-[#00f59b]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recovered Streams List Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2d2d34]">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-[#767682] uppercase tracking-wider">
              Available Stream Manifests
            </h3>
            <span className="text-[11px] px-1.5 py-0.2 rounded bg-[#26262c] text-[#767682]">
              {filteredStreams.length} / {streamList.length}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-2.5 text-[#767682] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search manifests…"
                className="pl-8 pr-7 py-1 text-xs bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff] w-36 sm:w-44"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 text-[#767682] hover:text-[#efeff1] p-0.5 rounded cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Date Sort Dropdown */}
            <div className="flex items-center gap-1.5 bg-[#26262c] px-2.5 py-1 rounded border border-[#3f3f46]/50 text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-[#adadb8]" />
              <select
                value={dateSort}
                onChange={(e) => handleDateSortChange(e.target.value as any)}
                className="bg-transparent text-[#efeff1] text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="newest" className="bg-[#1f1f23]">Newest First</option>
                <option value="oldest" className="bg-[#1f1f23]">Oldest First</option>
              </select>
            </div>

            {/* Filter chips with semantic color states */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
                  filter === "all"
                    ? "bg-[#9146ff] text-white shadow-sm"
                    : "bg-[#26262c] text-[#adadb8] hover:text-[#efeff1]"
                }`}
              >
                All ({streamList.length})
              </button>
              <button
                onClick={() => setFilter("unlisted")}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
                  filter === "unlisted"
                    ? "bg-[#eb0400]/25 text-[#ff7070] border border-[#eb0400]/40 shadow-sm"
                    : "bg-[#26262c] text-[#adadb8] hover:text-[#ff7070]"
                }`}
              >
                Unlisted
              </button>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {isLoadingList ? (
          <div className="p-8 text-center rounded-lg bg-[#18181b] border border-[#2d2d34] space-y-2">
            <Loader2 className="w-6 h-6 text-[#9146ff] animate-spin mx-auto" />
            <p className="text-xs text-[#767682]">Scanning unlisted broadcast archives…</p>
          </div>
        ) : filteredStreams.length === 0 ? (
          <div className="p-8 text-center rounded-lg bg-[#18181b] border border-[#2d2d34] space-y-1">
            <EyeOff className="w-6 h-6 text-[#767682] mx-auto mb-1" />
            <p className="text-xs font-semibold text-[#efeff1]">
              {searchQuery
                ? "No stream manifests match your search query."
                : filter === "unlisted"
                ? "No unlisted or privated broadcasts detected for this channel."
                : "No stream manifests currently indexed for this channel."}
            </p>
            <p className="text-[11px] text-[#767682]">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-[#9146ff] hover:underline font-semibold cursor-pointer"
                >
                  Clear search query
                </button>
              ) : (
                "You can manually enter any Stream ID or VOD ID above to probe CloudFront directly."
              )}
            </p>
          </div>
        ) : (
          /* Stream Cards Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredStreams.map((stream, idx) => (
              <div
                key={stream.id}
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                className="p-3.5 rounded-lg bg-[#18181b] border border-[#2d2d34] hover:border-[#3d3d46] transition-colors flex flex-col justify-between space-y-3 animate-fade-in-up"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {stream.isUnlisted ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#eb0400]/20 text-[#ff7070] border border-[#eb0400]/30 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          <span>UNLISTED / PRIVATED</span>
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#26262c] text-[#00f59b] border border-[#3d3d46] flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" />
                          <span>AVAILABLE</span>
                        </span>
                      )}

                      {isNotReady(stream.availability) && (
                        <span
                          title={AVAILABILITY_COPY[stream.availability].tip}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 uppercase ${
                            stream.availability === "processing"
                              ? "bg-amber-400/15 text-amber-300 border-amber-400/35"
                              : "bg-[#26262c] text-[#adadb8] border-[#3d3d46]"
                          }`}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>{AVAILABILITY_COPY[stream.availability].label}</span>
                        </span>
                      )}

                      {stream.watchStatus?.isWatched && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00f59b] text-black flex items-center gap-1 shadow-sm animate-badge-pop">
                          <Check className="w-2.5 h-2.5" />
                          <span>WATCHED</span>
                        </span>
                      )}
                    </div>

                    {stream.startTime && (
                      <span className="text-[11px] text-[#767682] tabular-nums flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>{formatRelativeDate(stream.startTime, dateFormat)}</span>
                      </span>
                    )}
                  </div>

                  <h4 className="text-xs font-semibold text-[#efeff1] leading-snug line-clamp-2">
                    {stream.title}
                  </h4>

                  <div className="flex items-center gap-2 text-[11px] text-[#767682] flex-wrap">
                    {stream.gameName && (
                      <span className="px-1.5 py-0.2 rounded bg-[#26262c] text-[#adadb8] text-[10px]">
                        {stream.gameName}
                      </span>
                    )}
                    {stream.durationSeconds > 0 && (
                      <span className="tabular-nums flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDuration(stream.durationSeconds)}</span>
                      </span>
                    )}
                    <span className="mono-font text-[10px] text-[#555560]">
                      ID: {stream.streamId}
                    </span>
                  </div>
                </div>

                {/* Stream Actions */}
                <div className="pt-2.5 border-t border-[#2d2d34] flex items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      // The playlist 404s until VODVOD has the data: explain instead of opening a dead player
                      if (isNotReady(stream.availability)) {
                        showToast(AVAILABILITY_COPY[stream.availability].toast, "info");
                        return;
                      }
                      onPlayStream(stream.proxiedUrl, stream.title, stream.streamId);
                    }}
                    aria-disabled={isNotReady(stream.availability)}
                    title={isNotReady(stream.availability) ? AVAILABILITY_COPY[stream.availability].tip : undefined}
                    className={`flex-1 py-1.5 px-2.5 bg-[#9146ff] hover:bg-[#772ce8] text-white font-semibold text-xs rounded-md flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer ${
                      isNotReady(stream.availability) ? "opacity-50" : ""
                    }`}
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Watch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleStreamWatch(stream)}
                    className={`p-1.5 rounded-md border transition-colors cursor-pointer active:scale-[0.98] inline-flex items-center justify-center ${
                      stream.watchStatus?.isWatched
                        ? "text-[#00f59b] bg-[#00f59b]/15 border-[#00f59b]/40 hover:bg-[#00f59b]/25"
                        : "text-[#767682] hover:text-[#efeff1] bg-[#26262c] hover:bg-[#32323a] border-[#2d2d34]"
                    }`}
                    title={stream.watchStatus?.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
                    aria-label={stream.watchStatus?.isWatched ? "Mark as Unwatched" : "Mark as Watched"}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  <a
                    href={stream.trackerUrl || getTwitchTrackerUrl(stream.streamerLogin || streamerLogin, stream)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#adadb8] hover:text-[#38bdf8] rounded-md border border-[#2d2d34] transition-colors cursor-pointer active:scale-[0.98] inline-flex items-center justify-center"
                    title="Open stream in TwitchTracker (stats & analytics)"
                    aria-label="Open in TwitchTracker"
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => handleCopy(stream.masterPlaylistUrl)}
                    className="p-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#adadb8] hover:text-[#efeff1] rounded-md border border-[#2d2d34] transition-colors cursor-pointer active:scale-[0.98]"
                    title="Copy direct .m3u8 link"
                    aria-label="Copy .m3u8 link"
                  >
                    {copiedUrl === stream.masterPlaylistUrl ? (
                      <Check className="w-3.5 h-3.5 text-[#00f59b]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={() => handleDownloadM3u8(stream.proxiedUrl, `${stream.streamId}.m3u8`)}
                    className="p-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#adadb8] hover:text-[#efeff1] rounded-md border border-[#2d2d34] transition-colors cursor-pointer active:scale-[0.98]"
                    title="Download playlist file (.m3u8)"
                    aria-label="Download playlist"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
