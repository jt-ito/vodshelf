"use client";

import { useState } from "react";
import useSWR from "swr";
import { useToast } from "@/components/Toast";
import { setStoredDateFormat, DateFormatPreference } from "@/lib/date";
import { setStoredWatchSettings, WatchSettings } from "@/lib/watch-settings";

const URL_SETTINGS = "/api/user/settings";

const getJson = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/** Merge into the cached user the rest of the app hydrates from. */
function patchCachedUser(partial: object) {
  try {
    const cached = localStorage.getItem("twitch_cached_user");
    localStorage.setItem("twitch_cached_user", JSON.stringify({ ...(cached ? JSON.parse(cached) : {}), ...partial }));
  } catch {}
}

/** Profile, display/watch preferences (optimistic save) and watch stats for the settings page. */
export function useUserSettings<TProfile = any, TStats = any>() {
  const { showToast } = useToast();
  const [isSavingDateFormat, setIsSavingDateFormat] = useState(false);
  const [isSavingWatchSettings, setIsSavingWatchSettings] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ user: TProfile & Record<string, any> }>(URL_SETTINGS, getJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: () => showToast("Failed to load user profile", "error"),
    onSuccess: ({ user }) => {
      if (!user) return;
      if (user.dateFormat === "exact" || user.dateFormat === "relative") setStoredDateFormat(user.dateFormat);
      setStoredWatchSettings({
        markWatchedOnOpenLink: Boolean(user.markWatchedOnOpenLink),
        markWatchedOnPlay: Boolean(user.markWatchedOnPlay),
        markAllWatchedScope: user.markAllWatchedScope === "all" ? "all" : "loaded",
      });
      patchCachedUser(user);
    },
  });
  const stats = useSWR<TStats>("/api/user/stats", getJson, { revalidateOnFocus: false, shouldRetryOnError: false });

  /** Local preference is already active in localStorage, so a failed save is not rolled back. */
  const save = async (partial: object, okMsg: string, setSaving: (v: boolean) => void) => {
    patchCachedUser(partial);
    mutate((prev) => (prev ? { user: { ...prev.user, ...partial } } : prev), { revalidate: false });
    setSaving(true);
    try {
      const res = await fetch(URL_SETTINGS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (res.ok) showToast(okMsg);
    } catch {}
    setSaving(false);
  };

  return {
    profile: (data?.user ?? null) as TProfile | null,
    isLoading: isLoading && !data,
    statsData: stats.data ?? null,
    isLoadingStats: stats.isLoading,
    refresh: () => Promise.all([mutate(), stats.mutate()]),
    isSavingDateFormat,
    isSavingWatchSettings,
    updateDateFormat: (f: DateFormatPreference) => {
      setStoredDateFormat(f);
      return save(
        { dateFormat: f },
        f === "exact" ? "Date display set to exact dates (e.g. 9/4/2026)" : "Date display set to relative time (e.g. 11h ago)",
        setIsSavingDateFormat
      );
    },
    updateWatchSettings: (partial: Partial<WatchSettings>) => {
      setStoredWatchSettings(partial);
      return save(partial, "Watch settings updated", setIsSavingWatchSettings);
    },
  };
}
