import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const CONTACT_SELECT = `SELECT c.id, c.name, c.email, c.phone, c.consent_status, c.opted_out, c.tags, c.created_at,
  COALESCE((
    SELECT array_agg(g.name ORDER BY g.name)
    FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
    WHERE m.contact_id = c.id
  ), '{}') AS groups`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = req.nextUrl.searchParams.get("q")?.trim();

  let result;
  if (q) {
    result = await pool.query(
      `${CONTACT_SELECT} FROM contacts c
       WHERE EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id AND m.group_id = $1)
         AND (c.name ILIKE $2 OR c.phone ILIKE $2 OR c.email ILIKE $2)
       ORDER BY c.name`,
      [id, `%${q}%`]
    );
  } else {
    result = await pool.query(
      `${CONTACT_SELECT} FROM contacts c
       JOIN contact_group_members m ON m.contact_id = c.id AND m.group_id = $1
       ORDER BY c.name`,
      [id]
    );
  }

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const group = await pool.query(`SELECT id FROM contact_groups WHERE id = $1`, [id]);
  if (group.rowCount === 0) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  let added = 0;

  const contactIds: string[] = Array.isArray(body?.contact_ids)
    ? body.contact_ids.filter((c: unknown) => typeof c === "string")
    : [];
  for (const cid of contactIds) {
    const res = await pool.query(
      `INSERT INTO contact_group_members (group_id, contact_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, cid]
    );
    if (res.rowCount === 1) added++;
  }

  const contact = body?.contact;
  if (contact && typeof contact.name === "string" && typeof contact.phone === "string") {
    try {
      const created = await pool.query(
        `INSERT INTO contacts (name, email, phone)
         VALUES ($1, $2, $3) RETURNING id`,
        [contact.name.trim(), contact.email?.trim() || null, contact.phone.trim()]
      );
      await pool.query(
        `INSERT INTO contact_group_members (group_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, created.rows[0].id]
      );
      added++;
    } catch {
      /* duplicate phone etc. — treat as add-only; parent contact wins */
    }
  }

  return NextResponse.json({ added });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const contactIds: string[] = Array.isArray(body?.contact_ids)
    ? body.contact_ids.filter((c: unknown) => typeof c === "string")
    : [];

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "No contacts selected." }, { status: 400 });
  }

  const removed = await pool.query(
    `DELETE FROM contact_group_members
     WHERE group_id = $1 AND contact_id = ANY($2::uuid[])`,
    [id, contactIds]
  );

  return NextResponse.json({ removed: removed.rowCount ?? 0 });
}