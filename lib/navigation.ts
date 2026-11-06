/**
 * Navigation and session utilities for detecting page reloads vs fresh visits.
 */

/**
 * Detects whether the current page load is a browser reload/refresh (e.g. F5, Ctrl+R, browser refresh button)
 * versus a fresh navigation (e.g. opening the site in a new tab, bookmark, typing URL, or opening after closing).
 */
export function isPageReload(): boolean {
  if (typeof window === "undefined" || typeof performance === "undefined") return false;
  try {
    const navEntries = performance.getEntriesByType?.("navigation") as PerformanceNavigationTiming[] | undefined;
    if (navEntries && navEntries.length > 0) {
      return navEntries[0].type === "reload";
    }
    if ((performance as any).navigation) {
      return (performance as any).navigation.type === 1; // Legacy PerformanceNavigation.TYPE_RELOAD
    }
  } catch {}
  return false;
}
