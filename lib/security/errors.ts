import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export function handleApiError(
  endpointName: string,
  err: any,
  userMessage = "An unexpected error occurred. Please try again later.",
  statusCode = 500
) {
  logger.error(`API Error in ${endpointName}:`, err, {
    endpoint: endpointName,
  });

  // Never leak error stacks or internal DB errors to client
  return NextResponse.json(
    { error: userMessage },
    { status: statusCode }
  );
}

export function rateLimitExceededResponse(resetSeconds: number) {
  return NextResponse.json(
    {
      error: `Too many requests. Please slow down and try again in ${resetSeconds} seconds.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(resetSeconds),
      },
    }
  );
}
