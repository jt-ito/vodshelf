import { NextRequest, NextResponse } from "next/server";
import { getChannelMeta } from "@/lib/twitch/gql";
import { sanitizeLogin } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { login: string } }
) {
  const rate = checkRateLimit(req, {
    prefix: "twitch_user",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const cleanLogin = sanitizeLogin(params.login);
    if (!cleanLogin) {
      return NextResponse.json({ error: "Valid streamer login is required" }, { status: 400 });
    }

    const meta = await getChannelMeta(cleanLogin);
    if (!meta) {
      return NextResponse.json({ error: "Streamer not found" }, { status: 404 });
    }

    return NextResponse.json(
      { streamer: meta },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1200",
        },
      }
    );
  } catch (err: any) {
    return handleApiError("twitch/user", err, "Failed to retrieve channel data");
  }
}
