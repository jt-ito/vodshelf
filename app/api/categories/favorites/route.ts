import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { sanitizeText, sanitizeUrl, validateCategoryName } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { handleApiError, rateLimitExceededResponse } from "@/lib/security/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "fav_categories_get",
    maxRequests: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ categories: [] });
    }

    const db = getDb();
    // Row-Level Security: strictly enforce authenticated user.id
    const result = await db.execute({
      sql: `SELECT id, category_name, box_art_url, created_at 
            FROM favorite_categories 
            WHERE user_id = ? 
            ORDER BY created_at DESC`,
      args: [user.id],
    });

    const categories = result.rows.map((row) => ({
      id: row.id,
      name: row.category_name,
      boxArtUrl: row.box_art_url,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ categories });
  } catch (err: any) {
    return handleApiError("categories/favorites:GET", err, "Failed to retrieve favorite categories");
  }
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "fav_categories_post",
    maxRequests: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.success) {
    return rateLimitExceededResponse(rate.reset);
  }

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized. Please sign in to favorite categories." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const catValidation = validateCategoryName(body.categoryName);

    if (!catValidation.isValid || !catValidation.value) {
      return NextResponse.json(
        { error: catValidation.error || "Valid category name is required" },
        { status: 400 }
      );
    }

    const cleanCategory = catValidation.value;
    const cleanBoxArt = sanitizeUrl(body.boxArtUrl, 500);

    const db = getDb();
    const id = randomUUID();

    // RLS: bind user.id
    await db.execute({
      sql: `INSERT INTO favorite_categories (id, user_id, category_name, box_art_url)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, category_name) DO UPDATE SET
              box_art_url = COALESCE(excluded.box_art_url, box_art_url)`,
      // NULL (not "") so the COALESCE above keeps existing art when a re-favorite sends none
      args: [id, user.id, cleanCategory, cleanBoxArt || null],
    });

    logger.info("Category favorited", { userId: user.id, category: cleanCategory });

    return NextResponse.json({
      message: `Added "${cleanCategory}" to favorites`,
      category: {
        id,
        name: cleanCategory,
        boxArtUrl: cleanBoxArt,
      },
    });
  } catch (err: any) {
    return handleApiError("categories/favorites:POST", err, "Failed to favorite category");
  }
}

export async function DELETE(req: NextRequest) {
  const rate = checkRateLimit(req, {
    prefix: "fav_categories_delete",
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
    let rawCategory = searchParams.get("categoryName") || searchParams.get("name");
    
    if (!rawCategory) {
      try {
        const body = await req.json();
        rawCategory = body?.categoryName || body?.name;
      } catch {
        // No body provided
      }
    }

    const cleanCategory = sanitizeText(rawCategory, 100);

    if (!cleanCategory) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }

    const db = getDb();
    const delResult = await db.execute({
      sql: "DELETE FROM favorite_categories WHERE user_id = ? AND LOWER(category_name) = LOWER(?)",
      args: [user.id, cleanCategory],
    });

    if (delResult.rowsAffected === 0) {
      return NextResponse.json({ error: "Favorite category not found" }, { status: 404 });
    }

    logger.info("Category unfavorited", { userId: user.id, category: cleanCategory });

    return NextResponse.json({
      message: `Removed "${cleanCategory}" from favorites`,
      categoryName: cleanCategory,
    });
  } catch (err: any) {
    return handleApiError("categories/favorites:DELETE", err, "Failed to remove favorite category");
  }
}
