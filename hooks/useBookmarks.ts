"use client";

import useSWR from "swr";
import { useToast } from "@/components/Toast";
import type { BookmarkItem } from "@/components/VideoPlayerModal";

/** Bookmarks for one VOD; removal is optimistic, adding revalidates the list. */
export function useBookmarks(vodId: string, streamerLogin: string) {
  const { showToast } = useToast();
  const { data, mutate } = useSWR<BookmarkItem[]>(
    vodId ? `/api/watch/bookmarks?vodId=${encodeURIComponent(vodId)}` : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()).bookmarks || [];
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  /** Returns true when saved. */
  const add = async (timestampSeconds: number, note: string) => {
    try {
      const res = await fetch("/api/watch/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vodId, streamerLogin, timestampSeconds, note }),
      });
      if (res.ok) {
        mutate();
        return true;
      }
      showToast("Failed to save bookmark", "error");
    } catch {
      showToast("Error saving bookmark", "error");
    }
    return false;
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/watch/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        mutate((prev) => prev?.filter((b) => b.id !== id), { revalidate: false });
        showToast("Bookmark removed");
        return;
      }
      showToast((await res.json().catch(() => ({}))).error || "Failed to remove bookmark", "error");
    } catch {
      showToast("Failed to remove bookmark", "error");
    }
  };

  return { bookmarks: data ?? [], add, remove };
}
