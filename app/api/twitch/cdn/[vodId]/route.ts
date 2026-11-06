import { NextRequest, NextResponse } from "next/server";
import { recoverVodStreams } from "@/lib/twitch/cdn-prober";
import { sanitizeVodId } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { getCurrentUser } from "@/lib/auth/session";
import { getWatchStatusMapForUser } from "@/lib/watch/merge";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { vodId: string } }
) {
  const rate = checkRateLimit(req, {
    prefix: "twitch_cdn",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const cleanVodId = sanitizeVodId(params.vodId);
    if (!cleanVodId) {
      return NextResponse.json({ error: "Valid VOD ID is required" }, { status: 400 });
    }

    const result = await recoverVodStreams(cleanVodId);
    const currentUser = await getCurrentUser(req);
    let watchStatus = {
      isWatched: false,
      progressSeconds: 0,
      totalSeconds: result?.durationSeconds || 0,
    };

    if (currentUser && result) {
      const idsToCheck = [result.vodId, cleanVodId].filter(Boolean);
      const watchMap = await getWatchStatusMapForUser(currentUser.id, idsToCheck);
      watchStatus = watchMap[result.vodId] || watchMap[cleanVodId] || watchStatus;
    }

    const recoveryWithWatch = result ? { ...result, watchStatus } : null;

    return NextResponse.json(
      { recovery: recoveryWithWatch },
      {
        headers: {
          "Cache-Control": currentUser
            ? "private, no-cache"
            : "public, s-maxage=600, stale-while-revalidate=1800",
        },
      }
    );
  } catch (err: any) {
    return handleApiError("twitch/cdn", err, "Failed to resolve CDN stream manifests");
  }
}
