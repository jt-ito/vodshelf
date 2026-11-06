import { NextRequest, NextResponse } from "next/server";
import { getLiveStreams } from "@/lib/twitch/gql";
import { sanitizeLogin } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_live_get",
    maxRequests: 120,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawLogins = searchParams.get("logins") || "";
    const logins = rawLogins
      .split(",")
      .map((l) => sanitizeLogin(l.trim()))
      .filter((l): l is string => Boolean(l));

    if (logins.length === 0) {
      return NextResponse.json({ liveMap: {} });
    }

    // Limit to 100 logins per batch
    const boundedLogins = logins.slice(0, 100);
    const liveMap = await getLiveStreams(boundedLogins);

    return NextResponse.json({ liveMap });
  } catch (err: any) {
    return handleApiError("streamers/live:GET", err, "Failed to resolve live streamers status");
  }
}
