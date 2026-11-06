interface WatchOverride {
  isWatched: boolean;
  progress: number;
  at: number;
}

/**
 * Remembers local watch changes with timestamps so a list response fetched *before* a change was
 * saved can't overwrite it. Changes made within a slack window before the request started (a save
 * may still have been in flight) or at any point after are re-applied over the response.
 */
export function createWatchOverrides() {
  const map = new Map<string, WatchOverride>();
  const SLACK_MS = 10_000;

  return {
    record(vodId: string | number, isWatched: boolean, progress: number): void {
      map.set(String(vodId), { isWatched, progress, at: Date.now() });
    },

    apply<T extends { id: string | number; watchStatus?: any }>(list: T[], loadStartedAt: number): T[] {
      const cutoff = loadStartedAt - SLACK_MS;
      map.forEach((o, id) => {
        if (o.at < cutoff) map.delete(id);
      });
      if (map.size === 0) return list;
      return list.map((v) => {
        const o = map.get(String(v.id));
        return o
          ? { ...v, watchStatus: { ...(v.watchStatus || {}), isWatched: o.isWatched, progressSeconds: o.progress } }
          : v;
      });
    },
  };
}
