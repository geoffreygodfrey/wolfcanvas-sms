# wolfcanvas — SMS Outreach

Contacts + Campaigns CRUD, A/B message variants with manual contact
assignment, Telnyx send + inbound webhook, and STOP/opt-out compliance —
backed by Postgres.

## Setup

1. Create a Postgres database and run `schema.sql` against it.
2. `cp .env.example .env` and set `DATABASE_URL`. Leave `TELNYX_API_KEY` /
   `TELNYX_FROM_NUMBER` blank for now — sends will log to the console
   instead of hitting the API until you set them.
3. `npm install`
4. `npm run dev` — runs at http://localhost:3000, redirects to `/contacts`.

## How a campaign works end to end

1. Add contacts (Contacts page) and create a campaign (Campaigns page).
2. Open the campaign's **Manage** page: add one or more message variants
   (each with its own text — use `{{name}}` to personalize).
3. Select contacts and assign each batch to a variant. Assignment is
   manual by design — there's no auto-split.
4. Hit **Send now**. Opted-out contacts are automatically skipped;
   unassigned contacts are automatically excluded (the send query only
   pulls rows with a variant set).
5. Replies land on `/api/webhooks/telnyx`: every inbound message is
   logged, and STOP-style replies opt the contact out immediately and
   fire a confirmation text — before any other logic (including a future
   AI agent) ever sees the message.

## What's here

- `app/login/page.tsx` — auth: first account is the admin, admins can invite members; every page + API is protected
- `app/forgot-password/page.tsx` + `app/reset-password/page.tsx` — password reset: signed 1-hour links emailed via `lib/mailer.ts` (Resend, or logged to the console in dev)
- `lib/mailer.ts` — password reset email delivery (Resend; falls back to a console log in dev)
- Contact groups: Contacts page has a group sidebar. Create a group (e.g. "Miami 1"), import a CSV into it, go inside a group to add new/existing contacts, select multiple to remove or delete, or delete the whole group (keeps the contacts themselves). Search is always global across all contacts; every contact lists the groups it belongs to as small labels, and Messages shows the group next to a contact's name.
- `app/dashboard/page.tsx` — analytics: delivery/reply/opt-out rates, qualified + booked counts, per-campaign and per-variant breakdowns, plus a **Bookings** section tracking every booked call with contact, campaign, time, and status
- `app/follow-ups/page.tsx` + `app/api/follow-ups` — follow-up tracker: every queued/sent/suppressed campaign follow-up (position, delay, contact, scheduled send, delivery status, suppression reason), filterable by campaign/status/search
- `app/api/campaigns/[...]/send` — queues follow-ups (linked via `messages.follow_up_id`) behind initial sends so they can be tracked end to end
- `app/contacts/page.tsx` — searchable contact table, contact **groups** (create, jump inside, add/remove members, bulk-select, delete group), CSV import (drag-and-drop or browse, saved to a group, with duplicate + bad-row reporting)
- `app/api/contacts/optouts` + `lib/purge.ts` — opt-out retention: opted-out contacts are permanently deleted (with their messages, conversations, and appointments) after `OPT_OUT_PURGE_DAYS` (default 30). The pump cleans up any past the window on each tick; Contacts shows a status banner with an admin "Purge now" button.
- `app/api/contact-groups/...` — group CRUD + member add/remove/bulk endpoints
- `lib/contactImport.ts` — shared CSV parsing + insert with duplicate/bad-row reporting
- `app/campaigns/page.tsx` — campaign table, add/edit, delete, links to detail
- `app/campaigns/[id]/page.tsx` — variants, manual contact assignment, send
- `app/messages/page.tsx` — WhatsApp-style threads (inbound + outbound) with reply composer; search finds contacts too so you can start a thread from scratch ("Message" on any contact does the same)
- `app/conversations/page.tsx` — Review: AI agent transcripts (per-campaign filters, qualified filter), manually mark qualified, take over a thread (pauses the AI) or hand it back, reply as a human, or close
- `app/api/webhooks/telnyx/route.ts` — Ed25519-signed inbound messages + delivery receipts + AI agent
- `lib/telnyx.ts` — isolated Telnyx client (dev-mode log fallback built in)
- `lib/agent.ts` — qualifying conversation agent over any OpenAI-compatible endpoint (Groq / Qwen / Ollama), with keyword-heuristic fallback
- `lib/db.ts` — shared Postgres connection pool

## Before going live

- **Webhook verification**: set `TELNYX_PUBLIC_KEY` (your account's base64 Ed25519 public key from
  Mission Control → Keys & Credentials). Requests without a valid signature are rejected with a 403.
- **Auth**: set a strong `AUTH_SECRET`, otherwise a dev default is used.
- Point your Telnyx Messaging Profile's webhook URL at
  `https://your-domain.com/api/webhooks/telnyx`.

## Not yet built

- Campaign scheduling UI for a scheduled time (min-delay pacing + business-hours windows are wired; a user-facing calendar picker is not).

Last open item: **none pending** — the conversation review UI (agent transcripts, qualified list, manual takeover) is now built on `/conversations`.
