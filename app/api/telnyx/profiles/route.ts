import { NextResponse } from "next/server";
import { listMessagingProfiles } from "@/lib/telnyx";

export async function GET() {
  try {
    const profiles = await listMessagingProfiles();
    return NextResponse.json({
      profiles,
      defaultProfileId: process.env.TELNYX_DEFAULT_PROFILE_ID?.trim() || null,
      hasApiKey: !!process.env.TELNYX_API_KEY?.trim(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        profiles: [],
        defaultProfileId: null,
        hasApiKey: !!process.env.TELNYX_API_KEY?.trim(),
        error: err instanceof Error ? err.message : "Failed to load Telnyx profiles.",
      },
      { status: 502 }
    );
  }
}