import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { sanitizeText } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "tags_get",
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

    if (vodId) {
      const cleanVodId = vodId.replace(/[^a-zA-Z0-9_-]/g, "");
      const res = await db.execute({
        sql: "SELECT tag FROM vod_tags WHERE user_id = ? AND vod_id = ? ORDER BY tag ASC",
        args: [currentUser.id, cleanVodId],
      });
      const tags = res.rows.map((r) => r.tag as string);
      return NextResponse.json({ tags });
    }

    // Return all tags grouped or distinct
    const res = await db.execute({
      sql: "SELECT DISTINCT tag FROM vod_tags WHERE user_id = ? ORDER BY tag ASC",
      args: [currentUser.id],
    });

    const tags = res.rows.map((r) => r.tag as string);
    return NextResponse.json({ tags });
  } catch (err: any) {
    return handleApiError("watch/tags/get", err, "Failed to load tags");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "tags_post",
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
    const rawTag = body.tag;

    if (!rawVodId || !rawTag) {
      return NextResponse.json({ error: "vodId and tag are required" }, { status: 400 });
    }

    const vodId = String(rawVodId).replace(/[^a-zA-Z0-9_-]/g, "");
    const tag = sanitizeText(String(rawTag), 50).trim().toLowerCase();

    if (!vodId || !tag) {
      return NextResponse.json({ error: "Invalid vodId or tag" }, { status: 400 });
    }

    const id = `tag_${currentUser.id}_${vodId}_${tag}`;
    const db = getDb();

    await db.execute({
      sql: "INSERT OR IGNORE INTO vod_tags (id, user_id, vod_id, tag) VALUES (?, ?, ?, ?)",
      args: [id, currentUser.id, vodId, tag],
    });

    return NextResponse.json({ success: true, tag });
  } catch (err: any) {
    return handleApiError("watch/tags/post", err, "Failed to add tag");
  }
}

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "tags_delete",
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
    const vodId = searchParams.get("vodId");
    const tag = searchParams.get("tag");

    if (!vodId || !tag) {
      return NextResponse.json({ error: "vodId and tag parameters required" }, { status: 400 });
    }

    const cleanVodId = vodId.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanTag = tag.trim().toLowerCase();

    const db = getDb();
    await db.execute({
      sql: "DELETE FROM vod_tags WHERE user_id = ? AND vod_id = ? AND tag = ?",
      args: [currentUser.id, cleanVodId, cleanTag],
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError("watch/tags/delete", err, "Failed to remove tag");
  }
}
