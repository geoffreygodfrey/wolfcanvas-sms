import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const VALID_STATUS = ["ai_active", "human_takeover", "closed"] as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const convRes = await pool.query(
    `SELECT
       conv.id,
       conv.contact_id,
       c.name AS contact_name,
       c.phone,
       c.email,
       c.opted_out,
       conv.campaign_id,
       camp.name AS campaign_name,
       conv.status,
       conv.qualified,
       conv.qualified_at,
       conv.created_at,
       conv.updated_at,
       (SELECT COUNT(*)::int FROM conversation_messages cm WHERE cm.conversation_id = conv.id) AS message_count
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     LEFT JOIN campaigns camp ON camp.id = conv.campaign_id
     WHERE conv.id = $1`,
    [id]
  );

  const conv = convRes.rows[0];
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const [messagesRes, apptsRes] = await Promise.all([
    pool.query(
      `SELECT cm.id, cm.role, cm.content, cm.created_at, cm.message_id,
              c.name AS contact_name, c.phone AS contact_phone
       FROM conversation_messages cm
       LEFT JOIN messages m ON m.id = cm.message_id
       LEFT JOIN contacts c ON c.id = m.contact_id
       WHERE cm.conversation_id = $1
       ORDER BY cm.created_at ASC`,
      [id]
    ),
    pool.query(
      `SELECT id, scheduled_at, status FROM appointments WHERE conversation_id = $1 ORDER BY scheduled_at ASC`,
      [id]
    ),
  ]);

  return NextResponse.json({
    ...conv,
    messages: messagesRes.rows,
    appointments: apptsRes.rows,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await req.json().catch(() => ({}));

  const existing = await pool.query(`SELECT status, qualified FROM conversations WHERE id = $1`, [id]);
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let newStatus: string | null = null;

  if (payload.status !== undefined) {
    if (!VALID_STATUS.includes(payload.status)) {
      return NextResponse.json(
        { error: `status must be one of ${VALID_STATUS.join(", ")}.` },
        { status: 400 }
      );
    }
    newStatus = payload.status;
    values.push(payload.status);
    sets.push(`status = $${values.length}`);
  }

  if (payload.qualified !== undefined) {
    if (typeof payload.qualified !== "boolean") {
      return NextResponse.json({ error: "qualified must be a boolean." }, { status: 400 });
    }
    values.push(payload.qualified);
    sets.push(`qualified = $${values.length}`);
    values.push(payload.qualified);
    sets.push(`qualified_at = CASE WHEN $${values.length} THEN COALESCE(qualified_at, now()) ELSE NULL END`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE conversations SET updated_at = now(), ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING id, status, qualified, qualified_at, updated_at`,
    values
  );

  const row = result.rows[0];

  if (newStatus === "human_takeover") {
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'system', 'A human has taken over this conversation. The AI agent is paused and will not send replies until handed back.')`,
      [id]
    );
  } else if (newStatus === "ai_active") {
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'system', 'The human handed this conversation back to the AI agent. AI replies are resumed.')`,
      [id]
    );
  }

  return NextResponse.json(row);
}
