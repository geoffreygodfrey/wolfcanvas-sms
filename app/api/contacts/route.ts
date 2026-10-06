import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { PHONE_E164_ERROR, toE164 } from "@/lib/phone";

const CONTACT_SELECT = `SELECT c.id, c.name, c.email, c.phone, c.consent_status, c.opted_out, c.tags, c.created_at,
  COALESCE((
    SELECT array_agg(g.name ORDER BY g.name)
    FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
    WHERE m.contact_id = c.id
  ), '{}') AS groups`;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const result = q
    ? await pool.query(
        `${CONTACT_SELECT}
         FROM contacts c
         WHERE c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1
         ORDER BY c.created_at DESC`,
        [`%${q}%`]
      )
    : await pool.query(`${CONTACT_SELECT} FROM contacts c ORDER BY c.created_at DESC`);

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, phone } = body;

  if (!name || !phone) {
    return NextResponse.json({ error: "Name and phone are required." }, { status: 400 });
  }

  const phoneE164 = toE164(phone);
  if (!phoneE164) {
    return NextResponse.json({ error: PHONE_E164_ERROR }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO contacts (name, email, phone)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, phone, consent_status, opted_out, created_at`,
      [name, email || null, phoneE164]
    );
    return NextResponse.json({ ...result.rows[0], groups: [] }, { status: 201 });
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "A contact with this phone number already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create contact." }, { status: 500 });
  }
}