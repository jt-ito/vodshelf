import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { CLOUDFRONT_DOMAINS } from "@/lib/twitch/cdn-prober";

export const dynamic = "force-dynamic";

// Whitelisted origins for streaming proxy — specific known Twitch VOD CDN domains only.
// Uses the canonical CLOUDFRONT_DOMAINS list from cdn-prober as single source of truth,
// supplemented by Twitch's general CDN domains and the vodvod indexer API.
const ALLOWED_EXACT_HOSTNAMES = new Set([
  ...CLOUDFRONT_DOMAINS,
  "api.vodvod.top",
]);

// Twitch CDN domains that use subdomain patterns (e.g., vod-metro.twitch.tv, usher.ttvnw.net, *.cloudfront.net)
const ALLOWED_SUFFIX_HOSTNAMES = [
  "jtvnw.net",
  "ttvnw.net",
  "cloudfront.net",
];

function isHostAllowed(hostname: string): boolean {
  if (ALLOWED_EXACT_HOSTNAMES.has(hostname)) return true;
  return ALLOWED_SUFFIX_HOSTNAMES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(req: NextRequest) {
  // Rate limit: 200 chunk/playlist requests per minute per IP
  const rate = checkRateLimit(req, {
    prefix: "stream_proxy",
    maxRequests: 200,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing stream url" }, { status: 400 });
  }

  try {
    const parsedTarget = new URL(targetUrl);

    // Protocol check: strictly enforce HTTPS
    if (parsedTarget.protocol !== "https:") {
      return NextResponse.json({ error: "Only HTTPS protocol is permitted" }, { status: 400 });
    }

    // Hostname validation against whitelist to prevent SSRF
    if (!isHostAllowed(parsedTarget.hostname)) {
      return NextResponse.json({ error: "Target host is not permitted" }, { status: 403 });
    }

    const rangeHeader = req.headers.get("range");
    const fetchHeaders: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    let response = await fetch(targetUrl, {
      headers: fetchHeaders,
      cache: "no-store",
      redirect: "manual",
    });

    // Handle single safe redirect hop if target host redirects
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        return new NextResponse("Redirect location missing", { status: 502 });
      }
      const redirectUrl = new URL(location, targetUrl);
      if (redirectUrl.protocol !== "https:" || !isHostAllowed(redirectUrl.hostname)) {
        return new NextResponse("Redirect target host is not permitted", { status: 403 });
      }
      response = await fetch(redirectUrl.toString(), {
        headers: fetchHeaders,
        cache: "no-store",
        redirect: "manual",
      });
      if ([301, 302, 307, 308].includes(response.status)) {
        return new NextResponse("Too many redirects", { status: 502 });
      }
    }

    if (!response.ok && response.status !== 206) {
      return new NextResponse("Stream resource unavailable", { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "";
    const isPlaylist =
      targetUrl.endsWith(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("application/x-mpegURL") ||
      contentType.includes("text/plain");

    if (isPlaylist) {
      const originalText = await response.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const lines = originalText.split(/\r?\n/);
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
              const fullUri = uri.startsWith("http") ? uri : new URL(uri, baseUrl).toString();
              return `URI="/api/proxy/m3u8?url=${encodeURIComponent(fullUri)}"`;
            });
          }
          return line;
        }

        const absoluteUrl = trimmed.startsWith("http")
          ? trimmed
          : new URL(trimmed, baseUrl).toString();

        return `/api/proxy/m3u8?url=${encodeURIComponent(absoluteUrl)}`;
      });

      return new NextResponse(rewrittenLines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // Binary media chunk (.ts)
    const arrayBuffer = await response.arrayBuffer();
    const responseHeaders: HeadersInit = {
      "Content-Type": contentType || "video/mp2t",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    };

    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
    }

    return new NextResponse(Buffer.from(arrayBuffer), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return handleApiError("proxy/m3u8", err, "Failed to stream media segment", 502);
  }
}
