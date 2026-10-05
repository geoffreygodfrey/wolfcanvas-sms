"use client";

import { useEffect, useMemo, useState } from "react";

interface FollowUpRow {
  id: string;
  body: string;
  status: string;
  error_detail: string | null;
  send_at: string | null;
  sent_at: string | null;
  contact_id: string;
  contact_name: string;
  phone: string;
  opted_out: boolean;
  campaign_id: string;
  campaign_name: string;
  position: number;
  delay_days: number;
  delay_hours: number;
  contact_replied: boolean;
}

interface CampaignMeta {
  id: string;
  name: string;
}

type StatusFilter = "all" | "queued" | "sent" | "delivered" | "failed";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-status-pending/10 text-status-pending",
  sent: "bg-line/60 text-muted",
  delivered: "bg-status-delivered/10 text-status-delivered",
  failed: "bg-status-failed/10 text-status-failed",
};

function isSuppressed(f: FollowUpRow): boolean {
  return f.status === "failed" && (f.error_detail ?? "").includes("skipped");
}

function statusLabel(f: FollowUpRow): string {
  if (isSuppressed(f)) return "Suppressed";
  if (f.status === "failed") return "Failed";
  return f.status.charAt(0).toUpperCase() + f.status.slice(1);
}

function whenLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const future = diff > 0;
  if (days >= 1) return `${future ? "in " : ""}${days}d ${hours}h${future ? "" : " ago"}`;
  if (hours >= 1) return `${future ? "in " : ""}${hours}h ${Math.floor((abs % 3600000) / 60000)}m${future ? "" : " ago"}`;
  const mins = Math.floor(abs / 60000);
  if (mins >= 1) return `${future ? "in " : ""}${mins}m${future ? "" : " ago"}`;
  return future ? "soon" : "just now";
}

function delayLabel(f: Pick<FollowUpRow, "delay_days" | "delay_hours">): string {
  const d = f.delay_days;
  const h = f.delay_hours;
  if (d && h) return `${d}d ${h}h after first send`;
  if (d) return `${d} day${d === 1 ? "" : "s"} after first send`;
  if (h) return `${h} hour${h === 1 ? "" : "s"} after first send`;
  return "same day";
}

export default function FollowUpsPage() {
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/follow-ups");
      const json = await res.json();
      setRows(json.followUps ?? []);
      setCampaigns(json.campaigns ?? []);
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(
    () => ({
      queued: rows.filter((f) => f.status === "queued").length,
      sent: rows.filter((f) => f.status === "sent").length,
      delivered: rows.filter((f) => f.status === "delivered").length,
      failed: rows.filter((f) => f.status === "failed").length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((f) => {
      if (campaignFilter !== "all" && f.campaign_id !== campaignFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (term && !`${f.contact_name} ${f.phone} ${f.campaign_name}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, campaignFilter, statusFilter, q]);

  const groups = useMemo(() => {
    const map = new Map<string, { campaign_id: string; campaign_name: string; rows: FollowUpRow[] }>();
    for (const f of filtered) {
      if (!map.has(f.campaign_id)) map.set(f.campaign_id, { campaign_id: f.campaign_id, campaign_name: f.campaign_name, rows: [] });
      map.get(f.campaign_id)!.rows.push(f);
    }
    return [...map.values()];
  }, [filtered]);

  const tabs: { key: StatusFilter; label: string; n?: number }[] = [
    { key: "all", label: "All", n: rows.length },
    { key: "queued", label: "Queued", n: counts.queued },
    { key: "sent", label: "Sent", n: counts.sent },
    { key: "delivered", label: "Delivered", n: counts.delivered },
    { key: "failed", label: "Failed", n: counts.failed },
  ];

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="reveal">
          <p className="eyebrow">Outreach</p>
          <h1 className="page-title mt-1">Follow-ups</h1>
          <p className="mt-1 text-sm text-muted">
            {counts.queued} queued · {counts.sent + counts.delivered} sent · {counts.failed} failed / suppressed
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contact, phone, campaign…"
          className="w-64 rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        />
        <div className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === t.key ? "bg-signal text-white" : "text-ink/70 hover:text-signal"
              }`}
            >
              {t.label}
              {t.n !== undefined && <span className="ml-1 opacity-60">{t.n}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-ink">
            {rows.length === 0 ? "No follow-ups yet" : "No follow-ups match this filter"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {rows.length === 0
              ? "Follow-ups are timed reminders sent after the first message when a contact hasn\u2019t replied. Add them to a campaign from Campaigns — then hit Send and they\u2019ll be tracked here."
              : "Try a different campaign, status, or clear the search."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.campaign_id}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.campaign_name} · {g.rows.length}
              </h2>
              <div className="overflow-hidden rounded-lg border border-line bg-white">
                {g.rows.map((f, i) => (
                  <div key={f.id} className={`px-4 py-3.5 ${i > 0 ? "border-t border-line/70" : ""}`}>
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                      <div className="w-36 shrink-0">
                        <span className="font-mono text-xs font-semibold text-signal-dark">
                          Follow-up {f.position}
                        </span>
                        <p className="mt-0.5 text-[11px] text-muted">{delayLabel(f)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{f.contact_name}</span>
                          <span className="font-mono text-xs text-muted">{f.phone}</span>
                          {f.contact_replied && (
                            <span className="rounded-full bg-status-delivered/10 px-2 py-0.5 font-mono text-[10px] font-medium text-status-delivered">
                              Replied
                            </span>
                          )}
                          {f.opted_out && (
                            <span className="rounded-full bg-status-optedout/10 px-2 py-0.5 font-mono text-[10px] font-medium text-status-optedout">
                              Opted out
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-ink/75">{f.body}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {f.status === "queued" && f.send_at && (
                            <span className="text-xs text-muted">{whenLabel(f.send_at)}</span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium capitalize tracking-wide ${
                              STATUS_STYLES[f.status] ?? "bg-line/60 text-muted"
                            }`}
                          >
                            {statusLabel(f)}
                          </span>
                        </div>
                        {f.status === "queued" && f.send_at ? (
                          <p className="mt-0.5 text-[11px] text-muted">scheduled {whenLabel(f.send_at)}</p>
                        ) : f.sent_at ? (
                          <p className="mt-0.5 text-[11px] text-muted">sent {whenLabel(f.sent_at)}</p>
                        ) : null}
                        {isSuppressed(f) && f.error_detail && (
                          <p className="mt-0.5 text-[11px] text-muted">why: {f.error_detail.replace(/^skipped —\s*/, "")}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}