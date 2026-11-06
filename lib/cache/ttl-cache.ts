/**
 * High-performance in-memory TTL cache with request coalescing (deduplication).
 * Prevents duplicate outgoing requests to Twitch GQL, Helix, and external indexers.
 * Enforces a maximum entry cap to prevent unbounded memory growth under sustained load.
 */

// Maximum number of cached entries before oldest entries are evicted
const MAX_CACHE_ENTRIES = 25_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<any>>();
  private inflight = new Map<string, Promise<any>>();

  constructor() {
    // Periodically clean expired entries every 2 minutes
    // unref(): housekeeping must never keep the process alive (blocks graceful shutdown and test runs)
    setInterval(() => {
      const now = Date.now();
      this.store.forEach((entry, key) => {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      });
    }, 120000).unref?.();
  }

  /**
   * Retrieves an item from cache if present and not expired.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Saves an item to cache with a specified time-to-live in milliseconds.
   * Evicts the oldest entry if the cache exceeds MAX_CACHE_ENTRIES to prevent memory exhaustion.
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    // Evict oldest entry if at capacity (Map preserves insertion order)
    if (this.store.size >= MAX_CACHE_ENTRIES && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Wraps an async fetch operation with caching and in-flight request deduplication.
   * If multiple callers request the same key concurrently, only one outgoing fetch
   * is executed and all callers share the resolved result.
   */
  async fetchOrGet<T>(
    key: string,
    ttlMs: number,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    // 1. Check if already cached
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // 2. Check if a request for this key is currently in-flight
    const existingPromise = this.inflight.get(key);
    if (existingPromise) {
      return existingPromise as Promise<T>;
    }

    // 3. Initiate single fetch and register in-flight promise
    const promise = (async () => {
      try {
        const result = await fetchFn();
        if (result !== null && result !== undefined) {
          this.set(key, result, ttlMs);
        }
        return result;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Invalidate a key manually.
   */
  delete(key: string): void {
    this.store.delete(key);
    this.inflight.delete(key);
  }
}

export const serverCache = new TtlCache();
