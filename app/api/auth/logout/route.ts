import { NextResponse } from "next/server";
import { sessionCookieConfig, sessionCookieName } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, "", { ...sessionCookieConfig(), maxAge: 0 });
  return res;
}