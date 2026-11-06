"use client";

import React, { useState } from "react";
import { Search, Film, Tv, ArrowRight, ShieldCheck, Clock, Layers } from "lucide-react";

interface LandingHeroProps {
  onSearchStreamer: (login: string) => void;
  onRecoverVodId: (vodId: string) => void;
}

const FEATURED_STREAMERS = [
  { login: "tarik", name: "tarik", color: "#eb0400" },
  { login: "shroud", name: "shroud", color: "#00b4d8" },
  { login: "xqc", name: "xQc", color: "#ffb703" },
  { login: "caseoh_", name: "CaseOh", color: "#fb8500" },
  { login: "summit1g", name: "summit1g", color: "#7209b7" },
  { login: "pokimane", name: "Pokimane", color: "#f72585" },
  { login: "hasanabi", name: "HasanAbi", color: "#4cc9f0" },
  { login: "caedrel", name: "Caedrel", color: "#00f59b" },
];

export default function LandingHero({ onSearchStreamer, onRecoverVodId }: LandingHeroProps) {
  const [activeTab, setActiveTab] = useState<"channel" | "vod">("channel");
  const [channelInput, setChannelInput] = useState("");
  const [vodInput, setVodInput] = useState("");

  const handleChannelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (channelInput.trim()) {
      onSearchStreamer(channelInput.trim().toLowerCase());
    }
  };

  const handleVodSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = vodInput.replace(/[^0-9]/g, "");
    if (clean) {
      onRecoverVodId(clean);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fade-in-up">
      {/* Title & Introduction */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#9146ff]/15 border border-[#9146ff]/30 text-[#bf94ff] text-xs font-semibold">
          <Film className="w-3.5 h-3.5 text-[#9146ff]" />
          <span>Twitch Archive Gateway</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-[#efeff1] tracking-tight">
          Past Broadcasts & Stream Archive
        </h1>
        <p className="text-xs sm:text-sm text-[#adadb8] max-w-2xl leading-relaxed">
          Search any Twitch channel to browse full past broadcasts beyond standard pagination caps, or probe Amazon CloudFront manifests to discover unlisted stream recordings.
        </p>
      </div>

      {/* Explorer Console Box */}
      <div className="bg-[#18181b] border border-[#2d2d34] rounded-lg p-4 sm:p-5 space-y-4">
        {/* Mode Selector Tabs */}
        <div className="flex items-center gap-2 border-b border-[#2d2d34] pb-3">
          <button
            onClick={() => setActiveTab("channel")}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
              activeTab === "channel"
                ? "bg-[#9146ff] text-white shadow-sm"
                : "text-[#adadb8] hover:text-[#efeff1] hover:bg-[#1f1f23]"
            }`}
          >
            Search Channel
          </button>
          <button
            onClick={() => setActiveTab("vod")}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition-all active:scale-[0.98] ${
              activeTab === "vod"
                ? "bg-[#9146ff] text-white shadow-sm"
                : "text-[#adadb8] hover:text-[#efeff1] hover:bg-[#1f1f23]"
            }`}
          >
            Probe by VOD ID
          </button>
        </div>

        {/* Form area */}
        {activeTab === "channel" ? (
          <form onSubmit={handleChannelSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#767682] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder="Enter channel name (e.g. shroud, tarik, xqc)…"
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
                spellCheck={false}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!channelInput.trim()}
              className="px-4 py-2 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-md flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
            >
              <span>Explore Channel</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleVodSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Tv className="w-4 h-4 text-[#767682] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={vodInput}
                onChange={(e) => setVodInput(e.target.value)}
                placeholder="Enter numeric VOD ID (e.g. 2864271472)…"
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-[#0e0e10] text-[#efeff1] placeholder-[#767682] border border-[#2d2d34] rounded-md focus:border-[#9146ff] focus:outline-none focus:ring-1 focus:ring-[#9146ff]"
                spellCheck={false}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!vodInput.trim()}
              className="px-4 py-2 bg-[#9146ff] hover:bg-[#772ce8] disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-md flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
            >
              <span>Probe Manifest</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* Quick Access Streamers with Channel Color Accents */}
        <div className="pt-2">
          <span className="text-[11px] font-semibold text-[#767682] uppercase tracking-wider block mb-2">
            Quick Channels
          </span>
          <div className="flex flex-wrap gap-2">
            {FEATURED_STREAMERS.map((s) => (
              <button
                key={s.login}
                onClick={() => onSearchStreamer(s.login)}
                className="px-2.5 py-1 rounded bg-[#0e0e10] hover:bg-[#26262c] text-[#adadb8] hover:text-[#efeff1] border border-[#2d2d34] hover:border-[#9146ff]/40 text-xs transition-all cursor-pointer active:scale-[0.98] flex items-center gap-2"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Capabilities Overview with Distinct Role Colors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <div className="p-3.5 rounded-lg bg-[#18181b] border border-[#2d2d34] hover:border-[#9146ff]/40 transition-colors space-y-1">
          <div className="text-xs font-semibold text-[#efeff1] flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-[#9146ff]/15 flex items-center justify-center text-[#bf94ff] flex-shrink-0">
              <Layers className="w-3.5 h-3.5 text-[#9146ff]" />
            </span>
            <span>Full Cursor Pagination</span>
          </div>
          <p className="text-[11px] text-[#767682] leading-relaxed pl-8">
            Query past broadcasts beyond standard pagination caps using Twitch GQL.
          </p>
        </div>

        <div className="p-3.5 rounded-lg bg-[#18181b] border border-[#2d2d34] hover:border-[#9146ff]/40 transition-colors space-y-1">
          <div className="text-xs font-semibold text-[#efeff1] flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-[#9146ff]/15 flex items-center justify-center text-[#bf94ff] flex-shrink-0">
              <Tv className="w-3.5 h-3.5 text-[#9146ff]" />
            </span>
            <span>Direct HLS Video Player</span>
          </div>
          <p className="text-[11px] text-[#767682] leading-relaxed pl-8">
            Integrated high-performance player defaulting to highest source quality with keyboard controls.
          </p>
        </div>

        <div className="p-3.5 rounded-lg bg-[#18181b] border border-[#2d2d34] hover:border-[#00f59b]/40 transition-colors space-y-1">
          <div className="text-xs font-semibold text-[#efeff1] flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-[#00f59b]/15 flex items-center justify-center text-[#00f59b] flex-shrink-0">
              <Clock className="w-3.5 h-3.5 text-[#00f59b]" />
            </span>
            <span>Watch History Sync</span>
          </div>
          <p className="text-[11px] text-[#767682] leading-relaxed pl-8">
            Automatic 10s playback progress sync and aggregated feed for pinned creators.
          </p>
        </div>
      </div>
    </div>
  );
}
