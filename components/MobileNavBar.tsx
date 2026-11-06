"use client";

import React from "react";
import { Home, Bookmark, Users, Settings, User } from "lucide-react";

interface MobileNavBarProps {
  activeView: "home" | "streamer" | "feed" | "settings";
  onSelectHome: () => void;
  onSelectFeed: () => void;
  onSelectSettings: () => void;
  onToggleMobileSidebar: () => void;
  isMobileSidebarOpen: boolean;
  currentUser: { id: string; username: string } | null;
  onOpenAuth: () => void;
  pinnedCount?: number;
}

export default function MobileNavBar({
  activeView,
  onSelectHome,
  onSelectFeed,
  onSelectSettings,
  onToggleMobileSidebar,
  isMobileSidebarOpen,
  currentUser,
  onOpenAuth,
  pinnedCount = 0,
}: MobileNavBarProps) {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#18181b]/95 backdrop-blur-lg border-t border-[#2d2d34] px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] flex items-center justify-around select-none shadow-[0_-4px_20px_rgba(0,0,0,0.5)]"
    >
      {/* Discover / Home */}
      <button
        type="button"
        onClick={onSelectHome}
        className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-all active:scale-95 cursor-pointer ${
          activeView === "home" && !isMobileSidebarOpen
            ? "text-[#9146ff] font-bold"
            : "text-[#adadb8] hover:text-[#efeff1]"
        }`}
      >
        <Home className={`w-5 h-5 ${activeView === "home" && !isMobileSidebarOpen ? "text-[#9146ff]" : ""}`} />
        <span className="text-[10px] tracking-tight mt-0.5">Discover</span>
      </button>

      {/* My Feed */}
      <button
        type="button"
        onClick={onSelectFeed}
        className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-all active:scale-95 cursor-pointer relative ${
          activeView === "feed" && !isMobileSidebarOpen
            ? "text-[#9146ff] font-bold"
            : "text-[#adadb8] hover:text-[#efeff1]"
        }`}
      >
        <div className="relative">
          <Bookmark className={`w-5 h-5 ${activeView === "feed" && !isMobileSidebarOpen ? "text-[#9146ff] fill-[#9146ff]/20" : ""}`} />
        </div>
        <span className="text-[10px] tracking-tight mt-0.5">My Feed</span>
      </button>

      {/* Pinned Creators Drawer Trigger */}
      <button
        type="button"
        onClick={onToggleMobileSidebar}
        className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-all active:scale-95 cursor-pointer ${
          isMobileSidebarOpen
            ? "text-[#9146ff] font-bold"
            : "text-[#adadb8] hover:text-[#efeff1]"
        }`}
      >
        <div className="relative">
          <Users className={`w-5 h-5 ${isMobileSidebarOpen ? "text-[#9146ff]" : ""}`} />
          {pinnedCount > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-3.5 h-3.5 px-0.5 bg-[#9146ff] text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {pinnedCount > 9 ? "9+" : pinnedCount}
            </span>
          )}
        </div>
        <span className="text-[10px] tracking-tight mt-0.5">Creators</span>
      </button>

      {/* Account / Settings */}
      {currentUser ? (
        <button
          type="button"
          onClick={onSelectSettings}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-all active:scale-95 cursor-pointer ${
            activeView === "settings" && !isMobileSidebarOpen
              ? "text-[#9146ff] font-bold"
              : "text-[#adadb8] hover:text-[#efeff1]"
          }`}
        >
          <Settings className={`w-5 h-5 ${activeView === "settings" && !isMobileSidebarOpen ? "text-[#9146ff]" : ""}`} />
          <span className="text-[10px] tracking-tight mt-0.5">Settings</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenAuth}
          className="flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-all active:scale-95 cursor-pointer text-[#adadb8] hover:text-[#9146ff]"
        >
          <User className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-0.5">Sign In</span>
        </button>
      )}
    </nav>
  );
}
