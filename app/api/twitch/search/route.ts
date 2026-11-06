import { NextRequest, NextResponse } from "next/server";
import { searchChannels } from "@/lib/twitch/gql";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "twitch_search",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";

    if (!q || q.trim().length < 2) {
      return NextResponse.json({ channels: [] });
    }

    const channels = await searchChannels(q);
    return NextResponse.json(
      { channels },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        },
      }
    );
  } catch (err: any) {
    return handleApiError("twitch/search", err, "Search failed. Please try again.");
  }
}
