"use client";

import { useState, useEffect } from "react";

export interface WatchSettings {
  markWatchedOnOpenLink: boolean;
  markWatchedOnPlay: boolean;
  markAllWatchedScope: "loaded" | "all";
}

export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  markWatchedOnOpenLink: false,
  markWatchedOnPlay: false,
  markAllWatchedScope: "loaded",
};

export const WATCH_SETTINGS_STORAGE_KEY = "twitch_watch_settings_pref";
export const WATCH_SETTINGS_CHANGE_EVENT = "twitch_watch_settings_changed";

/**
 * Returns current watch settings stored in localStorage with fallback to defaults.
 */
export function getStoredWatchSettings(): WatchSettings {
  if (typeof window === "undefined") return DEFAULT_WATCH_SETTINGS;
  try {
    const raw = localStorage.getItem(WATCH_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        markWatchedOnOpenLink: Boolean(parsed.markWatchedOnOpenLink),
        markWatchedOnPlay: Boolean(parsed.markWatchedOnPlay),
        markAllWatchedScope: parsed.markAllWatchedScope === "all" ? "all" : "loaded",
      };
    }
  } catch {}
  return DEFAULT_WATCH_SETTINGS;
}

/**
 * Persists watch settings to localStorage and dispatches event across components.
 */
export function setStoredWatchSettings(settings: Partial<WatchSettings>): WatchSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_WATCH_SETTINGS, ...settings };
  }
  try {
    const current = getStoredWatchSettings();
    const updated: WatchSettings = {
      ...current,
      ...settings,
    };
    localStorage.setItem(WATCH_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(
      new CustomEvent(WATCH_SETTINGS_CHANGE_EVENT, { detail: updated })
    );
    return updated;
  } catch {
    return DEFAULT_WATCH_SETTINGS;
  }
}

/**
 * React hook that returns active WatchSettings and triggers re-renders on update.
 */
export function useWatchSettings(): WatchSettings {
  const [settings, setSettings] = useState<WatchSettings>(DEFAULT_WATCH_SETTINGS);

  useEffect(() => {
    setSettings(getStoredWatchSettings());

    const handleEvent = (e: Event) => {
      const customEvent = e as CustomEvent<WatchSettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      } else {
        setSettings(getStoredWatchSettings());
      }
    };

    window.addEventListener(WATCH_SETTINGS_CHANGE_EVENT, handleEvent);
    window.addEventListener("storage", handleEvent);

    return () => {
      window.removeEventListener(WATCH_SETTINGS_CHANGE_EVENT, handleEvent);
      window.removeEventListener("storage", handleEvent);
    };
  }, []);

  return settings;
}
