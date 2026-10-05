import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE contact_groups SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
      [name, id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "A group with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to rename group." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`DELETE FROM contact_groups WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}