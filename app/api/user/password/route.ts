import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser, verifyPassword, hashPassword, revokeUserSessions, createSessionToken, AUTH_COOKIE_CONFIG } from "@/lib/auth/session";
import { validatePassword } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_update_password",
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
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const rawNewPassword = body.newPassword;

    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 }
      );
    }

    const passValidation = validatePassword(rawNewPassword);
    if (!passValidation.isValid) {
      return NextResponse.json(
        { error: passValidation.error || "Invalid new password format" },
        { status: 400 }
      );
    }

    const newPassword = passValidation.value!;

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from your current password" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 1. Fetch existing password hash
    const userRes = await db.execute({
      sql: "SELECT id, password_hash FROM users WHERE id = ?",
      args: [currentUser.id],
    });

    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userRow = userRes.rows[0];
    const passwordHash = userRow.password_hash as string;

    // 2. Verify current password
    const isCurrentValid = await verifyPassword(currentPassword, passwordHash);
    if (!isCurrentValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // 3. Hash and persist new password, revoke all existing session tokens
    const newHashed = await hashPassword(newPassword);
    const newVersion = await revokeUserSessions(currentUser.id);

    await db.execute({
      sql: "UPDATE users SET password_hash = ? WHERE id = ?",
      args: [newHashed, currentUser.id],
    });

    logger.info("Password updated and existing sessions invalidated", { userId: currentUser.id });

    // Issue refreshed token for the current session
    const sessionToken = await createSessionToken({
      id: currentUser.id,
      username: currentUser.username,
      tokenVersion: newVersion,
    });

    const response = NextResponse.json({
      message: "Password updated successfully. Other active sessions have been signed out.",
    });

    response.cookies.set(AUTH_COOKIE_CONFIG.name, sessionToken, AUTH_COOKIE_CONFIG.options);
    return response;
  } catch (err: any) {
    return handleApiError("user/password", err, "Failed to update password");
  }
}
