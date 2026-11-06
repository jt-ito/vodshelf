import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser, verifyPassword, AUTH_COOKIE_CONFIG } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "user_delete_account",
    maxRequests: 5,
    windowMs: 60 * 1000,
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
    const { password } = body;

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password confirmation is required to delete your account" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify user password
    const userRes = await db.execute({
      sql: "SELECT password_hash FROM users WHERE id = ?",
      args: [currentUser.id],
    });

    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const passwordHash = userRes.rows[0].password_hash as string;
    const isValidPassword = await verifyPassword(password, passwordHash);

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Incorrect password. Account deletion aborted." },
        { status: 403 }
      );
    }

    // Cascade delete all user records
    await db.batch([
      { sql: "DELETE FROM bookmarks WHERE user_id = ?", args: [currentUser.id] },
      { sql: "DELETE FROM vod_tags WHERE user_id = ?", args: [currentUser.id] },
      { sql: "DELETE FROM watch_status WHERE user_id = ?", args: [currentUser.id] },
      { sql: "DELETE FROM pinned_streamers WHERE user_id = ?", args: [currentUser.id] },
      { sql: "DELETE FROM favorite_categories WHERE user_id = ?", args: [currentUser.id] },
      { sql: "DELETE FROM users WHERE id = ?", args: [currentUser.id] },
    ]);

    const res = NextResponse.json({
      success: true,
      message: "Account and all associated data permanently deleted.",
    });

    // Clear session cookie
    res.cookies.set(AUTH_COOKIE_CONFIG.name, "", {
      ...AUTH_COOKIE_CONFIG.options,
      maxAge: 0,
    });

    return res;
  } catch (err: any) {
    return handleApiError("user/delete", err, "Failed to delete account");
  }
}
