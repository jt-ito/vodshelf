import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

const rawJwtSecret = process.env.JWT_SECRET;
if (!rawJwtSecret) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("CRITICAL: JWT_SECRET environment variable must be set outside of development mode.");
  } else {
    console.warn(
      "[Security Warning] Using default insecure JWT_SECRET fallback in development mode. " +
      "Please set JWT_SECRET in .env.local to ensure tokens are securely signed."
    );
  }
}

const JWT_SECRET = new TextEncoder().encode(
  rawJwtSecret || "twitch-vod-archive-dev-fallback-secret-minimum-32-chars-long"
);

const COOKIE_NAME = "twitch_archive_session";

export interface UserSession {
  id: string;
  username: string;
  tokenVersion?: number;
}

export async function hashPassword(password: string): Promise<string> {
  // Salt rounds increased to 12 (OWASP recommended work factor ~300ms)
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: UserSession): Promise<string> {
  const version = user.tokenVersion ?? 1;
  return new SignJWT({ id: user.id, username: user.username, tokenVersion: version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.id || !payload.username) return null;
    return {
      id: payload.id as string,
      username: payload.username as string,
      tokenVersion: typeof payload.tokenVersion === "number" ? payload.tokenVersion : 1,
    };
  } catch {
    return null;
  }
}

/**
 * Revokes all active session tokens for a user by incrementing token_version in the database.
 * Returns the new token version.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const db = getDb();
  await db.execute({
    sql: "UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?",
    args: [userId],
  });
  const res = await db.execute({
    sql: "SELECT token_version FROM users WHERE id = ?",
    args: [userId],
  });
  return Number(res.rows[0]?.token_version ?? 1);
}

export async function getCurrentUser(req?: NextRequest): Promise<UserSession | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      const authHeader = req.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }
  } else {
    const cookieStore = cookies();
    token = cookieStore.get(COOKIE_NAME)?.value;
  }

  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  // Validate token_version against the database for instantaneous revocation on logout / password change.
  // DB errors propagate (handled as 500 by callers) so a transient failure is not mistaken for being signed out.
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT token_version FROM users WHERE id = ?",
    args: [session.id],
  });

  if (result.rows.length === 0) {
    return null;
  }

  const currentVersion = Number(result.rows[0].token_version ?? 1);
  const sessionVersion = session.tokenVersion ?? 1;

  return sessionVersion === currentVersion ? session : null;
}

export const AUTH_COOKIE_CONFIG = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};
