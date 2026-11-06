"use client";

import useSWR from "swr";

/** The signed-in user's distinct VOD tags (cached; null key skips the request when signed out). */
export function useVodTags(isLoggedIn: boolean): string[] {
  const { data } = useSWR<string[]>(
    isLoggedIn ? "/api/watch/tags" : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()).tags ?? [];
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  return data ?? [];
}
