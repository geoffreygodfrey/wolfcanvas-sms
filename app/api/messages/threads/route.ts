import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const params: string[] = [];
  let filter = ``;

  if (q) {
    params.push(`%${q}%`);
    filter = `
      WHERE c.id IN (
        SELECT mi.contact_id FROM messages mi
        JOIN contacts ci ON ci.id = mi.contact_id
        WHERE ci.name ILIKE $1 OR ci.phone ILIKE $1 OR mi.body ILIKE $1
      )`;
  }

  const result = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.id)
         c.id AS contact_id,
         c.name,
         c.phone,
         c.opted_out,
         m.body AS last_message,
         m.direction AS last_direction,
         m.status AS last_status,
         m.sent_at AS last_message_at,
         (SELECT COUNT(*) FROM messages mi
           WHERE mi.contact_id = c.id AND mi.direction = 'inbound')::int AS inbound_count,
         COALESCE((
           SELECT array_agg(g.name ORDER BY g.name)
           FROM contact_group_members mg JOIN contact_groups g ON g.id = mg.group_id
           WHERE mg.contact_id = c.id
         ), '{}') AS groups
       FROM messages m
       JOIN contacts c ON c.id = m.contact_id
       ${filter}
       ORDER BY c.id, m.sent_at DESC
     ) threads
     ORDER BY threads.last_message_at DESC`,
    params
  );

  return NextResponse.json(result.rows);
}