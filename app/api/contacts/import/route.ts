import { NextRequest, NextResponse } from "next/server";
import { importContactsCsv } from "@/lib/contactImport";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const csv = typeof body?.csv === "string" ? body.csv : "";
  const groupId = typeof body?.groupId === "string" ? body.groupId.trim() : null;

  try {
    const result = await importContactsCsv(csv, { groupId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed." },
      { status: 400 }
    );
  }
}