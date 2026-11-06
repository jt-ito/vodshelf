import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

// Store category thumbnail cache outside public static folder
const CACHE_DIR = path.join(process.cwd(), ".cache", "categories");
const LEGACY_CACHE_DIR = path.join(process.cwd(), "public", "cache", "categories");
const MAX_CACHE_FILES = 2000;

// In-flight download deduplication to avoid redundant fetches on concurrent requests
const inFlightDownloads = new Map<string, Promise<Buffer | null>>();

/**
 * Strict SSRF protection: validate that custom image URLs only target Twitch's official CDN domains.
 */
function isValidTwitchImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "static-cdn.jtvnw.net" ||
      hostname.endsWith(".jtvnw.net") ||
      hostname.endsWith(".ttvnw.net")
    );
  } catch {
    return false;
  }
}

/**
 * Cleans up oldest cache files if total exceeds MAX_CACHE_FILES
 */
async function pruneCacheIfNeeded() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = await fs.promises.readdir(CACHE_DIR);
    if (files.length > MAX_CACHE_FILES) {
      const stats = await Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(CACHE_DIR, file);
          try {
            const stat = await fs.promises.stat(fullPath);
            return { path: fullPath, mtime: stat.mtimeMs };
          } catch {
            return { path: fullPath, mtime: 0 };
          }
        })
      );
      // Sort oldest first and prune 200 files
      stats.sort((a, b) => a.mtime - b.mtime);
      const toDelete = stats.slice(0, 200);
      for (const item of toDelete) {
        await fs.promises.unlink(item.path).catch(() => {});
      }
    }
  } catch {
    // Non-blocking background pruning
  }
}

async function fetchAndCacheThumbnail(
  gameId: string,
  customUrl?: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const filePath = path.join(CACHE_DIR, `${gameId}.jpg`);
  const legacyFilePath = path.join(LEGACY_CACHE_DIR, `${gameId}.jpg`);

  const altGameId = gameId.includes("_IGDB")
    ? gameId.replace("_IGDB", "")
    : `${gameId}_IGDB`;
  const altFilePath = path.join(CACHE_DIR, `${altGameId}.jpg`);
  const legacyAltFilePath = path.join(LEGACY_CACHE_DIR, `${altGameId}.jpg`);

  // 1. Check if already exists in primary server cache or legacy cache
  try {
    // Check main filePath
    if (fs.existsSync(filePath)) {
      const stat = await fs.promises.stat(filePath);
      // Valid high-res image must be larger than 6000 bytes (ignores any old 404 placeholders)
      if (stat.size > 6000) {
        const buffer = await fs.promises.readFile(filePath);
        if (buffer && buffer.length > 0) {
          return { buffer, contentType: "image/jpeg" };
        }
      } else {
        // Remove stale/corrupted placeholder so we can pull the real image
        await fs.promises.unlink(filePath).catch(() => {});
      }
    }

    // Check altFilePath (e.g. gameId with or without _IGDB)
    if (fs.existsSync(altFilePath)) {
      const stat = await fs.promises.stat(altFilePath);
      if (stat.size > 6000) {
        const buffer = await fs.promises.readFile(altFilePath);
        if (buffer && buffer.length > 0) {
          // Clone to filePath so next hit for this ID is instantaneous from disk
          fs.promises.writeFile(filePath, buffer).catch(() => {});
          return { buffer, contentType: "image/jpeg" };
        }
      } else {
        await fs.promises.unlink(altFilePath).catch(() => {});
      }
    }

    // Check legacy paths
    if (fs.existsSync(legacyFilePath)) {
      const stat = await fs.promises.stat(legacyFilePath);
      if (stat.size > 6000) {
        const buffer = await fs.promises.readFile(legacyFilePath);
        if (buffer && buffer.length > 0) {
          try {
            await fs.promises.mkdir(CACHE_DIR, { recursive: true });
            await fs.promises.writeFile(filePath, buffer);
          } catch {}
          return { buffer, contentType: "image/jpeg" };
        }
      }
    }
    if (fs.existsSync(legacyAltFilePath)) {
      const stat = await fs.promises.stat(legacyAltFilePath);
      if (stat.size > 6000) {
        const buffer = await fs.promises.readFile(legacyAltFilePath);
        if (buffer && buffer.length > 0) {
          try {
            await fs.promises.mkdir(CACHE_DIR, { recursive: true });
            await fs.promises.writeFile(filePath, buffer);
            await fs.promises.writeFile(altFilePath, buffer);
          } catch {}
          return { buffer, contentType: "image/jpeg" };
        }
      }
    }
  } catch {
    // Continue to fetch if read fails
  }

  // 2. Deduplicate concurrent requests
  if (inFlightDownloads.has(gameId)) {
    const buf = await inFlightDownloads.get(gameId)!;
    if (buf) {
      return { buffer: buf, contentType: "image/jpeg" };
    }
  }
  if (inFlightDownloads.has(altGameId)) {
    const buf = await inFlightDownloads.get(altGameId)!;
    if (buf) {
      return { buffer: buf, contentType: "image/jpeg" };
    }
  }

  // 3. Download high-res thumbnail from Twitch CDN for unseen thumbnails
  const downloadPromise = (async () => {
    try {
      const candidateUrls: string[] = [];

      if (customUrl && customUrl.startsWith("http")) {
        if (isValidTwitchImageUrl(customUrl)) {
          const formatted = customUrl
            .replace(/-\d+x\d+\.(jpg|png|jpeg)/i, "-285x380.$1")
            .replace(/\{width\}x\{height\}/i, "285x380")
            .replace(/\{width\}/i, "285")
            .replace(/\{height\}/i, "380");
          candidateUrls.push(formatted);
          if (!candidateUrls.includes(customUrl)) {
            candidateUrls.push(customUrl);
          }
        }
      }

      candidateUrls.push(`https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-285x380.jpg`);
      candidateUrls.push(`https://static-cdn.jtvnw.net/ttv-boxart/${altGameId}-285x380.jpg`);
      candidateUrls.push(`https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-140x190.jpg`);
      candidateUrls.push(`https://static-cdn.jtvnw.net/ttv-boxart/${altGameId}-140x190.jpg`);

      const uniqueCandidates = Array.from(new Set(candidateUrls));

      for (const targetUrl of uniqueCandidates) {
        try {
          const res = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            cache: "no-store",
          });

          // Verify status and ensure Twitch did not redirect to 404 placeholder
          const is404 =
            res.url.includes("404_boxart") ||
            res.headers.get("x-404-redirect") === "true";

          if (res.ok && !is404) {
            const arr = await res.arrayBuffer();
            const buffer = Buffer.from(arr);

            if (buffer.length > 6000) {
              // Save to server disk permanently for both gameId and altGameId
              try {
                await fs.promises.mkdir(CACHE_DIR, { recursive: true });
                await fs.promises.writeFile(filePath, buffer);
                await fs.promises.writeFile(altFilePath, buffer).catch(() => {});
                pruneCacheIfNeeded();
              } catch (writeErr) {
                console.error("Failed to save category thumbnail to disk:", writeErr);
              }
              return buffer;
            }
          }
        } catch {
          // Try next candidate
        }
      }

      return null;
    } catch (err) {
      console.error(`Error downloading thumbnail for game ${gameId}:`, err);
      return null;
    } finally {
      inFlightDownloads.delete(gameId);
      inFlightDownloads.delete(altGameId);
    }
  })();

  inFlightDownloads.set(gameId, downloadPromise);
  inFlightDownloads.set(altGameId, downloadPromise);
  const downloadedBuf = await downloadPromise;

  if (downloadedBuf) {
    return { buffer: downloadedBuf, contentType: "image/jpeg" };
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Rate limit thumbnail requests: 300 per minute per IP
  const rate = checkRateLimit(req, {
    prefix: "category_thumbnail",
    maxRequests: 300,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const rawId = params.id;
    // Sanitize ID: only alphanumeric and underscores
    const cleanId = rawId.replace(/[^a-zA-Z0-9_]/g, "");
    if (!cleanId) {
      return new NextResponse("Invalid category ID", { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const customUrl = searchParams.get("url") || undefined;

    // SSRF Check on customUrl parameter
    if (customUrl && !isValidTwitchImageUrl(customUrl)) {
      return NextResponse.json(
        { error: "Invalid image URL: only static-cdn.jtvnw.net or Twitch CDN origins are allowed." },
        { status: 400 }
      );
    }

    const result = await fetchAndCacheThumbnail(cleanId, customUrl);
    if (!result) {
      return new NextResponse("Thumbnail not found", { status: 404 });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new NextResponse("Server error fetching thumbnail", { status: 500 });
  }
}
