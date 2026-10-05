import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const [rows, campaignsRes] = await Promise.all([
    pool.query(
      `SELECT m.id::text, m.body, m.status, m.error_detail, m.send_at, m.sent_at,
              c.id::text AS contact_id, c.name AS contact_name, c.phone, c.opted_out,
              cm.id::text AS campaign_id, cm.name AS campaign_name,
              fu.position, fu.delay_days, fu.delay_hours,
              EXISTS (
                SELECT 1 FROM messages ib
                WHERE ib.contact_id = m.contact_id AND ib.campaign_id = m.campaign_id
                  AND ib.direction = 'inbound'
              ) AS contact_replied
       FROM messages m
       JOIN contacts c ON c.id = m.contact_id
       JOIN campaigns cm ON cm.id = m.campaign_id
       JOIN campaign_follow_ups fu ON fu.id = m.follow_up_id
       ORDER BY COALESCE(m.sent_at, m.send_at) DESC, m.send_at DESC`
    ),
    pool.query(
      `SELECT id::text, name FROM campaigns
       WHERE EXISTS (SELECT 1 FROM campaign_follow_ups fu WHERE fu.campaign_id = campaigns.id)
       ORDER BY created_at DESC`
    ),
  ]);

  return NextResponse.json({
    followUps: rows.rows,
    campaigns: campaignsRes.rows,
  });
}