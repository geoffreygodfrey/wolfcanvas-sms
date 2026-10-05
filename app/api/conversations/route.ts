import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: NextRequest) {
  const campaign_id = req.nextUrl.searchParams.get("campaign_id")?.trim() || undefined;
  const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;
  const qualifiedParam = req.nextUrl.searchParams.get("qualified")?.trim();
  const q = req.nextUrl.searchParams.get("q")?.trim() || undefined;

  const conditions: string[] = [];
  const params: string[] = [];

  if (campaign_id) {
    params.push(campaign_id);
    conditions.push(`conv.campaign_id = $${params.length}`);
  }
  if (status === "ai_active" || status === "human_takeover" || status === "closed") {
    params.push(status);
    conditions.push(`conv.status = $${params.length}`);
  }
  if (qualifiedParam === "1" || qualifiedParam === "true") {
    conditions.push(`conv.qualified = true`);
  } else if (qualifiedParam === "0" || qualifiedParam === "false") {
    conditions.push(`conv.qualified = false`);
  }
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    conditions.push(`(c.name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT
       conv.id,
       conv.contact_id,
       c.name AS contact_name,
       c.phone,
       c.opted_out,
       conv.campaign_id,
       camp.name AS campaign_name,
       conv.status,
       conv.qualified,
       conv.qualified_at,
       conv.created_at,
       conv.updated_at,
       (SELECT COUNT(*)::int FROM conversation_messages cm WHERE cm.conversation_id = conv.id) AS message_count,
       (SELECT cm.content FROM conversation_messages cm
         WHERE cm.conversation_id = conv.id AND cm.role IN ('user','assistant')
         ORDER BY cm.created_at DESC LIMIT 1) AS last_message,
       (SELECT cm.role FROM conversation_messages cm
         WHERE cm.conversation_id = conv.id AND cm.role IN ('user','assistant')
         ORDER BY cm.created_at DESC LIMIT 1) AS last_role,
       (SELECT MAX(cm.created_at) FROM conversation_messages cm
         WHERE cm.conversation_id = conv.id) AS last_message_at,
       (SELECT COUNT(*)::int FROM appointments a WHERE a.conversation_id = conv.id) AS appointment_count
     FROM conversations conv
     JOIN contacts c ON c.id = conv.contact_id
     LEFT JOIN campaigns camp ON camp.id = conv.campaign_id
     ${where}
     ORDER BY conv.updated_at DESC
     LIMIT 300`,
    params
  );

  const rows = result.rows.map((r) => ({
    ...r,
    last_direction: r.last_role === "user" ? "inbound" : r.last_role === "assistant" ? "outbound" : null,
  }));

  return NextResponse.json(rows);
}
