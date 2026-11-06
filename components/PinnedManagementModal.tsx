"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  X,
  Search,
  Eye,
  EyeOff,
  FolderPlus,
  Folder,
  Trash2,
  Edit2,
  Check,
  Filter,
  ArrowUpDown,
  Layers,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import { PinnedStreamer } from "./Sidebar";

interface PinnedManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamers: PinnedStreamer[];
  onUpdateStreamer: (
    login: string,
    updates: { groupName?: string; isHidden?: boolean; sortOrder?: number }
  ) => Promise<void>;
  onReorderStreamers?: (reorderedStreamers: PinnedStreamer[]) => Promise<void>;
  onRenameGroup: (oldGroup: string, newGroup: string) => Promise<void>;
  onDeleteGroup: (groupName: string) => Promise<void>;
  onUnpinStreamer: (login: string) => void;
}

export default function PinnedManagementModal({
  isOpen,
  onClose,
  streamers,
  onUpdateStreamer,
  onReorderStreamers,
  onRenameGroup,
  onDeleteGroup,
  onUnpinStreamer,
}: PinnedManagementModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"custom" | "name" | "date" | "group">("custom");
  const [newGroupName, setNewGroupName] = useState("");
  const [quickNewGroup, setQuickNewGroup] = useState("");
  const [showQuickNewGroup, setShowQuickNewGroup] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renamedGroupName, setRenamedGroupName] = useState("");
  const [activeTab, setActiveTab] = useState<"creators" | "groups">("creators");
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);

  // Drag-and-drop state for reordering
  const [draggedLogin, setDraggedLogin] = useState<string | null>(null);
  const [dragOverLogin, setDragOverLogin] = useState<string | null>(null);
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
    if (!listContainerRef.current || !draggedLogin) return;
    const rect = listContainerRef.current.getBoundingClientRect();
    const threshold = 85; // Proximity threshold in pixels from top/bottom boundary

    if (clientY > rect.bottom - threshold) {
      // Near bottom edge or dragged below container: scroll down smoothly
      const dist = Math.max(1, clientY - (rect.bottom - threshold));
      const ratio = Math.min(2.5, dist / threshold);
      const speed = Math.max(4, Math.round(ratio * 16));
      startAutoScroll(speed);
    } else if (clientY < rect.top + threshold) {
      // Near top edge or dragged above container: scroll up smoothly
      const dist = Math.max(1, (rect.top + threshold) - clientY);
      const ratio = Math.min(2.5, dist / threshold);
      const speed = Math.max(4, Math.round(ratio * 16));
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

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    if (!draggedLogin || !onReorderStreamers) {
      setDraggedLogin(null);
      setDragOverLogin(null);
      return;
    }

    if (dragOverLogin && draggedLogin.toLowerCase() !== dragOverLogin.toLowerCase()) {
      handleDropStreamer(draggedLogin, dragOverLogin, dropPosition);
    } else if (filteredStreamers.length > 0 && listContainerRef.current) {
      const rect = listContainerRef.current.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) {
        const last = filteredStreamers[filteredStreamers.length - 1];
        if (last && last.login.toLowerCase() !== draggedLogin.toLowerCase()) {
          handleDropStreamer(draggedLogin, last.login, "after");
        }
      } else {
        const first = filteredStreamers[0];
        if (first && first.login.toLowerCase() !== draggedLogin.toLowerCase()) {
          handleDropStreamer(draggedLogin, first.login, "before");
        }
      }
    }

    setDraggedLogin(null);
    setDragOverLogin(null);
  };

  // Maintain custom groups including empty ones created by user
  const [customGroups, setCustomGroups] = useState<string[]>([]);

  // Load persisted custom groups from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("twitch_pinned_custom_groups");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCustomGroups(parsed);
        }
      }
    } catch {}
  }, []);

  // Save custom groups whenever updated
  const persistCustomGroups = (groups: string[]) => {
    setCustomGroups(groups);
    try {
      localStorage.setItem("twitch_pinned_custom_groups", JSON.stringify(groups));
    } catch {}
  };

  // Derive unique groups list from customGroups + streamers + default General
  const existingGroups = useMemo(() => {
    const groupSet = new Set<string>(["General"]);
    customGroups.forEach((g) => {
      if (g && g.trim()) groupSet.add(g.trim());
    });
    streamers.forEach((s) => {
      if (s.groupName && s.groupName.trim()) {
        groupSet.add(s.groupName.trim());
      }
    });
    return Array.from(groupSet);
  }, [streamers, customGroups]);

  // Filtered and sorted streamers
  const filteredStreamers = useMemo(() => {
    let list = streamers.filter((s) => {
      const matchesSearch =
        s.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.login.toLowerCase().includes(searchQuery.toLowerCase());
      const currentGroup = s.groupName || "General";
      const matchesGroup =
        selectedGroupFilter === "ALL" || currentGroup === selectedGroupFilter;
      return matchesSearch && matchesGroup;
    });

    if (sortBy === "name") {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sortBy === "date") {
      list.sort(
        (a, b) =>
          new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
      );
    } else if (sortBy === "group") {
      list.sort((a, b) =>
        (a.groupName || "General").localeCompare(b.groupName || "General")
      );
    }
    // If sortBy === "custom", items maintain their natural sort_order
    return list;
  }, [streamers, searchQuery, selectedGroupFilter, sortBy]);

  const hiddenCount = useMemo(
    () => streamers.filter((s) => s.isHidden).length,
    [streamers]
  );

  if (!isOpen) return null;

  const handleCreateGroup = (nameToCreate: string) => {
    const trimmed = nameToCreate.trim();
    if (!trimmed) return;

    if (existingGroups.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      setGroupFeedback(`Group "${trimmed}" already exists.`);
      setTimeout(() => setGroupFeedback(null), 3500);
      return;
    }

    const updated = Array.from(new Set([...customGroups, trimmed]));
    persistCustomGroups(updated);
    setNewGroupName("");
    setQuickNewGroup("");
    setShowQuickNewGroup(false);
    setGroupFeedback(`Group "${trimmed}" created! You can now assign creators to it.`);
    setTimeout(() => setGroupFeedback(null), 4000);
  };

  const handleExecuteRenameGroup = async (oldName: string) => {
    const trimmed = renamedGroupName.trim();
    if (trimmed && trimmed !== oldName) {
      await onRenameGroup(oldName, trimmed);
      const updated = customGroups.map((g) => (g === oldName ? trimmed : g));
      persistCustomGroups(updated);
      if (selectedGroupFilter === oldName) {
        setSelectedGroupFilter(trimmed);
      }
    }
    setRenamingGroup(null);
    setRenamedGroupName("");
  };

  const handleDeleteGroupInternal = async (group: string) => {
    await onDeleteGroup(group);
    const updated = customGroups.filter((g) => g !== group);
    persistCustomGroups(updated);
    if (selectedGroupFilter === group) {
      setSelectedGroupFilter("ALL");
    }
  };

  // Reorder channel up/down/top/bottom and persist to sidebar
  const handleMoveStreamer = async (
    streamerLogin: string,
    direction: "up" | "down"
  ) => {
    if (!onReorderStreamers) return;

    const currentFiltered = [...filteredStreamers];
    const filteredIndex = currentFiltered.findIndex(
      (s) => s.login.toLowerCase() === streamerLogin.toLowerCase()
    );
    if (filteredIndex === -1) return;

    // Clone global streamers
    const globalList = [...streamers];
    const globalIndex = globalList.findIndex(
      (s) => s.login.toLowerCase() === streamerLogin.toLowerCase()
    );
    if (globalIndex === -1) return;

    let newGlobalList: PinnedStreamer[] = [];

    if (direction === "up" && filteredIndex > 0) {
      const prevStreamer = currentFiltered[filteredIndex - 1];
      const targetGlobalIdx = globalList.findIndex(
        (s) => s.login.toLowerCase() === prevStreamer.login.toLowerCase()
      );
      if (targetGlobalIdx !== -1) {
        const [item] = globalList.splice(globalIndex, 1);
        globalList.splice(targetGlobalIdx, 0, item);
        newGlobalList = globalList;
      }
    } else if (direction === "down" && filteredIndex < currentFiltered.length - 1) {
      const nextStreamer = currentFiltered[filteredIndex + 1];
      const targetGlobalIdx = globalList.findIndex(
        (s) => s.login.toLowerCase() === nextStreamer.login.toLowerCase()
      );
      if (targetGlobalIdx !== -1) {
        const [item] = globalList.splice(globalIndex, 1);
        globalList.splice(targetGlobalIdx, 0, item);
        newGlobalList = globalList;
      }
    }

    if (newGlobalList.length > 0) {
      if (sortBy !== "custom") {
        setSortBy("custom");
      }
      const reindexed = newGlobalList.map((s, idx) => ({
        ...s,
        sortOrder: idx,
      }));
      await onReorderStreamers(reindexed);
      setGroupFeedback("Sidebar order updated!");
      setTimeout(() => setGroupFeedback(null), 2500);
    }
  };

  // 1-Click apply current sort (A-Z or Date) as permanent custom order
  const handleApplySortToSidebar = async () => {
    if (!onReorderStreamers) return;
    let sortedList = [...streamers];
    if (sortBy === "name") {
      sortedList.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sortBy === "date") {
      sortedList.sort(
        (a, b) =>
          new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
      );
    } else if (sortBy === "group") {
      sortedList.sort((a, b) =>
        (a.groupName || "General").localeCompare(b.groupName || "General")
      );
    }
    const reindexed = sortedList.map((s, idx) => ({
      ...s,
      sortOrder: idx,
    }));
    setSortBy("custom");
    await onReorderStreamers(reindexed);
    setGroupFeedback("Sidebar order saved!");
    setTimeout(() => setGroupFeedback(null), 3000);
  };

  // Drag-and-drop reorder handler
  const handleDropStreamer = async (
    sourceLogin: string,
    targetLogin: string,
    position: "before" | "after"
  ) => {
    if (!onReorderStreamers || sourceLogin.toLowerCase() === targetLogin.toLowerCase()) return;

    const globalList = [...streamers];
    const sourceIdx = globalList.findIndex(
      (s) => s.login.toLowerCase() === sourceLogin.toLowerCase()
    );
    if (sourceIdx === -1) return;

    const [draggedItem] = globalList.splice(sourceIdx, 1);
    const targetIdx = globalList.findIndex(
      (s) => s.login.toLowerCase() === targetLogin.toLowerCase()
    );
    if (targetIdx === -1) return;

    const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
    globalList.splice(insertIdx, 0, draggedItem);

    if (sortBy !== "custom") {
      setSortBy("custom");
    }

    const reindexed = globalList.map((s, idx) => ({
      ...s,
      sortOrder: idx,
    }));

    await onReorderStreamers(reindexed);
    setGroupFeedback("Sidebar order updated!");
    setTimeout(() => setGroupFeedback(null), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 animate-fade-in-up"
      onDragOver={(e) => {
        if (draggedLogin) {
          e.preventDefault();
          checkAutoScroll(e.clientY);
        }
      }}
    >
      <div
        onDragOver={(e) => {
          if (draggedLogin) {
            e.preventDefault();
            checkAutoScroll(e.clientY);
          }
        }}
        className="relative w-full max-w-3xl bg-[#18181b] rounded-xl border border-[#2d2d34] shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-[#2d2d34] bg-[#1f1f23]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#9146ff]/20 text-[#bf94ff] border border-[#9146ff]/30 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#efeff1]">
                Manage Pinned Creators
              </h2>
              <div className="flex items-center gap-3 text-xs text-[#adadb8] mt-0.5">
                <span>{streamers.length} Creators</span>
                <span>•</span>
                <span>{existingGroups.length} Groups</span>
                {hiddenCount > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-[#e0a020]">
                      {hiddenCount} Hidden
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#767682] hover:text-[#efeff1] rounded-lg hover:bg-[#26262c] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-3 border-b border-[#2d2d34] bg-[#18181b] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("creators")}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === "creators"
                  ? "border-[#9146ff] text-[#efeff1]"
                  : "border-transparent text-[#767682] hover:text-[#efeff1]"
              }`}
            >
              Creators List ({streamers.length})
            </button>
            <button
              onClick={() => setActiveTab("groups")}
              className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === "groups"
                  ? "border-[#9146ff] text-[#efeff1]"
                  : "border-transparent text-[#767682] hover:text-[#efeff1]"
              }`}
            >
              Manage Groups ({existingGroups.length})
            </button>
          </div>

          {/* Quick feedback indicator */}
          {groupFeedback && (
            <div className="pb-2 text-[11px] text-[#00f59b] font-medium flex items-center gap-1.5 animate-fade-in-up">
              <Check className="w-3.5 h-3.5" />
              <span>{groupFeedback}</span>
            </div>
          )}
        </div>

        {activeTab === "creators" ? (
          <>
            {/* Toolbar */}
            <div className="p-3.5 border-b border-[#2d2d34] bg-[#18181b]/60 flex flex-wrap items-center justify-between gap-2.5">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#767682]" />
                <input
                  type="text"
                  placeholder="Filter creators..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-[#0e0e10] border border-[#2d2d34] focus:border-[#9146ff] rounded-lg text-xs text-[#efeff1] placeholder-[#767682] outline-none transition-colors"
                />
              </div>

              {/* Group Filter Selector */}
              <div className="flex items-center gap-1.5 text-xs text-[#adadb8]">
                <Filter className="w-3.5 h-3.5 text-[#767682]" />
                <select
                  value={selectedGroupFilter}
                  onChange={(e) => setSelectedGroupFilter(e.target.value)}
                  aria-label="Filter creators by group"
                  className="bg-[#0e0e10] border border-[#2d2d34] rounded-lg px-2.5 py-1.5 text-xs text-[#efeff1] outline-none focus:border-[#9146ff]"
                >
                  <option value="ALL">All Groups ({streamers.length})</option>
                  {existingGroups.map((grp) => {
                    const count = streamers.filter(
                      (s) => (s.groupName || "General") === grp
                    ).length;
                    return (
                      <option key={grp} value={grp}>
                        {grp} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Sort selector */}
              <div className="flex items-center gap-1.5 text-xs text-[#adadb8]">
                <ArrowUpDown className="w-3.5 h-3.5 text-[#767682]" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  aria-label="Sort creators by"
                  className="bg-[#0e0e10] border border-[#2d2d34] rounded-lg px-2.5 py-1.5 text-xs text-[#efeff1] outline-none focus:border-[#9146ff]"
                >
                  <option value="custom">Custom (Sidebar Order)</option>
                  <option value="name">Name (A - Z)</option>
                  <option value="date">Date Pinned</option>
                  <option value="group">By Group</option>
                </select>
                {sortBy !== "custom" && onReorderStreamers && (
                  <button
                    onClick={handleApplySortToSidebar}
                    className="px-2 py-1 bg-[#9146ff]/20 hover:bg-[#9146ff] text-[#bf94ff] hover:text-white border border-[#9146ff]/40 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap"
                    title="Lock in this sort as your permanent sidebar order"
                  >
                    Apply to Sidebar
                  </button>
                )}
                {onReorderStreamers && (
                  <span className="hidden md:inline-flex text-[11px] text-[#767682] ml-1">
                    (Drag rows or use arrows)
                  </span>
                )}
              </div>

              {/* Quick Add Group Button */}
              <div>
                {showQuickNewGroup ? (
                  <div className="flex items-center gap-1.5 animate-scale-in">
                    <input
                      type="text"
                      placeholder="New group name..."
                      value={quickNewGroup}
                      maxLength={30}
                      onChange={(e) => setQuickNewGroup(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleCreateGroup(quickNewGroup)
                      }
                      autoFocus
                      className="px-2.5 py-1 bg-[#0e0e10] border border-[#9146ff] rounded-lg text-xs text-[#efeff1] outline-none w-36"
                    />
                    <button
                      onClick={() => handleCreateGroup(quickNewGroup)}
                      className="p-1.5 bg-[#9146ff] hover:bg-[#772ce8] text-white rounded-lg cursor-pointer"
                      title="Save group"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setShowQuickNewGroup(false);
                        setQuickNewGroup("");
                      }}
                      className="p-1.5 text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c] rounded-lg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowQuickNewGroup(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    title="Create a new group"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-[#bf94ff]" />
                    <span>+ Group</span>
                  </button>
                )}
              </div>
            </div>

            {/* Active Filter Indicator Bar */}
            {(selectedGroupFilter !== "ALL" || searchQuery.trim() !== "") && (
              <div className="flex items-center justify-between px-4 py-2 bg-[#9146ff]/10 border-b border-[#9146ff]/20 text-xs text-[#efeff1]">
                <div className="flex items-center gap-2">
                  <span className="text-[#adadb8]">Active filter:</span>
                  {selectedGroupFilter !== "ALL" && (
                    <span className="bg-[#9146ff]/30 text-[#bf94ff] px-2 py-0.5 rounded font-medium flex items-center gap-1">
                      Group: {selectedGroupFilter}
                    </span>
                  )}
                  {searchQuery && (
                    <span className="bg-[#26262c] text-[#efeff1] px-2 py-0.5 rounded font-medium">
                      Search: &quot;{searchQuery}&quot;
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedGroupFilter("ALL");
                    setSearchQuery("");
                  }}
                  className="text-[#bf94ff] hover:text-white font-semibold cursor-pointer underline text-[11px]"
                >
                  Clear Filters (Show All {streamers.length})
                </button>
              </div>
            )}

            {/* Streamers List */}
            <div
              ref={listContainerRef}
              onDragOver={(e) => {
                e.preventDefault();
                checkAutoScroll(e.clientY);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  stopAutoScroll();
                }
              }}
              onDrop={handleContainerDrop}
              className="flex-1 overflow-y-auto divide-y divide-[#2d2d34]/60 p-2 scroll-auto"
            >
              {filteredStreamers.length === 0 ? (
                <div className="py-12 text-center text-[#767682] text-xs space-y-3">
                  <p className="text-sm font-medium text-[#adadb8]">
                    {selectedGroupFilter !== "ALL"
                      ? `No creators are currently in group "${selectedGroupFilter}".`
                      : "No creators found matching your search."}
                  </p>
                  {(selectedGroupFilter !== "ALL" || searchQuery) && (
                    <button
                      onClick={() => {
                        setSelectedGroupFilter("ALL");
                        setSearchQuery("");
                      }}
                      className="px-3.5 py-1.5 bg-[#9146ff] hover:bg-[#772ce8] text-white font-semibold rounded-md transition-colors cursor-pointer text-xs"
                    >
                      Show All Creators ({streamers.length})
                    </button>
                  )}
                </div>
              ) : (
                filteredStreamers.map((streamer, index) => {
                  const currentGroup = streamer.groupName || "General";
                  const isFirst = index === 0;
                  const isLast = index === filteredStreamers.length - 1;
                  const isBeingDragged = draggedLogin?.toLowerCase() === streamer.login.toLowerCase();
                  const isDropTarget = dragOverLogin?.toLowerCase() === streamer.login.toLowerCase() && !isBeingDragged;

                  return (
                    <div
                      key={streamer.login}
                      draggable={Boolean(onReorderStreamers)}
                      onDragStart={(e) => {
                        stopAutoScroll();
                        setDraggedLogin(streamer.login);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", streamer.login);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        checkAutoScroll(e.clientY);
                        if (draggedLogin && draggedLogin.toLowerCase() !== streamer.login.toLowerCase()) {
                          setDragOverLogin(streamer.login);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const mid = rect.top + rect.height / 2;
                          setDropPosition(e.clientY < mid ? "before" : "after");
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          if (dragOverLogin?.toLowerCase() === streamer.login.toLowerCase()) {
                            setDragOverLogin(null);
                          }
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        stopAutoScroll();
                        if (draggedLogin && draggedLogin.toLowerCase() !== streamer.login.toLowerCase()) {
                          handleDropStreamer(draggedLogin, streamer.login, dropPosition);
                        }
                        setDraggedLogin(null);
                        setDragOverLogin(null);
                      }}
                      onDragEnd={() => {
                        stopAutoScroll();
                        setDraggedLogin(null);
                        setDragOverLogin(null);
                      }}
                      className={`relative flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg gap-2.5 sm:gap-3 transition-all select-none ${
                        isBeingDragged
                          ? "opacity-30 bg-[#26262c]/50 border-2 border-dashed border-[#9146ff] scale-[0.99]"
                          : isDropTarget
                          ? dropPosition === "before"
                            ? "bg-[#9146ff]/15 border-t-2 border-t-[#9146ff] border-x border-b border-transparent shadow-md"
                            : "bg-[#9146ff]/15 border-b-2 border-b-[#9146ff] border-x border-t border-transparent shadow-md"
                          : streamer.isHidden
                          ? "opacity-60 bg-[#0e0e10]/40 hover:bg-[#1f1f23]/60 border border-transparent"
                          : "hover:bg-[#1f1f23]/60 border border-transparent"
                      }`}
                    >
                      {/* Left: Drag Handle + Reorder Buttons + Position Badge + Avatar + Names */}
                      <div className="flex items-center gap-2 min-w-0 flex-1 sm:mr-4">
                        {/* Drag Handle */}
                        {onReorderStreamers && (
                          <div
                            className="p-1 -ml-1 text-[#767682] hover:text-[#bf94ff] active:text-[#9146ff] cursor-grab active:cursor-grabbing rounded hover:bg-[#26262c] transition-colors flex-shrink-0"
                            title="Drag and drop to reorder channel"
                            aria-label="Drag and drop to reorder"
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>
                        )}

                        {/* Move Up / Down Buttons */}
                        {onReorderStreamers && (
                          <div className="flex flex-col gap-0.5 flex-shrink-0">
                            <button
                              onClick={() => handleMoveStreamer(streamer.login, "up")}
                              disabled={isFirst}
                              className={`p-0.5 rounded transition-colors ${
                                isFirst
                                  ? "text-[#3d3d46] cursor-not-allowed"
                                  : "text-[#767682] hover:text-[#9146ff] hover:bg-[#26262c] cursor-pointer"
                              }`}
                              title={isFirst ? "Already at top" : "Move up in sidebar"}
                              aria-label={`Move ${streamer.displayName} up`}
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMoveStreamer(streamer.login, "down")}
                              disabled={isLast}
                              className={`p-0.5 rounded transition-colors ${
                                isLast
                                  ? "text-[#3d3d46] cursor-not-allowed"
                                  : "text-[#767682] hover:text-[#9146ff] hover:bg-[#26262c] cursor-pointer"
                              }`}
                              title={isLast ? "Already at bottom" : "Move down in sidebar"}
                              aria-label={`Move ${streamer.displayName} down`}
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Rank Position Badge */}
                        <span
                          className="w-6 h-6 rounded bg-[#26262c] text-[#adadb8] text-[10px] font-mono font-bold flex items-center justify-center border border-[#3d3d46]/50 select-none flex-shrink-0"
                          title={`Sidebar position #${index + 1}`}
                        >
                          #{index + 1}
                        </span>

                        {/* Avatar */}
                        {streamer.avatarUrl ? (
                          <img
                            src={streamer.avatarUrl}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover border border-[#2d2d34] flex-shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#9146ff]/20 text-[#bf94ff] border border-[#9146ff]/30 flex items-center justify-center font-bold text-xs flex-shrink-0">
                            {streamer.displayName.charAt(0)}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#efeff1] truncate">
                              {streamer.displayName}
                            </span>
                            {streamer.isHidden && (
                              <span className="text-[10px] bg-[#2d2d34] text-[#adadb8] px-1.5 py-0.5 rounded font-mono">
                                Hidden
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#767682] truncate">
                            @{streamer.login}
                          </div>
                        </div>
                      </div>

                      {/* Right: Group Assignment + Visibility + Unpin */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap justify-between sm:justify-end flex-shrink-0 pt-1.5 sm:pt-0 border-t border-[#2d2d34]/40 sm:border-t-0">
                        {/* Group selector */}
                        <div className="flex items-center gap-1.5">
                          <Folder className="w-3.5 h-3.5 text-[#767682]" />
                          <select
                            value={currentGroup}
                            onChange={(e) =>
                              onUpdateStreamer(streamer.login, {
                                groupName: e.target.value,
                              })
                            }
                            aria-label={`Group for ${streamer.displayName}`}
                            className="bg-[#0e0e10] border border-[#2d2d34] hover:border-[#9146ff] rounded-md px-2.5 py-1 text-xs text-[#efeff1] outline-none transition-colors"
                          >
                            {existingGroups.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Visibility Toggle */}
                        <button
                          onClick={() =>
                            onUpdateStreamer(streamer.login, {
                              isHidden: !streamer.isHidden,
                            })
                          }
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                            streamer.isHidden
                              ? "bg-[#2d2d34]/40 border-[#3d3d46] text-[#adadb8] hover:text-[#efeff1]"
                              : "bg-[#00f59b]/10 border-[#00f59b]/30 text-[#00f59b] hover:bg-[#00f59b]/20"
                          }`}
                          title={
                            streamer.isHidden
                              ? "Show on sidebar and feed"
                              : "Hide from sidebar and feed"
                          }
                        >
                          {streamer.isHidden ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Hidden</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Visible</span>
                            </>
                          )}
                        </button>

                        {/* Unpin button */}
                        <button
                          onClick={() => onUnpinStreamer(streamer.login)}
                          className="p-1.5 text-[#767682] hover:text-[#eb0400] hover:bg-[#eb0400]/10 rounded-md transition-colors cursor-pointer"
                          title="Unpin creator"
                          aria-label={`Unpin ${streamer.displayName}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* Manage Groups Tab */
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Create new group */}
            <div className="p-4 bg-[#1f1f23] rounded-xl border border-[#2d2d34]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#adadb8] mb-3 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[#9146ff]" />
                Create New Group
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Group name (e.g. Speedrunners, IRL, Tournament)..."
                  value={newGroupName}
                  maxLength={30}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup(newGroupName)}
                  className="flex-1 px-3 py-2 bg-[#0e0e10] border border-[#2d2d34] focus:border-[#9146ff] rounded-lg text-xs text-[#efeff1] placeholder-[#767682] outline-none transition-colors"
                />
                <button
                  onClick={() => handleCreateGroup(newGroupName)}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-2 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Add Group
                </button>
              </div>
            </div>

            {/* List of Existing Groups */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#adadb8] mb-3">
                Existing Groups ({existingGroups.length})
              </h3>

              <div className="divide-y divide-[#2d2d34] border border-[#2d2d34] rounded-xl overflow-hidden bg-[#18181b]">
                {existingGroups.map((group) => {
                  const memberCount = streamers.filter(
                    (s) => (s.groupName || "General") === group
                  ).length;
                  const isRenaming = renamingGroup === group;

                  return (
                    <div
                      key={group}
                      className="flex items-center justify-between p-3.5 hover:bg-[#1f1f23]/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Folder className="w-4 h-4 text-[#9146ff] flex-shrink-0" />
                        {isRenaming ? (
                          <div className="flex items-center gap-2 flex-1 max-w-sm">
                            <input
                              type="text"
                              value={renamedGroupName}
                              onChange={(e) =>
                                setRenamedGroupName(e.target.value)
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                handleExecuteRenameGroup(group)
                              }
                              autoFocus
                              className="w-full px-2.5 py-1 bg-[#0e0e10] border border-[#9146ff] rounded text-xs text-[#efeff1] outline-none"
                            />
                            <button
                              onClick={() => handleExecuteRenameGroup(group)}
                              className="p-1 text-[#00f59b] hover:bg-[#00f59b]/20 rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setRenamingGroup(null)}
                              className="p-1 text-[#767682] hover:bg-[#26262c] rounded cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#efeff1]">
                              {group}
                            </span>
                            <span className="text-[11px] text-[#767682]">
                              ({memberCount}{" "}
                              {memberCount === 1 ? "creator" : "creators"})
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Group Action Buttons */}
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => {
                            setSelectedGroupFilter("ALL");
                            setActiveTab("creators");
                          }}
                          className="text-[11px] text-[#9146ff] hover:text-[#bf94ff] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>Assign creators</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>

                        {!isRenaming && group !== "General" && (
                          <>
                            <button
                              onClick={() => {
                                setRenamingGroup(group);
                                setRenamedGroupName(group);
                              }}
                              className="p-1.5 text-[#767682] hover:text-[#efeff1] hover:bg-[#26262c] rounded-md transition-colors cursor-pointer"
                              title="Rename group"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteGroupInternal(group)}
                              className="p-1.5 text-[#767682] hover:text-[#eb0400] hover:bg-[#eb0400]/10 rounded-md transition-colors cursor-pointer"
                              title="Delete group (moves creators to General)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#2d2d34] bg-[#1f1f23] flex items-center justify-between text-xs text-[#767682]">
          <span>Changes are saved automatically</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#26262c] hover:bg-[#32323a] text-[#efeff1] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
