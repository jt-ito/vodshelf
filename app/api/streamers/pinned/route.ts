import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getChannelMeta, getLiveStreams } from "@/lib/twitch/gql";
import { sanitizeLogin, sanitizeText, sanitizeUrl } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_pinned_get",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ streamers: [] });
    }

    const db = getDb();
    // Row-Level Security: enforce user_id parameterization
    const result = await db.execute({
      sql: `SELECT id, streamer_login, streamer_display_name, streamer_avatar_url, pinned_at,
                   COALESCE(group_name, 'General') as group_name,
                   COALESCE(is_hidden, 0) as is_hidden,
                   COALESCE(sort_order, 0) as sort_order
            FROM pinned_streamers 
            WHERE user_id = ? 
            ORDER BY sort_order ASC, pinned_at DESC`,
      args: [user.id],
    });

    const streamers = result.rows.map((row) => ({
      id: String(row.id),
      login: String(row.streamer_login || ""),
      displayName: String(row.streamer_display_name || ""),
      avatarUrl: String(row.streamer_avatar_url || ""),
      pinnedAt: row.pinned_at ? String(row.pinned_at) : undefined,
      groupName: (row.group_name as string) || "General",
      isHidden: Boolean(row.is_hidden),
      sortOrder: Number(row.sort_order || 0),
      isLive: false,
    }));

    const logins = streamers.map((s) => s.login);
    if (logins.length > 0) {
      try {
        const liveMap = await getLiveStreams(logins);
        for (const s of streamers) {
          if (liveMap[s.login.toLowerCase()]?.isLive) {
            s.isLive = true;
          }
        }
      } catch (liveErr) {
        console.warn("Failed to resolve live status for pinned streamers:", liveErr);
      }
    }

    return NextResponse.json({ streamers });
  } catch (err: any) {
    return handleApiError("streamers/pinned:GET", err, "Failed to fetch pinned streamers");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_pinned_post",
    maxRequests: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to pin streamers." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const cleanLogin = sanitizeLogin(body.login);

    if (!cleanLogin) {
      return NextResponse.json(
        { error: "Valid streamer login is required" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Row-Level Security: enforce user_id scope
    const existing = await db.execute({
      sql: "SELECT id FROM pinned_streamers WHERE user_id = ? AND streamer_login = ?",
      args: [user.id, cleanLogin],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({ message: "Streamer already pinned" });
    }

    let finalDisplayName = sanitizeText(body.displayName, 50);
    let finalAvatar = sanitizeUrl(body.avatarUrl, 500);
    const cleanGroup = sanitizeText(body.groupName, 30) || "General";

    let isLive = Boolean(body.isLive);
    if (!finalDisplayName || !finalAvatar) {
      const meta = await getChannelMeta(cleanLogin);
      if (meta) {
        finalDisplayName = finalDisplayName || meta.displayName;
        finalAvatar = finalAvatar || meta.profileImageURL;
        isLive = meta.isLive;
      }
    }

    if (!isLive) {
      try {
        const liveMap = await getLiveStreams([cleanLogin]);
        if (liveMap[cleanLogin]?.isLive) {
          isLive = true;
        }
      } catch {
        // Non-blocking
      }
    }

    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO pinned_streamers (id, user_id, streamer_login, streamer_display_name, streamer_avatar_url, group_name, is_hidden, sort_order) 
            VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      args: [id, user.id, cleanLogin, finalDisplayName || cleanLogin, finalAvatar || "", cleanGroup],
    });

    logger.info("Streamer pinned", { userId: user.id, streamer: cleanLogin, group: cleanGroup });

    return NextResponse.json({
      message: "Streamer pinned successfully",
      streamer: {
        id,
        login: cleanLogin,
        displayName: finalDisplayName || cleanLogin,
        avatarUrl: finalAvatar || "",
        groupName: cleanGroup,
        isHidden: false,
        sortOrder: 0,
        isLive,
      },
    });
  } catch (err: any) {
    if (err?.message && (err.message.includes("UNIQUE") || err.message.includes("SQLITE_CONSTRAINT"))) {
      return NextResponse.json({ message: "Streamer already pinned" });
    }
    return handleApiError("streamers/pinned:POST", err, "Failed to pin streamer");
  }
}

export async function PATCH(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_pinned_patch",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const db = getDb();

    // 1. Group rename action
    if (body.action === "renameGroup") {
      const oldGroup = sanitizeText(body.oldGroup, 30);
      const newGroup = sanitizeText(body.newGroup, 30);
      if (!oldGroup || !newGroup) {
        return NextResponse.json({ error: "Valid group names are required" }, { status: 400 });
      }

      await db.execute({
        sql: "UPDATE pinned_streamers SET group_name = ? WHERE user_id = ? AND group_name = ?",
        args: [newGroup, user.id, oldGroup],
      });

      return NextResponse.json({ message: "Group renamed successfully", oldGroup, newGroup });
    }

    // 2. Group delete action (reassign to "General")
    if (body.action === "deleteGroup") {
      const targetGroup = sanitizeText(body.groupName, 30);
      if (!targetGroup) {
        return NextResponse.json({ error: "Valid group name is required" }, { status: 400 });
      }

      await db.execute({
        sql: "UPDATE pinned_streamers SET group_name = 'General' WHERE user_id = ? AND group_name = ?",
        args: [user.id, targetGroup],
      });

      return NextResponse.json({ message: "Group deleted successfully", groupName: targetGroup });
    }

    // 3. Batch updates: { updates: [{ login, groupName?, isHidden?, sortOrder? }] }
    if (Array.isArray(body.updates)) {
      for (const item of body.updates) {
        const cleanLogin = sanitizeLogin(item.login);
        if (!cleanLogin) continue;

        const setClauses: string[] = [];
        const args: any[] = [];

        if (item.groupName !== undefined) {
          setClauses.push("group_name = ?");
          args.push(sanitizeText(item.groupName, 30) || "General");
        }
        if (item.isHidden !== undefined) {
          setClauses.push("is_hidden = ?");
          args.push(item.isHidden ? 1 : 0);
        }
        if (item.sortOrder !== undefined && typeof item.sortOrder === "number") {
          setClauses.push("sort_order = ?");
          args.push(Math.round(item.sortOrder));
        }

        if (setClauses.length > 0) {
          args.push(user.id, cleanLogin);
          await db.execute({
            sql: `UPDATE pinned_streamers SET ${setClauses.join(", ")} WHERE user_id = ? AND streamer_login = ?`,
            args,
          });
        }
      }

      return NextResponse.json({ message: "Batch updates applied successfully" });
    }

    // 4. Single creator update: { login, groupName?, isHidden?, sortOrder? }
    const cleanLogin = sanitizeLogin(body.login);
    if (!cleanLogin) {
      return NextResponse.json({ error: "Valid streamer login is required" }, { status: 400 });
    }

    const setClauses: string[] = [];
    const args: any[] = [];

    if (body.groupName !== undefined) {
      setClauses.push("group_name = ?");
      args.push(sanitizeText(body.groupName, 30) || "General");
    }
    if (body.isHidden !== undefined) {
      setClauses.push("is_hidden = ?");
      args.push(body.isHidden ? 1 : 0);
    }
    if (body.sortOrder !== undefined && typeof body.sortOrder === "number") {
      setClauses.push("sort_order = ?");
      args.push(Math.round(body.sortOrder));
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    args.push(user.id, cleanLogin);
    const updateResult = await db.execute({
      sql: `UPDATE pinned_streamers SET ${setClauses.join(", ")} WHERE user_id = ? AND streamer_login = ?`,
      args,
    });

    if (updateResult.rowsAffected === 0) {
      return NextResponse.json({ error: "Pinned streamer not found" }, { status: 404 });
    }

    logger.info("Streamer settings updated", { userId: user.id, streamer: cleanLogin });

    return NextResponse.json({
      message: "Streamer updated successfully",
      login: cleanLogin,
    });
  } catch (err: any) {
    return handleApiError("streamers/pinned:PATCH", err, "Failed to update pinned streamer");
  }
}

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "streamers_pinned_delete",
    maxRequests: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const cleanLogin = sanitizeLogin(searchParams.get("login"));

    if (!cleanLogin) {
      return NextResponse.json({ error: "Valid streamer login is required" }, { status: 400 });
    }

    const db = getDb();

    // Row-Level Security: enforce user_id scope
    const delResult = await db.execute({
      sql: "DELETE FROM pinned_streamers WHERE user_id = ? AND streamer_login = ?",
      args: [user.id, cleanLogin],
    });

    if (delResult.rowsAffected === 0) {
      return NextResponse.json({ error: "Pinned streamer not found" }, { status: 404 });
    }

    logger.info("Streamer unpinned", { userId: user.id, streamer: cleanLogin });

    return NextResponse.json({ message: "Streamer unpinned successfully", login: cleanLogin });
  } catch (err: any) {
    return handleApiError("streamers/pinned:DELETE", err, "Failed to unpin streamer");
  }
}
