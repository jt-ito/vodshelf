"use client";

import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import type { PinnedStreamer } from "@/components/Sidebar";
import { useToast } from "@/components/Toast";

const URL_PINNED = "/api/streamers/pinned";
const CACHE_KEY = "twitch_cached_pinned_streamers";

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const fetchPinned = async (url: string): Promise<PinnedStreamer[]> => {
  const list: PinnedStreamer[] = (await getJson(url)).streamers || [];
  return list.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
  );
};

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Pinned creators: cached list, live status polling, and optimistic mutations with rollback by revalidation. */
export function usePinnedStreamers() {
  const { showToast } = useToast();
  const { data, isLoading, mutate } = useSWR(URL_PINNED, fetchPinned, {
    revalidateOnFocus: false,
    shouldRetryOnError: false, // 401 when signed out is expected
  });
  const list = data ?? [];
  const listRef = useRef(list);
  listRef.current = list;

  // Show last-known list instantly (client only, avoids SSR mismatch); the fetch then replaces it
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (Array.isArray(saved) && saved.length) mutate(saved, { revalidate: true });
    } catch {}
  }, [mutate]);

  const logins = list.map((s) => s.login).join(",");
  const { data: liveMap } = useSWR(
    logins ? `/api/streamers/live?logins=${encodeURIComponent(logins)}` : null,
    async (url: string) => (await getJson(url)).liveMap as Record<string, { isLive?: boolean }> | undefined,
    { refreshInterval: 60_000, shouldRetryOnError: false } // pauses while the tab is hidden, refreshes on focus
  );
  const streamers = useMemo(
    () => (liveMap ? list.map((s) => ({ ...s, isLive: Boolean(liveMap[s.login.toLowerCase()]?.isLive) })) : list),
    [list, liveMap]
  );

  const set = (next: (prev: PinnedStreamer[]) => PinnedStreamer[]) =>
    mutate(
      (prev) => {
        const out = next(prev ?? []);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(out));
        } catch {}
        return out;
      },
      { revalidate: false }
    );

  /** Sends a request; on failure toasts and re-syncs from the server. Returns the parsed body on success. */
  const send = async (method: string, url: string, body: unknown, failMsg: string) => {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      showToast(json.error || failMsg, "error");
    } catch {
      showToast(failMsg, "error");
    }
    mutate();
    return null;
  };

  const patch = (body: unknown, failMsg: string, optimistic: (prev: PinnedStreamer[]) => PinnedStreamer[]) => {
    set(optimistic);
    return send("PATCH", URL_PINNED, body, failMsg);
  };

  const unpin = async (login: string, label = login) => {
    const ok = await send("DELETE", `${URL_PINNED}?login=${encodeURIComponent(login.toLowerCase())}`, null, "Failed to unpin streamer");
    if (!ok) return;
    set((p) => p.filter((s) => !sameLogin(s.login, login)));
    showToast(`Unpinned ${label}`);
  };

  const pin = async (s: { login: string; displayName?: string; avatarUrl?: string; isLive?: boolean }) => {
    const login = s.login.toLowerCase();
    const json = await send("POST", URL_PINNED, { login, displayName: s.displayName, avatarUrl: s.avatarUrl, isLive: s.isLive }, "Failed to pin streamer");
    if (!json) return;
    if (json.streamer) set((p) => [{ ...json.streamer, isLive: Boolean(json.streamer.isLive ?? s.isLive) }, ...p]);
    showToast(json.message || `Pinned ${s.displayName || login}`);
  };

  return {
    streamers,
    isLoading: isLoading && !data,
    reload: () => mutate(),
    clear: () => {
      mutate([], { revalidate: false });
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {}
    },
    toggle: (s: { login: string; displayName?: string; avatarUrl?: string; isLive?: boolean }) =>
      listRef.current.some((p) => sameLogin(p.login, s.login)) ? unpin(s.login, s.displayName || s.login.toLowerCase()) : pin(s),
    unpin,
    update: (login: string, updates: { groupName?: string; isHidden?: boolean; sortOrder?: number }) =>
      patch({ login, ...updates }, "Failed to update pinned streamer", (p) =>
        p.map((s) => (sameLogin(s.login, login) ? { ...s, ...updates } : s))
      ),
    reorder: (reordered: PinnedStreamer[]) => {
      const next = reordered.map((s, sortOrder) => ({ ...s, sortOrder }));
      return patch({ updates: next.map(({ login, sortOrder }) => ({ login, sortOrder })) }, "Failed to save channel order", () => next);
    },
    renameGroup: (oldGroup: string, newGroup: string) =>
      patch({ action: "renameGroup", oldGroup, newGroup }, "Failed to rename group", (p) =>
        p.map((s) => ((s.groupName || "General") === oldGroup ? { ...s, groupName: newGroup } : s))
      ),
    deleteGroup: (groupName: string) =>
      patch({ action: "deleteGroup", groupName }, "Failed to delete group", (p) =>
        p.map((s) => ((s.groupName || "General") === groupName ? { ...s, groupName: "General" } : s))
      ),
  };
}
