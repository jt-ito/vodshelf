import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser, createSessionToken, AUTH_COOKIE_CONFIG } from "@/lib/auth/session";
import { validateUsername } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const USERNAME_COOLDOWN_DAYS = 15;
const COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export async function PUT(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_update_username",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const validation = validateUsername(body.newUsername);

    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error || "Invalid username format" },
        { status: 400 }
      );
    }

    const newUsername = validation.value!;

    if (newUsername.toLowerCase() === currentUser.username.toLowerCase()) {
      return NextResponse.json(
        { error: "New username must be different from your current username" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 1. Verify 15-day cooldown constraint from database
    const userRes = await db.execute({
      sql: "SELECT id, username, username_changed_at FROM users WHERE id = ?",
      args: [currentUser.id],
    });

    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userRow = userRes.rows[0];
    const usernameChangedAt = userRow.username_changed_at as string | null;

    if (usernameChangedAt) {
      const lastChangedTime = new Date(usernameChangedAt).getTime();
      const elapsed = Date.now() - lastChangedTime;

      if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
        return NextResponse.json(
          {
            error: `Username can only be changed once every ${USERNAME_COOLDOWN_DAYS} days. Please try again in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""}.`,
            daysRemaining,
          },
          { status: 403 }
        );
      }
    }

    // 2. Check if username is already taken by another user
    const conflictRes = await db.execute({
      sql: "SELECT id FROM users WHERE username = ? AND id != ?",
      args: [newUsername, currentUser.id],
    });

    if (conflictRes.rows.length > 0) {
      return NextResponse.json(
        { error: "This username is already taken. Please choose another." },
        { status: 409 }
      );
    }

    // 3. Update database record with new timestamp
    const nowIso = new Date().toISOString();
    await db.execute({
      sql: "UPDATE users SET username = ?, username_changed_at = ? WHERE id = ?",
      args: [newUsername, nowIso, currentUser.id],
    });

    logger.info("Username changed", {
      userId: currentUser.id,
      oldUsername: currentUser.username,
      newUsername,
    });

    // 4. Issue updated session cookie with the new username and current tokenVersion
    const sessionToken = await createSessionToken({
      id: currentUser.id,
      username: newUsername,
      tokenVersion: currentUser.tokenVersion,
    });

    const response = NextResponse.json({
      user: {
        id: currentUser.id,
        username: newUsername,
        usernameChangedAt: nowIso,
      },
      message: "Username updated successfully",
    });

    response.cookies.set(AUTH_COOKIE_CONFIG.name, sessionToken, AUTH_COOKIE_CONFIG.options);
    return response;
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE") || err?.code === "SQLITE_CONSTRAINT") {
      return NextResponse.json(
        { error: "This username is already taken. Please choose another." },
        { status: 409 }
      );
    }
    return handleApiError("user/username", err, "Failed to update username");
  }
}
