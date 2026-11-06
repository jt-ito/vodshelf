import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe: confirms the process is up and the SQLite database answers a query. */
export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, { prefix: "health", maxRequests: 60, windowMs: 60 * 1000 });
  if (!rate.success) return rateLimitExceededResponse(rate.reset);

  try {
    await getDb().execute("SELECT 1");
    return NextResponse.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
  } catch (err) {
    // Details stay in the server log; the response never leaks database internals
    logger.error("Health check failed", err);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
