"use client";

import React, { useEffect } from "react";
import { X, Command, Keyboard } from "lucide-react";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  context: "Global" | "Video Player" | "Navigation";
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["j", "↓"], description: "Select next VOD card in feed", context: "Navigation" },
  { keys: ["k", "↑"], description: "Select previous VOD card in feed", context: "Navigation" },
  { keys: ["Enter"], description: "Play currently selected VOD", context: "Navigation" },
  { keys: ["w", "Space"], description: "Toggle Watched status of selected VOD", context: "Navigation" },
  { keys: ["Esc"], description: "Clear the selected VOD", context: "Navigation" },
  { keys: ["q"], description: "Add selected VOD to playback queue", context: "Navigation" },
  { keys: ["/"], description: "Focus search bar in header or category tabs", context: "Global" },
  { keys: ["Esc"], description: "Close active modal or video player", context: "Global" },
  { keys: ["?"], description: "Open this keyboard shortcuts cheatsheet", context: "Global" },
  { keys: ["b"], description: "Create timestamp bookmark at current playback time", context: "Video Player" },
  { keys: ["m"], description: "Toggle audio mute in video player", context: "Video Player" },
];

export default function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-tab-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#18181b] border border-[#26262c] rounded-2xl shadow-2xl overflow-hidden animate-dropdown"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#26262c] bg-[#1f1f23]/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#9146ff]/10 text-[#9146ff] border border-[#9146ff]/20">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Keyboard Shortcuts</h2>
              <p className="text-xs text-gray-400">Power user hotkeys for rapid navigation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-[#26262c] transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Shortcuts List */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          {["Navigation", "Video Player", "Global"].map((category) => {
            const items = SHORTCUTS.filter((s) => s.context === category);
            if (items.length === 0) return null;

            return (
              <div key={category} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {category}
                </h3>
                <div className="space-y-1.5">
                  {items.map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#0e0e10]/60 border border-[#26262c] hover:border-gray-700 transition-colors"
                    >
                      <span className="text-sm text-gray-200">{shortcut.description}</span>
                      <div className="flex items-center gap-1.5">
                        {shortcut.keys.map((k, kIdx) => (
                          <kbd
                            key={kIdx}
                            className="px-2 py-1 text-xs font-mono font-semibold bg-[#1f1f23] text-gray-200 border border-[#3f3f46] rounded-md shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#26262c] bg-[#141417] flex items-center justify-between text-xs text-gray-400">
          <span>Press <kbd className="px-1.5 py-0.5 bg-[#1f1f23] border border-gray-700 rounded text-gray-300 font-mono">?</kbd> anywhere to open</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md bg-[#26262c] hover:bg-[#3f3f46] text-white transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
