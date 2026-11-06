import { NextRequest, NextResponse } from "next/server";

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https://static-cdn.jtvnw.net https://*.cloudfront.net https://*.ttvnw.net https://*.jtvnw.net data: blob:",
  "media-src 'self' https://*.cloudfront.net https://*.jtvnw.net https://*.ttvnw.net blob:",
  "connect-src 'self' https://gql.twitch.tv https://*.cloudfront.net https://*.jtvnw.net https://*.ttvnw.net blob:",
  "frame-ancestors 'none'",
].join("; ");

// Security headers applied to all responses
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP_POLICY,
};

export function middleware(req: NextRequest) {
  const method = req.method.toUpperCase();
  const isStateChanging = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  // Apply CSRF Origin/Referer validation to state-changing API requests
  if (isStateChanging && req.nextUrl.pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const expectedHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").toLowerCase();

    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host.toLowerCase() !== expectedHost) {
          return NextResponse.json(
            { error: "Forbidden: Cross-origin request rejected (CSRF protection)" },
            { status: 403, headers: SECURITY_HEADERS }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Forbidden: Malformed Origin header" },
          { status: 403, headers: SECURITY_HEADERS }
        );
      }
    } else if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.host.toLowerCase() !== expectedHost) {
          return NextResponse.json(
            { error: "Forbidden: Cross-origin request rejected (CSRF protection)" },
            { status: 403, headers: SECURITY_HEADERS }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Forbidden: Malformed Referer header" },
          { status: 403, headers: SECURITY_HEADERS }
        );
      }
    } else {
      // Neither Origin nor Referer present — reject state-changing requests to prevent CSRF
      return NextResponse.json(
        { error: "Forbidden: Missing Origin/Referer header (CSRF protection)" },
        { status: 403, headers: SECURITY_HEADERS }
      );
    }
  }

  // Attach security headers to all responses
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
