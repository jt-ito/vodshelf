"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  ListVideo,
  Play,
  X,
  Copy,
  Check,
  CheckCheck,
  Download,
  Trash2,
  FileText,
  FileSpreadsheet,
  GripVertical,
  Loader2,
} from "lucide-react";
import { TwitchVodItem } from "@/lib/twitch/gql";
import { formatDuration } from "./VodCard";
import { useToast } from "./Toast";
import { saveBulkWatch } from "@/lib/watch/client";
import { getVideoLink } from "@/lib/twitch/links";

export const getQueueItemLink = getVideoLink;

interface QueueDropdownProps {
  queue: TwitchVodItem[];
  onPlayQueueItem: (video: TwitchVodItem) => void;
  onRemoveFromQueue: (vodId: string) => void;
  onClearQueue: () => void;
  onReorderQueue?: (newQueue: TwitchVodItem[]) => void;
  currentPlayingVodId?: string | null;
  onMarkAllWatched?: () => Promise<void> | void;
}

function escapeCsvCell(val: string | number | undefined | null): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function QueueDropdown({
  queue,
  onPlayQueueItem,
  onRemoveFromQueue,
  onClearQueue,
  onReorderQueue,
  currentPlayingVodId,
  onMarkAllWatched,
}: QueueDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMarkingWatched, setIsMarkingWatched] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Drag-and-drop state for reordering
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("before");

  // Auto-scroll mechanism during drag-and-drop
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimRef = useRef<number | null>(null);
  const scrollSpeedRef = useRef<number>(0);

  const stopAutoScroll = () => {
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
    scrollSpeedRef.current = 0;
  };

  const startAutoScroll = (speed: number) => {
    scrollSpeedRef.current = speed;
    if (scrollAnimRef.current === null) {
      const step = () => {
        if (!listContainerRef.current || scrollSpeedRef.current === 0) {
          scrollAnimRef.current = null;
          return;
        }
        listContainerRef.current.scrollTop += scrollSpeedRef.current;
        scrollAnimRef.current = requestAnimationFrame(step);
      };
      scrollAnimRef.current = requestAnimationFrame(step);
    }
  };

  const checkAutoScroll = (clientY: number) => {
    if (!listContainerRef.current || !draggedId) return;
    const rect = listContainerRef.current.getBoundingClientRect();
    const threshold = 50;

    if (clientY > rect.bottom - threshold) {
      const dist = Math.max(1, clientY - (rect.bottom - threshold));
      const ratio = Math.min(2.5, dist / threshold);
      const speed = Math.max(3, Math.round(ratio * 12));
      startAutoScroll(speed);
    } else if (clientY < rect.top + threshold) {
      const dist = Math.max(1, (rect.top + threshold) - clientY);
      const ratio = Math.min(2.5, dist / threshold);
      const speed = Math.max(3, Math.round(ratio * 12));
      startAutoScroll(-speed);
    } else {
      stopAutoScroll();
    }
  };

  // Stop auto-scroll when drag ends anywhere on window
  useEffect(() => {
    const handleGlobalEnd = () => {
      stopAutoScroll();
    };
    window.addEventListener("dragend", handleGlobalEnd);
    window.addEventListener("drop", handleGlobalEnd);
    return () => {
      window.removeEventListener("dragend", handleGlobalEnd);
      window.removeEventListener("drop", handleGlobalEnd);
      stopAutoScroll();
    };
  }, []);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // If queue is emptied while open, close
  useEffect(() => {
    if (queue.length === 0 && isOpen) {
      setIsOpen(false);
    }
  }, [queue.length, isOpen]);

  const handleDropItem = (
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

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    if (!draggedId || !onReorderQueue) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    if (dragOverId && draggedId !== dragOverId) {
      handleDropItem(draggedId, dragOverId, dropPosition);
    } else if (queue.length > 0 && listContainerRef.current) {
      const rect = listContainerRef.current.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) {
        const last = queue[queue.length - 1];
        if (last && String(last.id) !== String(draggedId)) {
          handleDropItem(draggedId, String(last.id), "after");
        }
      } else {
        const first = queue[0];
        if (first && String(first.id) !== String(draggedId)) {
          handleDropItem(draggedId, String(first.id), "before");
        }
      }
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleCopyLinks = async () => {
    if (queue.length === 0) return;
    const links = queue.map((item) => getQueueItemLink(item));
    const text = links.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(`Copied ${queue.length} link${queue.length === 1 ? "" : "s"} to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy links:", err);
      showToast("Failed to copy links to clipboard");
    }
  };

  const handleDownloadTxt = () => {
    if (queue.length === 0) return;
    const links = queue.map((item) => getQueueItemLink(item));
    const text = links.join("\n");
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(text, `twitch_queue_${dateStr}.txt`, "text/plain");
    showToast("Downloaded queue links (.txt)");
  };

  const handleDownloadCsv = () => {
    if (queue.length === 0) return;
    const headers = ["Title", "Streamer", "Duration", "Link", "Date"];
    const rows = queue.map((item) => {
      const title = item.title || "";
      const streamer = item.owner?.displayName || item.owner?.login || "";
      const duration = formatDuration(item.lengthSeconds);
      const link = getQueueItemLink(item);
      const date = item.createdAt || item.publishedAt || "";
      return [title, streamer, duration, link, date].map(escapeCsvCell).join(",");
    });
    const csv = [headers.map(escapeCsvCell).join(","), ...rows].join("\r\n");
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(csv, `twitch_queue_${dateStr}.csv`, "text/csv");
    showToast("Downloaded queue data (.csv)");
  };

  const handleMarkAllWatched = async () => {
    if (queue.length === 0 || isMarkingWatched) return;

    setIsMarkingWatched(true);
    try {
      if (onMarkAllWatched) {
        await onMarkAllWatched();
      } else {
        const items = queue.map((v) => ({
          vodId: String(v.id),
          streamerLogin: v.owner?.login || "",
          totalSeconds: v.lengthSeconds || 0,
        }));
        const err = await saveBulkWatch(items);
        if (err) throw new Error(err);
        showToast(`Marked ${queue.length} queue item${queue.length === 1 ? "" : "s"} as watched`);
        if (typeof window !== "undefined") {
          const vodIds = queue.map((v) => String(v.id));
          window.dispatchEvent(
            new CustomEvent("twitch_vods_marked_watched", { detail: { vodIds } })
          );
        }
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to mark all as watched", "error");
    } finally {
      setIsMarkingWatched(false);
    }
  };

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Queue Button next to Keyboard Shortcuts */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`relative p-1.5 rounded transition-all cursor-pointer flex items-center gap-1 ${
          isOpen
            ? "bg-[#26262c] text-[#9146ff]"
            : "text-[#adadb8] hover:text-[#efeff1] hover:bg-[#26262c]"
        }`}
        title={`Playback Queue (${queue.length} item${queue.length === 1 ? "" : "s"})`}
        aria-label="Playback queue"
        aria-expanded={isOpen}
      >
        <ListVideo className="w-4 h-4" />
        <span className="bg-[#9146ff] text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center -ml-0.5 leading-none shadow-sm">
          {queue.length}
        </span>
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#18181b] border border-[#26262c] rounded-xl shadow-2xl z-50 overflow-hidden animate-dropdown flex flex-col text-[#efeff1]"
          style={{ maxHeight: "calc(100vh - 80px)" }}
        >
          {/* Header */}
          <div className="p-3 border-b border-[#26262c] flex items-center justify-between bg-[#1f1f23]">
            <div className="flex items-center gap-2 min-w-0">
              <ListVideo className="w-4 h-4 text-[#9146ff] flex-shrink-0" />
              <h3 className="text-xs font-bold text-white tracking-wide truncate">
                Playback Queue
              </h3>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-[#26262c] text-[#adadb8] rounded-full">
                {queue.length}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  onClearQueue();
                  setIsOpen(false);
                }}
                className="px-2 py-1 text-[11px] text-[#adadb8] hover:text-[#ff7070] hover:bg-[#eb0400]/10 rounded transition-colors flex items-center gap-1 cursor-pointer"
                title="Clear all queue items"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-[#adadb8] hover:text-[#efeff1] hover:bg-[#26262c] rounded transition-colors cursor-pointer"
                title="Close queue"
                aria-label="Close queue"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action Toolbar: Mark Watched, Copy links & Export Options */}
          <div className="px-3 py-2 border-b border-[#26262c] bg-[#141417] flex items-center justify-between gap-1.5 text-[11px] flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-[170px]">
              <button
                type="button"
                onClick={handleMarkAllWatched}
                disabled={isMarkingWatched}
                className="py-1 px-2 bg-[#1f1f23] hover:bg-[#00f59b]/15 text-[#adadb8] hover:text-[#00f59b] border border-[#2d2d34] hover:border-[#00f59b]/40 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50"
                title="Mark all items in playback queue as watched"
              >
                {isMarkingWatched ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#00f59b]" />
                ) : (
                  <CheckCheck className="w-3 h-3 text-[#00f59b]" />
                )}
                <span>Mark Watched</span>
              </button>

              <button
                type="button"
                onClick={handleCopyLinks}
                className={`py-1 px-2 rounded flex items-center justify-center gap-1 font-medium transition-colors cursor-pointer border active:scale-[0.98] ${
                  copied
                    ? "bg-[#00f59b]/15 border-[#00f59b]/30 text-[#00f59b]"
                    : "bg-[#1f1f23] hover:bg-[#26262c] border-[#2d2d34] text-[#efeff1]"
                }`}
                title="Copy all links to clipboard"
              >
                {copied ? <Check className="w-3 h-3 text-[#00f59b]" /> : <Copy className="w-3 h-3 text-[#adadb8]" />}
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleDownloadTxt}
                className="py-1 px-2 bg-[#1f1f23] hover:bg-[#26262c] border border-[#2d2d34] hover:border-[#9146ff]/40 text-[#efeff1] rounded flex items-center gap-1 font-medium transition-colors cursor-pointer active:scale-[0.98]"
                title="Download queue as text file (.txt with links only)"
              >
                <FileText className="w-3 h-3 text-[#adadb8]" />
                <span>.txt</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="py-1 px-2 bg-[#1f1f23] hover:bg-[#26262c] border border-[#2d2d34] hover:border-[#9146ff]/40 text-[#efeff1] rounded flex items-center gap-1 font-medium transition-colors cursor-pointer active:scale-[0.98]"
                title="Download queue as spreadsheet (.csv with title, streamer, duration, link)"
              >
                <FileSpreadsheet className="w-3 h-3 text-[#adadb8]" />
                <span>.csv</span>
              </button>
            </div>
          </div>

          {/* Items List (with Drag and Drop Reordering) */}
          <div
            ref={listContainerRef}
            onDragOver={(e) => {
              e.preventDefault();
              checkAutoScroll(e.clientY);
            }}
            onDrop={handleContainerDrop}
            className="p-2 overflow-y-auto space-y-1.5 max-h-80 min-h-0 flex-1"
          >
            {queue.map((item, idx) => {
              const isCurrent =
                currentPlayingVodId &&
                (String(item.id) === String(currentPlayingVodId) ||
                  ((item as any).streamId && String((item as any).streamId) === String(currentPlayingVodId)));

              const isBeingDragged = draggedId === String(item.id);
              const isDropTarget = dragOverId === String(item.id) && !isBeingDragged;

              return (
                <div
                  key={item.id}
                  draggable={Boolean(onReorderQueue)}
                  onDragStart={(e) => {
                    stopAutoScroll();
                    setDraggedId(String(item.id));
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(item.id));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    checkAutoScroll(e.clientY);
                    if (draggedId && draggedId !== String(item.id)) {
                      setDragOverId(String(item.id));
                      const rect = e.currentTarget.getBoundingClientRect();
                      const mid = rect.top + rect.height / 2;
                      setDropPosition(e.clientY < mid ? "before" : "after");
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverId === String(item.id)) {
                        setDragOverId(null);
                      }
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stopAutoScroll();
                    if (draggedId && draggedId !== String(item.id)) {
                      handleDropItem(draggedId, String(item.id), dropPosition);
                    }
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onDragEnd={() => {
                    stopAutoScroll();
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onClick={() => {
                    if (draggedId) return;
                    onPlayQueueItem(item);
                    setIsOpen(false);
                  }}
                  className={`group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all select-none border ${
                    isBeingDragged
                      ? "opacity-30 bg-[#26262c]/50 border-2 border-dashed border-[#9146ff] scale-[0.99]"
                      : isDropTarget
                      ? dropPosition === "before"
                        ? "bg-[#9146ff]/15 border-t-2 border-t-[#9146ff] border-x border-b border-transparent shadow-md"
                        : "bg-[#9146ff]/15 border-b-2 border-b-[#9146ff] border-x border-t border-transparent shadow-md"
                      : isCurrent
                      ? "bg-[#9146ff]/15 border-[#9146ff]/40 text-white"
                      : "bg-[#18181b] hover:bg-[#222227] border-transparent hover:border-[#383842] text-[#efeff1]"
                  }`}
                  title={`Click to play: ${item.title}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Drag Handle */}
                    {onReorderQueue && (
                      <div
                        className="p-1 -ml-1 text-[#767682] hover:text-[#bf94ff] active:text-[#9146ff] cursor-grab active:cursor-grabbing rounded hover:bg-[#26262c] transition-colors flex-shrink-0"
                        title="Drag and drop to reorder"
                        aria-label="Drag and drop to reorder"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                    )}

                    {/* Index or Thumbnail Preview */}
                    <div className="relative w-12 h-7 bg-[#26262c] rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {item.previewThumbnailURL ? (
                        <img
                          src={item.previewThumbnailURL
                            .replace("%{width}", "160")
                            .replace("%{height}", "90")}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-3 h-3 text-white fill-white" />
                      </div>
                      <span className="absolute bottom-0.5 left-1 text-[8px] font-mono font-bold text-white/80 bg-black/60 px-0.5 rounded pointer-events-none">
                        #{idx + 1}
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-xs font-medium truncate text-[#efeff1] group-hover:text-white">
                          {item.title}
                        </p>
                        {isCurrent && (
                          <span className="px-1 py-0.2 text-[8px] font-extrabold uppercase tracking-wider bg-[#9146ff] text-white rounded flex-shrink-0">
                            Playing
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-[#767682] mt-0.5">
                        <span className="truncate max-w-[100px]">
                          {item.owner?.displayName || item.owner?.login || "Twitch"}
                        </span>
                        <span>•</span>
                        <span>{formatDuration(item.lengthSeconds)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Remove Item Button on Hover */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromQueue(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#767682] hover:text-[#ff7070] hover:bg-[#eb0400]/15 rounded transition-all ml-1 flex-shrink-0 cursor-pointer"
                    title="Remove from queue"
                    aria-label={`Remove ${item.title} from queue`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer Quick Action */}
          <div className="p-2 border-t border-[#26262c] bg-[#141417]">
            <button
              type="button"
              onClick={() => {
                onPlayQueueItem(queue[0]);
                setIsOpen(false);
              }}
              className="w-full py-1.5 px-3 bg-[#9146ff] hover:bg-[#772ce8] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm active:scale-[0.99]"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Start Queue from Beginning</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
