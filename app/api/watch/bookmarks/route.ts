import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { sanitizeLogin, sanitizeText } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "bookmarks_get",
    maxRequests: 60,
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

    const { searchParams } = new URL(req.url);
    const vodId = searchParams.get("vodId");
    const db = getDb();

    let query = "SELECT id, vod_id, streamer_login, timestamp_seconds, note, created_at FROM bookmarks WHERE user_id = ?";
    const args: any[] = [currentUser.id];

    if (vodId) {
      query += " AND vod_id = ?";
      args.push(vodId.replace(/[^a-zA-Z0-9_-]/g, ""));
    }

    query += " ORDER BY timestamp_seconds ASC";

    const res = await db.execute({ sql: query, args });

    const bookmarks = res.rows.map((r) => ({
      id: r.id as string,
      vodId: r.vod_id as string,
      streamerLogin: r.streamer_login as string,
      timestampSeconds: Number(r.timestamp_seconds),
      note: (r.note as string) || "",
      createdAt: r.created_at as string,
    }));

    return NextResponse.json({ bookmarks });
  } catch (err: any) {
    return handleApiError("watch/bookmarks/get", err, "Failed to load bookmarks");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "bookmarks_post",
    maxRequests: 30,
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
    const rawVodId = body.vodId;
    const rawTimestamp = body.timestampSeconds;

    if (!rawVodId || rawTimestamp === undefined) {
      return NextResponse.json({ error: "vodId and timestampSeconds are required" }, { status: 400 });
    }

    const vodId = String(rawVodId).replace(/[^a-zA-Z0-9_-]/g, "");
    const timestampSeconds = Math.max(0, Math.floor(Number(rawTimestamp) || 0));
    const note = sanitizeText(body.note || "", 300);
    const streamerLogin = sanitizeLogin(body.streamerLogin || "");
    const id = `bm_${currentUser.id}_${vodId}_${timestampSeconds}_${Date.now()}`;

    const db = getDb();
    await db.execute({
      sql: `
        INSERT INTO bookmarks (id, user_id, vod_id, streamer_login, timestamp_seconds, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [id, currentUser.id, vodId, streamerLogin, timestampSeconds, note, new Date().toISOString()],
    });

    return NextResponse.json({
      success: true,
      bookmark: {
        id,
        vodId,
        streamerLogin,
        timestampSeconds,
        note,
      },
    });
  } catch (err: any) {
    return handleApiError("watch/bookmarks/post", err, "Failed to save bookmark");
  }
}

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "bookmarks_delete",
    maxRequests: 30,
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

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Bookmark ID is required" }, { status: 400 });
    }

    const db = getDb();
    await db.execute({
      sql: "DELETE FROM bookmarks WHERE id = ? AND user_id = ?",
      args: [id, currentUser.id],
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError("watch/bookmarks/delete", err, "Failed to delete bookmark");
  }
}
