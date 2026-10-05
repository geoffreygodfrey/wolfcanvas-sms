import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getOptOutStats, purgeOptedOut } from "@/lib/purge";

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await pool.connect();
  try {
    return NextResponse.json(await getOptOutStats(client));
  } finally {
    client.release();
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const client = await pool.connect();
  try {
    const result = await purgeOptedOut(client);
    return NextResponse.json(result);
  } finally {
    client.release();
  }
}