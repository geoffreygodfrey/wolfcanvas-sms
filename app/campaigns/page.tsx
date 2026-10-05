"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import Modal from "@/components/Modal";
import type { Campaign, CampaignStatus } from "@/lib/types";

const EMPTY_FORM = {
  name: "",
  status: "draft" as CampaignStatus,
  scheduled_at: "",
  ai_enabled: false,
  ai_system_prompt: "",
  min_delay_seconds: 10,
  send_start_hour: "",
  send_end_hour: "",
};

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-line text-ink/70",
  scheduled: "bg-status-pending/10 text-status-pending",
  sending: "bg-signal-light text-signal-dark",
  completed: "bg-status-delivered/10 text-status-delivered",
  paused: "bg-status-optedout/10 text-status-optedout",
};

function formatHour(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/campaigns");
    setCampaigns(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(c: Campaign) {
    setEditing(c);
    setForm({
      name: c.name,
      status: c.status,
      scheduled_at: c.scheduled_at ? c.scheduled_at.slice(0, 16) : "",
      ai_enabled: c.ai_enabled,
      ai_system_prompt: c.ai_system_prompt ?? "",
      min_delay_seconds: c.min_delay_seconds ?? 10,
      send_start_hour: c.send_start_hour?.toString() ?? "",
      send_end_hour: c.send_end_hour?.toString() ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = editing ? `/api/campaigns/${editing.id}` : "/api/campaigns";
    const method = editing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        scheduled_at: form.scheduled_at || null,
        min_delay_seconds: Number(form.min_delay_seconds) || 10,
        send_start_hour:
          form.send_start_hour === "" ? null : Number(form.send_start_hour),
        send_end_hour:
          form.send_end_hour === "" ? null : Number(form.send_end_hour),
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }

    setModalOpen(false);
    load();
  }

  async function handleDelete(c: Campaign) {
    if (!confirm(`Delete campaign "${c.name}"? This can't be undone.`)) return;
    await fetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="reveal">
          <p className="eyebrow">Campaigns</p>
          <h1 className="page-title mt-1">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">{campaigns.length} total</p>
        </div>
        <Link
          href="/campaigns/new"
          className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-dark"
        >
          New campaign
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Scheduled</th>
              <th className="px-4 py-3 font-medium">Send window</th>
              <th className="px-4 py-3 font-medium">AI agent</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No campaigns yet. Create your first one to get started.
                </td>
              </tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-line/20">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink/70">
                    {c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink/70">
                    {c.send_start_hour != null && c.send_end_hour != null
                      ? `${formatHour(c.send_start_hour)} – ${formatHour(c.send_end_hour)} · ${c.min_delay_seconds}s`
                      : `24/7 · ${c.min_delay_seconds}s`}
                  </td>
                  <td className="px-4 py-2.5 text-ink/70">{c.ai_enabled ? "On" : "Off"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/campaigns/${c.id}`} className="mr-3 text-signal hover:underline">
                      Manage
                    </Link>
                    <button onClick={() => openEdit(c)} className="mr-3 text-signal hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(c)} className="text-status-failed hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit campaign" : "New campaign"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="sending">Sending</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Scheduled time (optional)</label>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Min delay (s)</label>
              <input
                type="number"
                min={0}
                value={form.min_delay_seconds}
                onChange={(e) => setForm({ ...form, min_delay_seconds: Number(e.target.value) })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Send from (24h)</label>
              <input
                type="number"
                min={0}
                max={23}
                placeholder="10"
                value={form.send_start_hour}
                onChange={(e) => setForm({ ...form, send_start_hour: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Send until (24h)</label>
              <input
                type="number"
                min={0}
                max={23}
                placeholder="19"
                value={form.send_end_hour}
                onChange={(e) => setForm({ ...form, send_end_hour: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Leave the window empty for 24/7 sending. “From” and “Until” are exclusive hours (e.g. 10–19 = 10:00 to 19:00).
          </p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.ai_enabled}
              onChange={(e) => setForm({ ...form, ai_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
            />
            Let the AI agent handle replies for this campaign
          </label>
          <p className="text-xs text-muted">
            What the AI may say is defined by the <strong>Reply scenarios</strong> on the campaign&apos;s
            page — it can only pick one of those, never write its own copy.
          </p>
          {form.ai_enabled && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Fallback system prompt <span className="font-normal text-muted">(only used when the campaign has no scenarios)</span>
              </label>
              <textarea
                rows={4}
                placeholder="Qualification criteria, tone, business context — e.g. 'We sell commercial cleaning. Qualify on company size + decision-maker role. Don't mention pricing.'"
                value={form.ai_system_prompt}
                onChange={(e) => setForm({ ...form, ai_system_prompt: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
          )}
          {editing && (
            <p className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-muted">
              Initial messages and follow-ups are managed on the{" "}
              <Link href={`/campaigns/${editing.id}`} className="font-medium text-signal hover:underline">
                campaign page
              </Link>
              . Use “New campaign” for the full creation wizard.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create campaign"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
