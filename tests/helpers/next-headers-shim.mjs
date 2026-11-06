// Route handlers under test always pass the request explicitly, so cookies() is never legitimately used.
export function cookies() {
  throw new Error("next/headers cookies() is not available in tests; pass the NextRequest explicitly");
}
export function headers() {
  throw new Error("next/headers headers() is not available in tests; pass the NextRequest explicitly");
}
