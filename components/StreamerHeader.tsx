"use client";

import React from "react";
import { Pin, Check, Radio, Users, Film, Layers, Gamepad2 } from "lucide-react";
import { TwitchChannelMeta } from "@/lib/twitch/gql";

interface StreamerHeaderProps {
  streamer: TwitchChannelMeta;
  isPinned: boolean;
  onTogglePin: () => void;
  activeTab: "vods" | "categories" | "cdn";
  onSelectTab: (tab: "vods" | "categories" | "cdn") => void;
  vodCount?: number;
  categoriesCount?: number;
}

export default function StreamerHeader({
  streamer,
  isPinned,
  onTogglePin,
  activeTab,
  onSelectTab,
  vodCount,
  categoriesCount,
}: StreamerHeaderProps) {
  const formatFollowers = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="w-full bg-[#18181b] border-b border-[#2d2d34] animate-fade-in-up">
      {/* Banner / Cover */}
      <div className="h-28 sm:h-36 w-full bg-gradient-to-r from-[#9146ff]/20 via-[#18181b] to-[#18181b] relative overflow-hidden">
        {streamer.bannerImageURL && (
          <img
            src={streamer.bannerImageURL}
            alt=""
            className="w-full h-full object-cover opacity-35"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#18181b] via-transparent to-transparent"></div>
      </div>

      {/* Profile Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Avatar & Identity */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 sm:gap-4">
            <div className="relative flex-shrink-0 -mt-10 sm:-mt-14 z-10">
              <img
                src={streamer.profileImageURL}
                alt={streamer.displayName}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-4 border-[#18181b] bg-[#1f1f23] shadow-md"
              />
              {streamer.isLive && (
                <a
                  href={`https://www.twitch.tv/${streamer.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-[#eb0400] hover:bg-[#ff1a1a] text-white text-[9px] font-black tracking-wider uppercase animate-pulse-live flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                  title={`Watch ${streamer.displayName} live on Twitch`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                  <span>LIVE</span>
                </a>
              )}
            </div>

            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-[#efeff1] tracking-tight leading-normal">
                  {streamer.displayName}
                </h1>
                <a
                  href={`https://www.twitch.tv/${streamer.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#adadb8] hover:text-[#9146ff] hover:underline font-medium transition-colors cursor-pointer"
                  title={`Open @${streamer.login} on Twitch`}
                >
                  @{streamer.login}
                </a>
                <span className="text-xs px-2.5 py-1 rounded-full bg-[#9146ff]/15 text-[#bf94ff] border border-[#9146ff]/30 flex items-center gap-1 font-semibold whitespace-nowrap">
                  <Users className="w-3 h-3 text-[#9146ff]" />
                  <span>{formatFollowers(streamer.followers)} followers</span>
                </span>
              </div>

              {streamer.isLive && streamer.streamTitle && (
                <div className="text-xs text-[#efeff1] flex items-center gap-1.5 font-medium truncate max-w-xl">
                  <Radio className="w-3.5 h-3.5 flex-shrink-0 text-[#eb0400] animate-pulse" />
                  <a
                    href={`https://www.twitch.tv/${streamer.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate hover:text-[#9146ff] hover:underline transition-colors cursor-pointer"
                    title={`Watch ${streamer.displayName} live on Twitch`}
                  >
                    {streamer.streamTitle}
                  </a>
                  {streamer.gameName && (
                    <span className="text-[#bf94ff] bg-[#9146ff]/20 border border-[#9146ff]/30 px-2 py-0.5 rounded text-[11px] font-semibold flex-shrink-0">
                      {streamer.gameName}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action: Pin Streamer */}
          <div className="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0 mb-1">
            <button
              onClick={onTogglePin}
              className={`w-full sm:w-auto justify-center px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition-all active:scale-[0.98] shadow-sm ${
                isPinned
                  ? "bg-[#00f59b]/15 text-[#00f59b] border border-[#00f59b]/35 hover:bg-[#00f59b]/25"
                  : "bg-[#9146ff] text-white hover:bg-[#772ce8] shadow-sm shadow-[#9146ff]/30"
              }`}
            >
              {isPinned ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#00f59b]" />
                  <span>Pinned to Feed</span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5" />
                  <span>Pin Streamer</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Bio */}
        {streamer.description && (
          <p className="mt-3 text-xs text-[#adadb8] max-w-3xl leading-relaxed">
            {streamer.description}
          </p>
        )}

        {/* Tab Switcher */}
        <div className="mt-4 sm:mt-5 border-t border-[#2d2d34] pt-1.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => onSelectTab("vods")}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center gap-2 transition-all whitespace-nowrap active:scale-[0.98] ${
              activeTab === "vods"
                ? "text-white border-b-2 border-[#9146ff] bg-[#9146ff]/15"
                : "text-[#adadb8] hover:text-white hover:bg-[#26262c]/50"
            }`}
          >
            <Film className="w-3.5 h-3.5 text-[#9146ff]" />
            <span>Public VODs</span>
            {vodCount !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0e0e10] text-[#bf94ff] font-semibold">
                {vodCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab("categories")}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center gap-2 transition-all whitespace-nowrap active:scale-[0.98] ${
              activeTab === "categories"
                ? "text-white border-b-2 border-[#9146ff] bg-[#9146ff]/15"
                : "text-[#adadb8] hover:text-white hover:bg-[#26262c]/50"
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5 text-[#bf94ff]" />
            <span>Categories</span>
            {categoriesCount !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0e0e10] text-[#bf94ff] font-semibold">
                {categoriesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab("cdn")}
            className={`px-4 py-2 text-xs font-semibold rounded-md flex items-center gap-2 transition-all whitespace-nowrap active:scale-[0.98] ${
              activeTab === "cdn"
                ? "text-white border-b-2 border-[#00f59b] bg-[#00f59b]/15"
                : "text-[#adadb8] hover:text-white hover:bg-[#26262c]/50"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#00f59b]" />
            <span>CDN Stream Recovery</span>
          </button>
        </div>
      </div>
    </div>
  );
}
