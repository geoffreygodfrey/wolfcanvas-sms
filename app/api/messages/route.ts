import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendSms } from "@/lib/telnyx";
import { markPaced } from "@/lib/pump";

const MESSAGE_SELECT = `SELECT m.id, m.contact_id, m.direction, m.body, m.status, m.error_detail, m.sent_at,
    c.name AS contact_name, c.phone, c.opted_out,
    cm.name AS campaign_name, v.label AS variant_label
 FROM messages m
 LEFT JOIN contacts c ON c.id = m.contact_id
 LEFT JOIN campaigns cm ON cm.id = m.campaign_id
 LEFT JOIN campaign_variants v ON v.id = m.variant_id`;

function conditionsFor(params: string[], contact_id?: string, q?: string, direction?: string): string {
  const conditions: string[] = [];
  if (contact_id) {
    params.push(contact_id);
    conditions.push(`m.contact_id = $${params.length}`);
  }
  if (direction === "inbound" || direction === "outbound") {
    params.push(direction);
    conditions.push(`m.direction = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    conditions.push(`(c.name ILIKE $${idx} OR c.phone ILIKE $${idx} OR m.body ILIKE $${idx})`);
  }
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

export async function GET(req: NextRequest) {
  const contact_id = req.nextUrl.searchParams.get("contact_id")?.trim() || undefined;
  const q = req.nextUrl.searchParams.get("q")?.trim() || undefined;
  const direction = req.nextUrl.searchParams.get("direction")?.trim() || undefined;

  const params: string[] = [];
  const where = conditionsFor(params, contact_id, q, direction);

  // Thread view reads top-to-bottom; the full log lists newest first.
  const order = contact_id ? "ASC" : "DESC";
  const result = await pool.query(`${MESSAGE_SELECT} ${where} ORDER BY m.sent_at ${order} LIMIT 300`, params);

  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  const contact_id = payload?.contact_id as string | undefined;

  if (!contact_id || !text) {
    return NextResponse.json({ error: "contact_id and body are required." }, { status: 400 });
  }

  const contact = await pool.query(
    `SELECT id, name, phone, opted_out FROM contacts WHERE id = $1`,
    [contact_id]
  );
  if (contact.rowCount === 0) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  const c = contact.rows[0];
  if (c.opted_out) {
    return NextResponse.json({ error: "This contact has opted out and can't be messaged." }, { status: 400 });
  }

  // Reuse the contact's most recent campaign context so replies tie into stats.
  const lastCam = await pool.query(
    `SELECT campaign_id, variant_id FROM messages
     WHERE contact_id = $1 AND campaign_id IS NOT NULL
     ORDER BY sent_at DESC LIMIT 1`,
    [contact_id]
  );
  const { campaign_id = null, variant_id = null } = lastCam.rows[0] ?? {};

  const inserted = await pool.query(
    `INSERT INTO messages (contact_id, campaign_id, variant_id, direction, body)
     VALUES ($1, $2, $3, 'outbound', $4)
     RETURNING id, sent_at`,
    [contact_id, campaign_id, variant_id, text]
  );
  const messageId = inserted.rows[0].id;

  let status = "queued";
  let telnyx_message_id: string | null = null;
  let error_detail: string | null = null;

  try {
    const result = await sendSms(c.phone, text, { profileId: process.env.TELNYX_DEFAULT_PROFILE_ID });
    telnyx_message_id = result.id;
    status = "sent";
    await markPaced();
  } catch (err) {
    status = "failed";
    error_detail = err instanceof Error ? err.message : String(err);
  }

  await pool.query(
    `UPDATE messages SET status = $1, telnyx_message_id = $2, error_detail = $3 WHERE id = $4`,
    [status, telnyx_message_id, error_detail, messageId]
  );

  return NextResponse.json({
    id: messageId,
    contact_id,
    direction: "outbound",
    body: text,
    status,
    error_detail,
    sent_at: inserted.rows[0].sent_at,
    contact_name: c.name,
    phone: c.phone,
    opted_out: c.opted_out,
  });
}