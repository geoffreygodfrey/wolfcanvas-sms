import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendSms } from "@/lib/telnyx";
import { markPaced } from "@/lib/pump";
import { decideReply, classifyScenario, suggestAppointment, type AgentMessage } from "@/lib/agent";
import { matchScenario, fillTemplate, type ScenarioRow, type ScenarioAction } from "@/lib/scenarios";
import { verifyTelnyxWebhook } from "@/lib/telnyxWebhooks";

const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|quit|opt\s*out|arrêt|no\s+more)\b/i;

const CONFIRMATION_TEXT =
  "You've been unsubscribed from SMS updates. You won't receive any more texts from us. Reply HELP if this was a mistake.";

/** Terminal states that mean the message never reached the handset. */
const UNDELIVERED = new Set(["failed", "expired", "cancelled"]);

/**
 * Map a delivery-status event to our messages.status + error_detail.
 * Current Telnyx sends terminal states as `message.finalized` carrying
 * payload.status (delivered | failed | expired | cancelled | …); older
 * payloads used message.sent / message.delivered / message.failed directly.
 * Returns null when the event doesn't describe a status change.
 */
function statusUpdateFromEvent(
  eventType: string,
  payload: any
): { status: string; error: string | null } | null {
  let status: string;
  if (eventType === "message.finalized") {
    // Real finalized payloads are the message record itself and carry no
    // top-level `status` — the terminal state sits per-recipient at
    // to[].status ("delivered" | "failed" | …). payload.status stays as a
    // fallback for payloads that do include it.
    status = String(payload?.status ?? payload?.to?.[0]?.status ?? "");
  } else if (
    eventType === "message.sent" ||
    eventType === "message.delivered" ||
    eventType === "message.failed"
  ) {
    status = eventType.slice("message.".length);
  } else {
    return null;
  }

  if (status === "sent" || status === "delivered") return { status, error: null };
  if (UNDELIVERED.has(status)) {
    return { status: "failed", error: payload?.errors?.[0]?.title ?? `Delivery ${status}` };
  }
  return null;
}

function inboundNumber(payload: any): string | null {
  const from = payload?.from;
  if (!from) return null;
  if (typeof from === "string") return from;
  return from.phone_number ?? from.phoneNumber ?? from.id ?? null;
}

// Send an agent/scenario outbound and log it to the conversation.
async function sendAgentMessage(opts: {
  phone: string;
  contactId: string;
  campaignId: string;
  conversationId: string;
  body: string;
}) {
  let telnyxId: string | null = null;
  let status = "sent";
  let errorDetail: string | null = null;
  try {
    const sent = await sendSms(opts.phone, opts.body);
    telnyxId = sent.id ?? null;
    await markPaced();
  } catch (err) {
    status = "failed";
    errorDetail = err instanceof Error ? err.message : String(err);
    console.warn("[agent] failed to send reply:", err);
  }
  const outbound = await pool.query(
    `INSERT INTO messages (contact_id, campaign_id, direction, body, telnyx_message_id, status, error_detail)
     VALUES ($1, $2, 'outbound', $3, $4, $5, $6)
     RETURNING id`,
    [opts.contactId, opts.campaignId, opts.body, telnyxId, status, errorDetail]
  );
  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, message_id, role, content)
     VALUES ($1, $2, 'assistant', $3)`,
    [opts.conversationId, outbound.rows[0].id, opts.body]
  );
}

// Record an appointment locally when the prospect green-lights a time.
async function bookAppointment(opts: {
  contactId: string;
  contactName: string;
  conversationId: string;
  whenIso: string;
}) {
  await pool.query(
    `INSERT INTO appointments (contact_id, conversation_id, scheduled_at, status)
     VALUES ($1, $2, $3, 'confirmed')`,
    [opts.contactId, opts.conversationId, opts.whenIso]
  );
}

// Runs the reply engine for a message that lands on an ai_enabled campaign.
// STOP messages never reach this — they short-circuit earlier.
//
// If the campaign has scenarios configured, those are the ONLY approved
// responses: keyword match first, then (optionally) the AI picks which
// scenario fits. The AI never writes copy and never books on its own.
// Campaigns with zero scenarios fall back to the legacy free-form agent.
async function maybeRunAgent(opts: {
  contactId: string;
  contactName: string;
  phone: string;
  inboundMessageId: string;
  latestText: string;
}) {
  const { contactId, contactName, phone, inboundMessageId, latestText } = opts;

  // Most recent outbound message on an AI-enabled campaign for this contact —
  // that's the campaign context the reply belongs to.
  const campaignRes = await pool.query(
    `SELECT c.id AS campaign_id, c.ai_system_prompt
     FROM messages m
     JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.contact_id = $1 AND m.direction = 'outbound' AND c.ai_enabled = true
     ORDER BY m.sent_at DESC
     LIMIT 1`,
    [contactId]
  );
  const campaign = campaignRes.rows[0];
  if (!campaign) return;

  // Reuse an open conversation for this contact + campaign, else start one.
  const existing = await pool.query(
    `SELECT id, status FROM conversations
     WHERE contact_id = $1 AND campaign_id = $2 AND status != 'closed'
     ORDER BY updated_at DESC LIMIT 1`,
    [contactId, campaign.campaign_id]
  );

  let conversationId = existing.rows[0]?.id;
  if (!conversationId) {
    const created = await pool.query(
      `INSERT INTO conversations (contact_id, campaign_id, status)
       VALUES ($1, $2, 'ai_active')
       RETURNING id`,
      [contactId, campaign.campaign_id]
    );
    conversationId = created.rows[0].id;
  } else if (existing.rows[0].status === "human_takeover") {
    // A human owns this thread. Record the inbound message but leave the AI
    // paused — the human sees it and responds (or hands it back) in Review.
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, message_id, role, content)
       VALUES ($1, $2, 'user', $3)`,
      [conversationId, inboundMessageId, latestText]
    );
    await pool.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
    return;
  }

  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, message_id, role, content)
     VALUES ($1, $2, 'user', $3)`,
    [conversationId, inboundMessageId, latestText]
  );

  const historyRes = await pool.query(
    `SELECT role, content FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC LIMIT 24`,
    [conversationId]
  );

  const scenariosRes = await pool.query(
    `SELECT id, campaign_id, label, keywords, reply_template, action, priority, enabled
     FROM campaign_scenarios
     WHERE campaign_id = $1 AND enabled = true`,
    [campaign.campaign_id]
  );
  const scenarios = scenariosRes.rows as ScenarioRow[];

  if (scenarios.length > 0) {
    let match = matchScenario(latestText, scenarios);
    if (!match) {
      const label = await classifyScenario({
        inboundText: latestText,
        history: historyRes.rows as AgentMessage[],
        scenarios,
      });
      if (label) match = scenarios.find((s) => s.label === label) ?? null;
    }

    // Nothing fits (and the AI couldn't route it) — stay silent rather than improvise.
    if (!match || match.action === "none") return;

    const body = fillTemplate(match.reply_template, contactName).trim();
    if (!body) return;

    if (match.action === "opt_out") {
      await pool.query(
        `UPDATE contacts SET opted_out = true, opted_out_at = now(), consent_status = 'opted_out',
           tags = CASE WHEN $2 = ANY(tags) THEN tags ELSE array_append(tags, $2) END
         WHERE id = $1`,
        [contactId, "Awaiting deletion"]
      );
      await pool.query(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [conversationId]);
    }

    await sendAgentMessage({
      phone,
      contactId,
      campaignId: campaign.campaign_id,
      conversationId,
      body,
    });

    if (match.action === "book") {
      await pool.query(
        `UPDATE conversations SET qualified = true, qualified_at = COALESCE(qualified_at, now())
         WHERE id = $1`,
        [conversationId]
      );
      // Book only when the prospect actually named a time we can parse.
      const whenIso = suggestAppointment(latestText);
      if (whenIso) {
        await bookAppointment({ contactId, contactName, conversationId, whenIso });
      }
    }
    return;
  }

  // Legacy free-form agent — only for campaigns with no scenarios configured.
  const decision = await decideReply({
    systemPrompt: campaign.ai_system_prompt,
    contactName,
    history: historyRes.rows as AgentMessage[],
  });

  if (decision.reply) {
    await sendAgentMessage({
      phone,
      contactId,
      campaignId: campaign.campaign_id,
      conversationId,
      body: decision.reply,
    });
  }

  if (decision.qualified) {
    await pool.query(
      `UPDATE conversations SET qualified = true, qualified_at = COALESCE(qualified_at, now())
       WHERE id = $1`,
      [conversationId]
    );
  }

  if (decision.appointmentAt) {
    await bookAppointment({
      contactId,
      contactName,
      conversationId,
      whenIso: decision.appointmentAt,
    });
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const checked = verifyTelnyxWebhook({
    rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
  });
  if (!checked.valid) {
    console.warn(`[webhook] rejected unverified request: ${checked.reason}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = JSON.parse(rawBody);
  const data = body?.data ?? body ?? {};
  const eventType = data.event_type;
  const payload = data.payload ?? {};

  // Delivery receipts: message.finalized (current) / message.sent / legacy names.
  const statusUpdate = statusUpdateFromEvent(eventType, payload);
  if (statusUpdate) {
    await pool.query(
      `UPDATE messages SET status = $1, error_detail = $2 WHERE telnyx_message_id = $3`,
      [statusUpdate.status, statusUpdate.error, payload.id ?? null]
    );
    return NextResponse.json({ ok: true });
  }

  // Inbound message. STOP-style replies opt the contact out immediately and
  // fire a confirmation text, before anything else sees the message.
  if (eventType === "message.received") {
    const phone = inboundNumber(payload);
    const text = payload.text ?? "";

    if (!phone) {
      return NextResponse.json({ ok: true, ignored: "no sender number" });
    }

    const contact = await pool.query(
      `SELECT id, name, opted_out FROM contacts WHERE phone = $1`,
      [phone]
    );
    if (contact.rowCount === 0) {
      console.warn(`[webhook] inbound message from unknown number ${phone}; skipped`);
      return NextResponse.json({ ok: true, ignored: "unknown contact" });
    }

    const contactId = contact.rows[0].id;
    const telnyxMessageId = payload.id ?? null;
    const isStop = STOP_RE.test(text);

    if (isStop) {
      await pool.query(
        `UPDATE contacts SET opted_out = true, opted_out_at = now(), consent_status = 'opted_out',
           tags = CASE WHEN $2 = ANY(tags) THEN tags ELSE array_append(tags, $2) END
         WHERE id = $1`,
        [contactId, "Awaiting deletion"]
      );
      try {
        await sendSms(phone, CONFIRMATION_TEXT);
        await markPaced();
      } catch (err) {
        console.warn("[webhook] failed to send opt-out confirmation:", err);
      }
    }

    const inbound = await pool.query(
      `INSERT INTO messages (contact_id, direction, body, telnyx_message_id, status)
       VALUES ($1, 'inbound', $2, $3, 'received')
       RETURNING id`,
      [contactId, text, telnyxMessageId]
    );

    // STOP messages short-circuit the AI agent. Already-opted-out contacts
    // are also skipped — no need to keep replying.
    if (!isStop && !contact.rows[0].opted_out) {
      await maybeRunAgent({
        contactId,
        contactName: contact.rows[0].name,
        phone,
        inboundMessageId: inbound.rows[0].id,
        latestText: text,
      });
    }

    return NextResponse.json({ ok: true });
  }

  // Any other event (status callbacks, errors, etc.) — acknowledge.
  return NextResponse.json({ ok: true });
}