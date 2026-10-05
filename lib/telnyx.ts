const TELNYX_API_URL = "https://api.telnyx.com/v2/messages";
const TELNYX_PROFILES_URL = "https://api.telnyx.com/v2/messaging_profiles";

export interface SendSmsResult {
  id: string | null;
  mode: "telnyx" | "console";
}

export interface SmsOptions {
  /** A Telnyx messaging profile (contains one or more numbers). When given,
   *  Telnyx picks which number in the profile handles the send. Falls back to
   *  TELNYX_DEFAULT_PROFILE_ID, then TELNYX_FROM_NUMBER. */
  profileId?: string | null;
}

/**
 * Send an SMS via Telnyx. If TELNYX_API_KEY is unset (or there is no profile or
 * from-number configured), logs the message to the console and returns a local
 * id so the rest of the flow still works in development.
 *
 * In production that fallback is refused: a console send would mark messages
 * `sent` while nothing actually leaves the app. Callers catch the throw and
 * record the message as `failed` with this error text.
 */
export async function sendSms(to: string, text: string, opts: SmsOptions = {}): Promise<SendSmsResult> {
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  const fromNumber = process.env.TELNYX_FROM_NUMBER?.trim();
  const profileId =
    opts.profileId?.trim() || process.env.TELNYX_DEFAULT_PROFILE_ID?.trim() || "";

  if (!apiKey || (!profileId && !fromNumber)) {
    if (process.env.NODE_ENV === "production") {
      const missing = !apiKey
        ? "TELNYX_API_KEY"
        : "TELNYX_DEFAULT_PROFILE_ID / TELNYX_FROM_NUMBER";
      throw new Error(
        `Telnyx not configured in production (${missing} missing) — refusing to mark a message sent without sending it`
      );
    }
    console.log(
      `[telnyx:console] to=${to} from=${fromNumber || "(unset)"} profile=${profileId || "(unset)"} text=${text}`
    );
    return { id: `local-${Date.now()}`, mode: "console" };
  }

  // Profile-based sends go through the messaging profile endpoint; Telnyx picks
  // a number from the profile automatically. Legacy single-number sends use /v2/messages.
  const url = profileId
    ? `${TELNYX_PROFILES_URL}/${encodeURIComponent(profileId)}/messages`
    : TELNYX_API_URL;
  const body = profileId ? { to, text } : { from: fromNumber, to, text };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Telnyx send failed (${res.status}): ${bodyText}`);
  }

  const json = await res.json();
  return { id: json?.data?.id ?? null, mode: "telnyx" };
}

export interface MessagingProfile {
  id: string;
  name: string;
}

/** Fetch the account's messaging profiles so the UI can let users pick which
 *  profile a campaign sends from. Empty when TELNYX_API_KEY is unset. */
export async function listMessagingProfiles(): Promise<MessagingProfile[]> {
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  if (!apiKey) return [];
  const res = await fetch(`${TELNYX_PROFILES_URL}?page[size]=100`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Telnyx profiles failed (${res.status})`);
  }
  const json = await res.json();
  return (json?.data ?? []).map((p: { id: string; name?: string }) => ({
    id: p.id,
    name: p.name || p.id,
  }));
}