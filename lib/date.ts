"use client";

import { useState, useEffect } from "react";

export type DateFormatPreference = "relative" | "exact";

export const DATE_FORMAT_STORAGE_KEY = "twitch_date_format_pref";
export const DATE_FORMAT_CHANGE_EVENT = "twitch_date_format_changed";

/**
 * Returns the current date format preference stored in localStorage.
 * Defaults to "relative" (e.g. 11h ago, 2d ago).
 */
export function getStoredDateFormat(): DateFormatPreference {
  if (typeof window === "undefined") return "relative";
  try {
    const saved = localStorage.getItem(DATE_FORMAT_STORAGE_KEY);
    if (saved === "exact" || saved === "relative") {
      return saved;
    }
  } catch {}
  return "relative";
}

/**
 * Persists the chosen date format preference to localStorage and emits an event
 * so all active components update dynamically without requiring a page refresh.
 */
export function setStoredDateFormat(pref: DateFormatPreference) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DATE_FORMAT_STORAGE_KEY, pref);
    window.dispatchEvent(
      new CustomEvent(DATE_FORMAT_CHANGE_EVENT, { detail: pref })
    );
  } catch {}
}

/**
 * React hook that returns the active DateFormatPreference and re-renders
 * whenever the user changes the setting anywhere in the app.
 */
export function useDateFormat(): DateFormatPreference {
  const [pref, setPref] = useState<DateFormatPreference>("relative");

  useEffect(() => {
    setPref(getStoredDateFormat());

    const handleEvent = (e: Event) => {
      const customEvent = e as CustomEvent<DateFormatPreference>;
      if (customEvent.detail === "exact" || customEvent.detail === "relative") {
        setPref(customEvent.detail);
      } else {
        setPref(getStoredDateFormat());
      }
    };

    window.addEventListener(DATE_FORMAT_CHANGE_EVENT, handleEvent);
    window.addEventListener("storage", handleEvent);

    return () => {
      window.removeEventListener(DATE_FORMAT_CHANGE_EVENT, handleEvent);
      window.removeEventListener("storage", handleEvent);
    };
  }, []);

  return pref;
}

/**
 * Formats a date string according to preference.
 * - "relative": "11h ago", "2d ago", "3mo ago" (default)
 * - "exact": "9/4/2026" (month/day/year)
 */
export function formatDateWithPreference(
  dateStr: string,
  mode?: DateFormatPreference
): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    const activeMode = mode ?? getStoredDateFormat();

    if (activeMode === "exact") {
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const year = d.getFullYear();
      return `${month}/${day}/${year}`;
    }

    // Relative calculation
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) {
      // Future date fallback
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  } catch {
    return dateStr;
  }
}
