# Deploying wolfcanvas on the $0 stack

Target: **Vercel Hobby (free) + Supabase free + cron-job.org (free)**. No VPS, no Docker.

Sized for your real volume — 30–500 texts/day at a human-looking 1–3/min, never a burst.

---

## 0. What runs where

| Piece | Host | Cost |
|---|---|---|
| Next.js app (UI + API + pump endpoint) | Vercel Hobby | $0 |
| Postgres database | Supabase free | $0 |
| 1-minute ticker that calls the pump | cron-job.org | $0 |
| Custom domain for phone-browser login | your registrar (e.g. Cloudflare, Namecheap) | ~$10/yr |

The pump (`POST /api/queue/pump`) is designed as a *bounded mini-worker*: each
invocation sends what it can while waiting out the per-campaign pace floor
between sends, then hands control back after ~55s. The 1-minute cron calls it
again, so pacing stays exactly what you set in the campaign Scheduler UI
(20–30s default, 60–90s during Telnyx number warm-up) — nothing can burst.

---

## 1. Supabase — the database

1. Go to https://supabase.com → *New project* (free tier). Pick the region
   **`us-east-1` (East US, N. Virginia)**. The criterion is *app ↔ database*
   latency, not Telnyx: Vercel functions run in `iad1` (Washington D.C., which
   is AWS `us-east-1`), so pairing the DB with `us-east-1` keeps every query a
   few ms away. (`ca-central-1` / Montreal also works if you want Canadian data
   residency — a few ms further; avoid `us-west-*`, which is ~3,000 km from
   your functions.)
2. In **Project Settings → Database → Connection string**, copy the
   **Session pooler** URL — the one on port **5432**, which looks like:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`

   ⚠️ **Use the Session pooler, NOT the Transaction pooler.** wolfcanvas's
   no-burst guarantee is a Postgres *session-level* advisory lock
   (`pg_try_advisory_lock`, see `lib/pump.ts`) that serialises the pump across
   the web app, the cron endpoint, and any worker. Supabase's Transaction
   pooler (port 6543) is PgBouncer in *transaction* mode: it hands out a
   different backend connection per query and releases session-level advisory
   locks when a connection returns to the pool. On that pooler the lock is
   gone immediately, two pumps can send at once, and you get exactly the burst
   sending this app is built to prevent. Session mode keeps one backend
   connection for the entire pump run.

   (The direct connection string on port 5432 — `db.<ref>.supabase.co` — is
   also fine and equally lock-safe, just less pooling.)
3. **Create the schema.** In the Supabase SQL editor, open the file
   `schema.sql` from this repo, paste the whole thing, and click **Run**. It's
   written for a **brand-new project**: plain `CREATE TABLE` statements, so run
   it once. (It is intentionally *not* idempotent — re-running against a
   populated database errors with "relation already exists". If you ever need a
   clean re-run, just create a fresh Supabase project rather than dropping
   tables.)
4. The database is ready. Every migration used while building this app is
   captured in `schema.sql` — timezone/window columns, `daily_cap`,
   `daily_budget`, `telnyx_profile_id`, `send_pace`, `auth_attempts`,
   `pump_health`, scenarios, everything. A fresh project gets it all in one
   paste.

## 2. Vercel — the app

1. **Put the repo on GitHub.** The repo is already `git init`-ed here and
   `.gitignore` is in place — just verify, commit, and push:

   ```bash
   git status          # confirm NO .env and NO backups\*.sql files are listed
   git add .
   git commit -m "wolfcanvas"
   ```

   `.gitignore` excludes `.env`, `/backups/`, `node_modules`, and `.next` —
   those contain your DB password, secrets, and full data dumps, so double-check
   `git status` before committing. Then create an empty repo on GitHub and:

   ```bash
   git remote add origin https://github.com/geoffreygodfrey/wolfcanvas-sms.git
   git branch -M main
   git push -u origin main
   ```

2. In Vercel: *Add New → Project → Import* the repo you just pushed.
3. Framework preset: **Next.js** (auto-detected). Keep the default build
   command (`next build`) and output settings — there's nothing to override.
4. **Environment variables** (Project → Settings → Environment Variables), for
   Production (and Preview if you want):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | your Supabase **Session pooler** URL from section 1, step 2 |
   | `AUTH_SECRET` | long random 32-byte string (see the generator below) |
   | `CRON_SECRET` | a *different* long random string — the pump's password |
   | `TELNYX_API_KEY` | your Telnyx API key (v2) |
   | `TELNYX_FROM_NUMBER` | your default sending number in E.164, e.g. `+15145551234` |
   | `TELNYX_DEFAULT_PROFILE_ID` | (optional) a messaging profile id to send from by default |
   | `TELNYX_PUBLIC_KEY` | **recommended** — base64 Ed25519 key from Mission Control → Keys & Credentials; verifies inbound webhook signatures (blank = signature checks skipped, so anyone could spoof a STOP) |
   | `RESEND_API_KEY` | **recommended** — sends password-reset emails *and* the failed-send/pump alerts |
   | `MAIL_FROM` | **recommended** — sender address for those emails |
   | `GROQ_API_KEY` | needed **only** for campaign AI replies |
   | `LLM_MODEL` | `qwen/qwen3.8-27b` (Groq) — any Groq model ID works |

   `CRON_SECRET` is what cron-job.org must send as a bearer token. If it is
   missing, the pump endpoint runs *unguarded* — do not ship production without
   it.

   **Generating the secrets** (run it twice, keep the two values different):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Node is already installed if you've run this app locally, and it works on
   Windows, macOS, and Linux alike. (`openssl rand -base64 32` does the same,
   but stock Windows 10 has no `openssl`.) `AUTH_SECRET` must be at least 24
   characters — production refuses to start without it.
5. Deploy. First deploy takes a minute; verify at `https://<project>.vercel.app/login`.
6. **Custom domain**: Vercel Hobby supports custom domains free. In
   Project → Settings → Domains, add e.g. `app.yourdomain.com`, then add the
   `CNAME` record Vercel gives you at your registrar (Cloudflare/Namecheap).
   Use this domain for phone-browser login.

## 2b. Telnyx — number, profile, webhook

Nothing can send until three things are linked: **number → messaging profile →
webhook URL**. All configured in Mission Control (https://portal.telnyx.com):

1. **Get a number** (skip if you already own one):
   - *Real-Time Communication → Numbers → Buy Numbers* (or the *Search & Buy
     Numbers* button on the *My Numbers* page).
   - Country **Canada** · Features **SMS** (not every number has SMS) · Type
     **Local**. Canadian long codes are messaging-ready immediately — no 10DLC
     registration, which is why this stack works for a Canada-first client base.
   - Search by area code or city → *Add to Cart* → *Place Order*.
     Canadian local numbers start around $1/month.
2. **Copy the number in E.164** from *Numbers → My Numbers*: `+1` + 10 digits,
   no spaces or dashes — e.g. `+14035551234`. That exact string is your
   `TELNYX_FROM_NUMBER`.
3. **Create a messaging profile** — *Messaging → Messaging Profiles → Add*.
   Copy its UUID → that's `TELNYX_DEFAULT_PROFILE_ID`. (A campaign's Scheduler
   panel can override it with a per-campaign profile.)
4. **Set the profile's Webhook URL** — this is the only path for replies, STOP
   opt-outs, and delivery receipts back into the app:
   `https://<your-domain>/api/webhooks/telnyx`
   (switch it to your custom domain once §2 step 6 is done.) Without it you can
   still *send*, but replies never appear, STOP doesn't register, and
   delivered/failed statuses never update.
5. **Assign the number to that profile** (*My Numbers* → the number → routing /
   messaging profile). A number with no profile cannot send at all.

Sanity check for the whole chain: profile page shows a webhook URL, number
appears in the profile's number list, `TELNYX_FROM_NUMBER` matches that number
exactly (E.164).

## 3. cron-job.org — the ticker

The app has **no** built-in server-side cron: serverless boxes sleep between
requests. You need an external caller hitting the pump every minute.

1. Create an account at https://cron-job.org (free). You need **exactly one
   job, forever** — see the note below.
2. **New job:**
   - URL: `https://<your-project>.vercel.app/api/queue/pump`
   - Method: `POST`
   - Headers: `Authorization: Bearer <CRON_SECRET>` (the same value you set in
     Vercel)
   - Schedule: **every minute** — i.e. cron expression `* * * * *` or the
     builder set to "1 minute"
   - Save, then hit the *Run now* button to test.
3. Verify a run reports `{"sent":N,"pending":true/false}` and that a test
   campaign with a queued message actually goes out.

**Tuning knobs:** the endpoint accepts optional query params —
`?cap=100` (max sends per invocation) and `?runForMs=55000` (invocation budget)
— both clamped server-side, so defaults are safe even for 500 texts/day.

**One job covers all campaigns.** The cron doesn't know or care how many
campaigns exist — it just ticks one endpoint, and the pump drains every
campaign's queue under the advisory lock. New campaigns need scheduler settings
in the UI, never a new cron job. (cron-job.org doesn't cap job count on its free
tier anyway, and its frequency ceiling of 1/min is exactly the pump's cadence.)

## 3b. Guards you get automatically (no config needed)

- **Send preview** — the campaign page has a **Preview** button next to *Queue
  send*. It dry-runs the first ~10 rendered messages (real first names, variant,
  scheduled time) without queueing anything, so you catch a bad template before
  it goes out.
- **Login hardening** — `/api/auth` is rate-limited per IP and per email
  (15-min sliding window; ~6 failed logins on an email, 15 by IP). Cookies are
  `httpOnly` + `sameSite=lax` + `secure` in production. Production refusing to
  start without a 24+ char `AUTH_SECRET` prevents weak-secret signing.
- **Failed-send + pump-stall alerts** — the pump updates a heartbeat on every
  tick (local worker *or* the cron endpoint). If messages stay queued-and-due
  while the pump is silent for 15 minutes, or ≥5 sends fail with a majority
  failure rate in an hour, an alert fires (max every 12h). Alert emails are
  sent **to the first admin account** when `RESEND_API_KEY` + `MAIL_FROM` are
  set; without them the alert only prints to the server log. ⚠️ Vercel Hobby
  retains runtime logs for just **1 hour**, so treat those two env vars as
  effectively required — otherwise an alert can vanish before you look. No
  extra tables to create — `schema.sql` covers it.

## 4. First campaign — practical configs

In the campaign → **Scheduler** panel:

| Setting | Sane value for your volume |
|---|---|
| **Min delay (s)** | `30` normally; `60–90` for the first weeks on a brand-new Telnyx number (warm-up) |
| **Max msgs / day** | per-contact cap: `2` (your default) |
| **Max sends / day** | total campaign budget: `500` (or whatever your daily ceiling is) — the campaign pauses once hit |
| **From / Until** | your prospect-facing business hours in the campaign timezone |
| **Timezone** | the zone your prospects are in (e.g. `America/Edmonton` for Alberta) — pick from the 22-option Canada-focused list |
| **Messaging profile** | the Telnyx messaging profile whose numbers are warmed up for this campaign |

Send-window math — the floor is a *minimum gap between messages*, so it
determines your real throughput:

| Min delay | Max rate | Time to deliver 500 messages |
|---|---|---|
| 20s | 3/min | ~2h 47m |
| 30s | 2/min | ~4h 10m |
| 60s (warm-up week 1) | 1/min | ~8h 20m |
| 90s (cautious warm-up) | 0.67/min | ~12h 30m |

Nothing sends outside the window, and messages deferred by `daily_cap` /
`daily_budget` roll to the next window (next day) — they are never lost or
burst out.

**Warm-up consequence worth planning around:** at 60–90s a 500-message campaign
will *not* fit inside one day's send window; it will take two days. That's
expected. During warm-up, set **Max sends / day** to what your window can
actually hold (e.g. ~180 messages for a 9-hour window at a 60s floor) rather
than raising the pace — then raise both pace and budget together as the number
ages.

## 5. Going live checklist

- [ ] `DATABASE_URL` uses the **Session pooler (5432)**, not the Transaction
      pooler (6543) — otherwise the pump's advisory lock breaks and sends can
      burst. (Quick check: the URL contains `:5432`.)
- [ ] Supabase **Database Linter shows 0 errors**: RLS enabled on every table
      (zero policies means the public REST API and anon key read nothing — the
      app connects as `postgres`, the table owner, which bypasses RLS), and the
      two stats views created **without** `SECURITY DEFINER`. `schema.sql`
      already ends with the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` block.
- [ ] All existing `unknown`-consent contacts bulk-marked **Opted in** (Contacts
      toolbar) so sends aren't silently blocked (`skipped — no consent`).
- [ ] Telnyx number **assigned to a messaging profile**, and that profile's
      webhook URL is `https://<domain>/api/webhooks/telnyx` (else no replies,
      no STOPs, no delivery statuses).
- [ ] Real Telnyx numbers + messaging profiles attached to campaigns.
- [ ] `AUTH_SECRET` is 24+ characters and `CRON_SECRET` is a *different* value.
- [ ] `LLM_MODEL=qwen/qwen3.8-27b` — the old `qwen3.6` ID was shut down
      2026-09-14, and an unknown model makes AI replies silently fall back to
      keyword heuristics (only a `[agent] LLM call failed` warn line).
- [ ] `CRON_SECRET` set, cron-job.org test run returns `sent`.
- [ ] Custom domain mapped; log in from a phone browser.
- [ ] Send a 1-message test campaign first, eyeball the pacing in the log
      (`[scheduler] sent=` / Vercel function logs), then scale the budget.

## 6. Local dev / non-serverless fallback

Everything also works on one machine: `npm run dev` + `npm run scheduler`
(kept for a VPS/always-on box). The in-process pump and the endpoint both go
through the same `pumpOnce()` and the same Postgres advisory lock, so only one
instance sends at a time wherever it runs.