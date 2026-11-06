import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { hashPassword, createSessionToken, AUTH_COOKIE_CONFIG } from "@/lib/auth/session";
import { validateUsername, validatePassword } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Rate limit: 8 registrations per 10 minutes
  const rate = checkRateLimit(req, {
    prefix: "auth_register",
    maxRequests: 8,
    windowMs: 10 * 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawUsername = body.username;
    const rawPassword = body.password;

    const userValidation = validateUsername(rawUsername);
    if (!userValidation.isValid) {
      return NextResponse.json(
        { error: userValidation.error || "Invalid username format" },
        { status: 400 }
      );
    }

    const passValidation = validatePassword(rawPassword);
    if (!passValidation.isValid) {
      return NextResponse.json(
        { error: passValidation.error || "Invalid password format" },
        { status: 400 }
      );
    }

    const username = userValidation.value!;
    const password = passValidation.value!;

    const db = getDb();

    // Check if user already exists
    const existing = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [username],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 409 }
      );
    }

    const userId = randomUUID();
    const hashedPassword = await hashPassword(password);

    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash, token_version) VALUES (?, ?, ?, 1)",
      args: [userId, username, hashedPassword],
    });

    logger.info("New user registered", { userId, username });

    const sessionToken = await createSessionToken({ id: userId, username, tokenVersion: 1 });

    const response = NextResponse.json({
      user: {
        id: userId,
        username,
        dateFormat: "relative",
        markWatchedOnOpenLink: false,
        markWatchedOnPlay: false,
        markAllWatchedScope: "loaded",
        feedFilter: "all",
      },
      message: "Account created successfully",
    });

    response.cookies.set(AUTH_COOKIE_CONFIG.name, sessionToken, AUTH_COOKIE_CONFIG.options);
    return response;
  } catch (err: any) {
    // Gracefully catch database-level unique constraint collision from race conditions
    if (err?.message?.includes("UNIQUE") || err?.code === "SQLITE_CONSTRAINT") {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 409 }
      );
    }
    return handleApiError("auth/register", err, "Registration failed. Please try again.");
  }
}
