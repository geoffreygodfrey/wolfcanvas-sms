import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendSms } from "@/lib/telnyx";
import { markPaced } from "@/lib/pump";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const payload = await req.json().catch(() => ({}));
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";

  if (!body) {
    return NextResponse.json({ error: "body is required." }, { status: 400 });
  }

  const convRes = await pool.query(
    `SELECT conv.id, conv.campaign_id, conv.status,
            c.id AS contact_id, c.name AS contact_name, c.phone, c.opted_out
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     WHERE conv.id = $1`,
    [id]
  );
  const conv = convRes.rows[0];
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (conv.opted_out) {
    return NextResponse.json(
      { error: "This contact has opted out and can't be messaged." },
      { status: 400 }
    );
  }

  const inserted = await pool.query(
    `INSERT INTO messages (contact_id, campaign_id, direction, body)
     VALUES ($1, $2, 'outbound', $3)
     RETURNING id, sent_at`,
    [conv.contact_id, conv.campaign_id, body]
  );
  const messageId = inserted.rows[0].id;

  let status = "queued";
  let telnyx_message_id: string | null = null;
  let error_detail: string | null = null;

  try {
    const result = await sendSms(conv.phone, body);
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

  const msg = await pool.query(
    `INSERT INTO conversation_messages (conversation_id, message_id, role, content)
     VALUES ($1, $2, 'assistant', $3)
     RETURNING id, created_at`,
    [id, messageId, body]
  );

  // A human message pauses the AI agent if it was active, so it can't immediately
  // talk over the human. The contact's next inbound reply resumes it if re-enabled.
  if (conv.status === "ai_active") {
    await pool.query(
      `UPDATE conversations SET status = 'human_takeover', updated_at = now() WHERE id = $1`,
      [id]
    );
  } else {
    await pool.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [id]);
  }

  const row = msg.rows[0];

  return NextResponse.json(
    {
      id: row.id,
      conversation_id: id,
      message_id: messageId,
      role: "assistant",
      content: body,
      created_at: row.created_at,
      sms_status: status,
      contact_name: conv.contact_name,
      contact_phone: conv.phone,
    },
    { status: 201 }
  );
}
