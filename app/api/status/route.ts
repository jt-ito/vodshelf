import { NextRequest, NextResponse } from "next/server";
import { getOutages } from "@/lib/twitch/upstream-health";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

/** Which upstream services (Twitch, VODVOD, TwitchTracker) are currently failing. Empty list = all fine. */
export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, { prefix: "status", maxRequests: 60, windowMs: 60 * 1000 });
  if (!rate.success) return rateLimitExceededResponse(rate.reset);

  return NextResponse.json(
    { outages: getOutages() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
