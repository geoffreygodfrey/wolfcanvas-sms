"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Overall {
  total_contacts: number;
  active_contacts: number;
  opted_out: number;
  total_sent: number;
  delivered: number;
  failed: number;
  replied: number;
  qualified: number;
  booked: number;
  upcoming_bookings: number;
  total_campaigns: number;
}

interface BookingDetail {
  id: string;
  scheduled_at: string;
  status: string;
  created_at: string;
  contact_id: string;
  contact_name: string;
  phone: string;
  campaign_name: string | null;
}

interface CampaignStat {
  campaign_id: string;
  campaign_name: string;
  total_sent: number;
  total_delivered: number;
  total_replied: number;
  total_opted_out: number;
  total_qualified: number;
  total_booked: number;
}

interface VariantStat {
  variant_id: string;
  campaign_id: string;
  label: string;
  total_sent: number;
  total_delivered: number;
  total_replied: number;
}

interface Stats {
  overall: Overall;
  campaigns: CampaignStat[];
  variants: VariantStat[];
  bookings: BookingDetail[];
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function groupByDay(rows: { scheduled_at: string }[]): { key: string; label: string; rows: { scheduled_at: string }[] }[] {
  const map = new Map<string, { key: string; label: string; rows: { scheduled_at: string }[] }>();
  for (const r of rows) {
    const key = new Date(r.scheduled_at).toDateString();
    if (!map.has(key)) map.set(key, { key, label: dayLabel(r.scheduled_at), rows: [] });
    map.get(key)!.rows.push(r);
  }
  return [...map.values()];
}

const BOOKING_STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-status-delivered/10 text-status-delivered",
  cancelled: "bg-status-failed/10 text-status-failed",
  completed: "bg-line/60 text-muted",
  no_show: "bg-status-pending/10 text-status-pending",
};

function Card({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const inner = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-[28px] font-medium leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-2 text-xs text-muted">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="card group block p-4 transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="card group p-4 transition-transform hover:-translate-y-0.5">
      {inner}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (!stats) {
    return <p className="text-sm text-muted">Couldn&apos;t load dashboard stats.</p>;
  }

  const { overall } = stats;

  return (
    <div className="space-y-8">
      <div className="reveal">
        <p className="eyebrow">Overview</p>
        <h1 className="page-title mt-1">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          {overall.total_campaigns} campaign{overall.total_campaigns === 1 ? "" : "s"} · {overall.total_contacts} contact
          {overall.total_contacts === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Card label="Contacts" value={overall.active_contacts} sub={`${overall.opted_out} opted out`} />
        <Card label="Messages sent" value={overall.total_sent} sub={`${overall.failed} failed`} />
        <Card label="Delivered" value={overall.delivered} sub={pct(overall.delivered, overall.total_sent)} />
        <Card label="Reply rate" value={pct(overall.replied, overall.total_sent)} sub={`${overall.replied} replies`} />
        <Card label="Opt-out rate" value={pct(overall.opted_out, overall.total_contacts)} sub={`${overall.opted_out} contacts`} />
        <Card label="Qualified" value={overall.qualified} href="/conversations?qualified=1" sub="review leads" />
        <Card label="Booked" value={overall.booked} href="/dashboard#bookings" sub={`${overall.upcoming_bookings} upcoming`} />
        <Card label="Active contacts" value={overall.total_contacts - overall.opted_out} sub="available for outreach" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">By campaign</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Replied</th>
                <th className="px-4 py-3 font-medium">Opted out</th>
                <th className="px-4 py-3 font-medium">Qualified</th>
                <th className="px-4 py-3 font-medium">Booked</th>
              </tr>
            </thead>
            <tbody>
              {stats.campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    No campaigns yet. Sends and replies will show up here.
                  </td>
                </tr>
              ) : (
                stats.campaigns.map((c) => (
                  <tr key={c.campaign_id} className="border-b border-line/70 last:border-0 hover:bg-line/20">
                    <td className="px-4 py-2.5 font-medium text-ink">{c.campaign_name}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_sent}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_delivered}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_replied}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_opted_out}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_qualified}</td>
                    <td className="px-4 py-2.5 text-ink/70">{c.total_booked}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">By variant</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Replied</th>
              </tr>
            </thead>
            <tbody>
              {stats.variants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No variants yet.
                  </td>
                </tr>
              ) : (
                stats.variants.map((v) => (
                  <tr key={v.variant_id} className="border-b border-line/70 last:border-0 hover:bg-line/20">
                    <td className="px-4 py-2.5 text-ink/70">
                      {stats.campaigns.find((c) => c.campaign_id === v.campaign_id)?.campaign_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-ink">
                      <span className="rounded bg-signal-light px-2 py-0.5 text-xs font-medium text-signal-dark">{v.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink/70">{v.total_sent}</td>
                    <td className="px-4 py-2.5 text-ink/70">{v.total_delivered}</td>
                    <td className="px-4 py-2.5 text-ink/70">{v.total_replied}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="bookings" className="scroll-mt-20">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Bookings</h2>
          <p className="font-mono text-xs text-muted">
            {stats.bookings.length} total · {overall.upcoming_bookings} confirmed from today
          </p>
        </div>

        {stats.bookings.length === 0 ? (
          <div className="rounded-lg border border-line bg-white px-6 py-12 text-center">
            <p className="text-sm font-medium text-ink">No bookings yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              When a prospect green-lights a call — e.g. &ldquo;Wednesday at 2pm would be perfect&rdquo; — the agent books
              it and it&apos;s tracked here with the contact, campaign, and status.
            </p>
          </div>
        ) : (
          groupByDay(stats.bookings).map((g) => (
            <div key={g.key} className="mb-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.label} · {g.rows.length}
              </h3>
              <div className="overflow-hidden rounded-lg border border-line bg-white">
                {g.rows.map((b, i) => {
                  const booking = b as unknown as BookingDetail;
                  return (
                    <div key={booking.id} className={`px-4 py-3.5 ${i > 0 ? "border-t border-line/70" : ""}`}>
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                        <div className="w-28 shrink-0">
                          <div className="font-mono text-sm font-medium text-ink">{timeStr(booking.scheduled_at)}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-ink">{booking.contact_name}</span>
                            <span className="font-mono text-xs text-muted">{booking.phone}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            {booking.campaign_name && <span>via {booking.campaign_name}</span>}
                            <span>booked {new Date(booking.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
                              BOOKING_STATUS_STYLES[booking.status] ?? "bg-line/60 text-muted"
                            }`}
                          >
                            {booking.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}