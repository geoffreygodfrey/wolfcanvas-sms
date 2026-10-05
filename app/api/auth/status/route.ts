import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
  return NextResponse.json({ hasUsers: result.rows[0].n > 0 });
}