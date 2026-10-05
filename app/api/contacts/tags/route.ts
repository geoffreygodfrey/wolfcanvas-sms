import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const contactIds: string[] = Array.isArray(body?.contactIds)
    ? body.contactIds.filter((c: unknown) => typeof c === "string")
    : [];
  const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
  const remove = body?.remove === true;

  if (contactIds.length === 0 || !tag) {
    return NextResponse.json({ error: "contactIds and tag are required." }, { status: 400 });
  }

  if (remove) {
    await pool.query(
      `UPDATE contacts SET tags = array_remove(tags, $1), updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [tag, contactIds]
    );
  } else {
    await pool.query(
      `UPDATE contacts
       SET tags = CASE WHEN $1 = ANY(tags) THEN tags ELSE array_append(tags, $1) END,
           updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [tag, contactIds]
    );
  }

  return NextResponse.json({ updated: contactIds.length, tag, removed: remove });
}