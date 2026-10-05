import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const overallRes = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM contacts)                                    AS total_contacts,
      (SELECT COUNT(*)::int FROM contacts WHERE opted_out)                    AS opted_out,
      (SELECT COUNT(*)::int FROM contacts WHERE NOT opted_out)                AS active_contacts,
      (SELECT COUNT(*)::int FROM messages WHERE direction = 'outbound')       AS total_sent,
      (SELECT COUNT(*)::int FROM messages WHERE direction = 'outbound' AND status = 'delivered') AS delivered,
      (SELECT COUNT(*)::int FROM messages WHERE direction = 'outbound' AND status = 'failed')    AS failed,
      (SELECT COUNT(DISTINCT contact_id)::int FROM messages WHERE direction = 'inbound')         AS replied,
      (SELECT COUNT(*)::int FROM conversations WHERE qualified)               AS qualified,
      (SELECT COUNT(*)::int FROM appointments)                                AS booked,
      (SELECT COUNT(*)::int FROM campaigns)                                   AS total_campaigns,
      (SELECT COUNT(*)::int FROM appointments WHERE scheduled_at >= date_trunc('day', now()) AND status = 'confirmed') AS upcoming_bookings
  `);

  const [campaignsRes, variantsRes, bookingsRes] = await Promise.all([
    pool.query(`SELECT * FROM campaign_stats ORDER BY total_sent DESC`),
    pool.query(`SELECT * FROM variant_stats ORDER BY total_sent DESC`),
    pool.query(
      `SELECT a.id::text, a.scheduled_at, a.status, a.created_at,
              c.id::text AS contact_id, c.name AS contact_name, c.phone,
              cm.name AS campaign_name
       FROM appointments a
       JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN conversations conv ON conv.id = a.conversation_id
       LEFT JOIN campaigns cm ON cm.id = conv.campaign_id
       ORDER BY a.scheduled_at ASC`
    ),
  ]);

  return NextResponse.json({
    overall: overallRes.rows[0],
    campaigns: campaignsRes.rows,
    variants: variantsRes.rows,
    bookings: bookingsRes.rows,
  });
}