import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query(
    `SELECT g.id, g.name, g.created_at,
       COUNT(m.contact_id)::int AS contact_count
     FROM contact_groups g
     LEFT JOIN contact_group_members m ON m.group_id = g.id
     GROUP BY g.id, g.name, g.created_at
     ORDER BY g.name`
  );
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO contact_groups (name) VALUES ($1) RETURNING id, name, created_at`,
      [name]
    );
    return NextResponse.json({ ...result.rows[0], contact_count: 0 }, { status: 201 });
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "A group with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create group." }, { status: 500 });
  }
}