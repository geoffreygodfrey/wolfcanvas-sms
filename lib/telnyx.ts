const TELNYX_API_URL = "https://api.telnyx.com/v2/messages";
const TELNYX_PROFILES_URL = "https://api.telnyx.com/v2/messaging_profiles";

export interface SendSmsResult {
  id: string | null;
  mode: "telnyx" | "console";
}

export interface SmsOptions {
  /** A Telnyx messaging profile to tie the send to. Falls back to
   *  TELNYX_DEFAULT_PROFILE_ID when omitted. The sending number itself always
   *  comes from TELNYX_FROM_NUMBER. */
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

  // Every send goes through POST /v2/messages — Telnyx has no profile-scoped
  // send endpoint (asking for /v2/messaging_profiles/{id}/messages 404s with
  // code 10005). `from` picks the sending number; the profile id rides along
  // as messaging_profile_id so the send stays tied to the campaign's profile
  // (delivery webhooks resolve through the number's own profile association).
  const body: Record<string, string> = { to, text };
  if (fromNumber) body.from = fromNumber;
  if (profileId) body.messaging_profile_id = profileId;

  const res = await fetch(TELNYX_API_URL, {
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