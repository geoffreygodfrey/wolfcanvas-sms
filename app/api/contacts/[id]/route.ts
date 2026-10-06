import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { PHONE_E164_ERROR, toE164 } from "@/lib/phone";

const CONTACT_SELECT = `SELECT c.id, c.name, c.email, c.phone, c.consent_status, c.opted_out, c.tags, c.created_at,
  COALESCE((
    SELECT array_agg(g.name ORDER BY g.name)
    FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
    WHERE m.contact_id = c.id
  ), '{}') AS groups`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`${CONTACT_SELECT} FROM contacts c WHERE c.id = $1`, [id]);
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  return NextResponse.json(result.rows[0]);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, email, phone } = body;
  const consent = body.consent_status;

  const phoneE164 = toE164(phone);
  if (!phoneE164) {
    return NextResponse.json({ error: PHONE_E164_ERROR }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE contacts SET name = $1, email = $2, phone = $3,
         consent_status = CASE
           WHEN $4 IN ('opted_in','opted_out') THEN $4
           ELSE consent_status END,
         opted_out = CASE
           WHEN $4 = 'opted_out' THEN true
           WHEN $4 = 'opted_in' THEN false
           ELSE opted_out END,
         opted_out_at = CASE WHEN $4 = 'opted_out' THEN now() ELSE opted_out_at END,
         updated_at = now()
       WHERE id = $5
       RETURNING id, name, email, phone, consent_status, opted_out, created_at`,
      [name, email || null, phoneE164, consent || null, id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }
    return NextResponse.json({ ...result.rows[0], groups: [] });
  } catch (err: any) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "A contact with this phone number already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update contact." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await pool.query(`DELETE FROM contacts WHERE id = $1`, [id]);

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}