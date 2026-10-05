import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const ALLOWED = new Set(["opted_in", "opted_out"]);

/** Bulk-set consent status for selected contacts. Marking opted-out also flips
 *  opted_out on (matches webhook semantics); opting in clears it. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = body.ids;
  const status: string | undefined = body.status;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Select at least one contact." }, { status: 400 });
  }
  if (typeof status !== "string" || !ALLOWED.has(status)) {
    return NextResponse.json({ error: "status must be 'opted_in' or 'opted_out'." }, { status: 400 });
  }

  const result = await pool.query(
    `UPDATE contacts SET
       consent_status = $1,
       opted_out = $2,
       opted_out_at = CASE WHEN $2 THEN now() ELSE opted_out_at END,
       updated_at = now()
     WHERE id = ANY($3::uuid[])`,
    [status, status === "opted_out", ids]
  );

  return NextResponse.json({ updated: result.rowCount ?? 0, status });
}