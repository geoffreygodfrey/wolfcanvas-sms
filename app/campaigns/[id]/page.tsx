"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TIMEZONES, tzAbbrev } from "@/lib/timezone";
import type {
  Campaign,
  CampaignStatus,
  CampaignVariant,
  CampaignContactRow,
  CampaignScenario,
  ScenarioAction,
  ContactGroup,
  SendPreview,
  SendSummary,
  CampaignFollowUp,
} from "@/lib/types";

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-line text-ink/70",
  scheduled: "bg-status-pending/10 text-status-pending",
  sending: "bg-signal-light text-signal-dark",
  completed: "bg-status-delivered/10 text-status-delivered",
  paused: "bg-status-optedout/10 text-status-optedout",
};

const EMPTY_VARIANT = { label: "", message_template: "" };

const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [scenarios, setScenarios] = useState<CampaignScenario[]>([]);
  const [rows, setRows] = useState<CampaignContactRow[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [audienceGroupId, setAudienceGroupId] = useState("");
  const [assignVariant, setAssignVariant] = useState("");
  const [audienceBusy, setAudienceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Inline-editable variant message boxes.
  const [drafts, setDrafts] = useState<Record<string, { label: string; message_template: string }>>({});
  const [savedSnap, setSavedSnap] = useState<Record<string, { label: string; message_template: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(true);
  const [newForm, setNewForm] = useState({ ...EMPTY_VARIANT, label: "A" });
  const [savingNew, setSavingNew] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  // Inline-editable reply scenarios.
  interface ScDraft {
    label: string;
    keywords: string;
    reply_template: string;
    action: ScenarioAction;
    priority: number;
    enabled: boolean;
  }
  const [scDrafts, setScDrafts] = useState<Record<string, ScDraft>>({});
  const [scSaved, setScSaved] = useState<Record<string, ScDraft>>({});
  const [scSavingId, setScSavingId] = useState<string | null>(null);
  const [scNewOpen, setScNewOpen] = useState(true);
  const [scNewForm, setScNewForm] = useState<ScDraft>({
    label: "",
    keywords: "",
    reply_template: "",
    action: "reply",
    priority: 100,
    enabled: true,
  });
  const [scSavingNew, setScSavingNew] = useState(false);
  const [scError, setScError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendSummary | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);

  const [paceForm, setPaceForm] = useState({
    min_delay_seconds: 10,
    send_start_hour: "",
    send_end_hour: "",
    timezone: "",
    daily_cap: 2,
    daily_budget: 0,
    telnyx_profile_id: "",
  });
  const [telnyxProfiles, setTelnyxProfiles] = useState<{ id: string; name: string }[]>([]);
  const [telnyxProfileErr, setTelnyxProfileErr] = useState<string | null>(null);
  const [savingPace, setSavingPace] = useState(false);
  const [paceSaved, setPaceSaved] = useState(false);

  // Follow-ups
  const [followUps, setFollowUps] = useState<CampaignFollowUp[]>([]);
  type FuDraft = { delay_days: number; delay_hours: number; message_template: string; enabled: boolean; position: number };
  const [fuDrafts, setFuDrafts] = useState<Record<string, FuDraft>>({});
  const [fuSaved, setFuSaved] = useState<Record<string, FuDraft>>({});
  const [fuSavingId, setFuSavingId] = useState<string | null>(null);
  const [fuNewOpen, setFuNewOpen] = useState(false);
  const [fuNewForm, setFuNewForm] = useState<FuDraft>({ delay_days: 1, delay_hours: 0, message_template: "", enabled: true, position: 1 });
  const [fuSavingNew, setFuSavingNew] = useState(false);
  const [fuError, setFuError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const [cRes, vRes, rRes, sRes, gRes, fuRes] = await Promise.all([
        fetch(`/api/campaigns/${id}`),
        fetch(`/api/campaigns/${id}/variants`),
        fetch(`/api/campaigns/${id}/contacts`),
        fetch(`/api/campaigns/${id}/scenarios`),
        fetch(`/api/contact-groups`),
        fetch(`/api/campaigns/${id}/follow-ups`),
      ]);
      if (cRes.status === 404) {
        setNotFound(true);
        return;
      }
      const c = (await cRes.json()) as Campaign;
      setCampaign(c);
      setPaceForm({
        min_delay_seconds: c.min_delay_seconds ?? 10,
        send_start_hour: c.send_start_hour?.toString() ?? "",
        send_end_hour: c.send_end_hour?.toString() ?? "",
        timezone: c.timezone ?? "",
        daily_cap: c.daily_cap ?? 2,
        daily_budget: c.daily_budget ?? 0,
        telnyx_profile_id: c.telnyx_profile_id ?? "",
      });
      const list = (await vRes.json()) as CampaignVariant[];
      setVariants(list);
      const d: Record<string, { label: string; message_template: string }> = {};
      const s: Record<string, { label: string; message_template: string }> = {};
      for (const v of list) {
        d[v.id] = { label: v.label, message_template: v.message_template };
        s[v.id] = { label: v.label, message_template: v.message_template };
      }
      setDrafts(d);
      setSavedSnap(s);
      setNewOpen(list.length === 0);

      const scList = sRes.ok ? ((await sRes.json()) as CampaignScenario[]) : [];
      setScenarios(scList);
      const sd: Record<string, ScDraft> = {};
      const ss: Record<string, ScDraft> = {};
      for (const sc of scList) {
        const draft: ScDraft = {
          label: sc.label,
          keywords: sc.keywords,
          reply_template: sc.reply_template,
          action: sc.action,
          priority: sc.priority,
          enabled: sc.enabled,
        };
        sd[sc.id] = { ...draft };
        ss[sc.id] = { ...draft };
      }
      setScDrafts(sd);
      setScSaved(ss);
      setScNewOpen(scList.length === 0);

      const fuList = fuRes.ok ? ((await fuRes.json()) as CampaignFollowUp[]) : [];
      setFollowUps(fuList);
      const fd: Record<string, FuDraft> = {};
      const fs: Record<string, FuDraft> = {};
      for (const fu of fuList) {
        const d: FuDraft = { delay_days: fu.delay_days, delay_hours: fu.delay_hours, message_template: fu.message_template, enabled: fu.enabled, position: fu.position };
        fd[fu.id] = { ...d };
        fs[fu.id] = { ...d };
      }
      setFuDrafts(fd);
      setFuSaved(fs);
      setFuNewOpen(fuList.length === 0);
      // keep new form position in sync
      setFuNewForm((prev) => ({ ...prev, position: fuList.length + 1 }));

      if (gRes.ok) setGroups(await gRes.json());
      setRows(await rRes.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Load Telnyx messaging profiles for the scheduler picker (no key → empty list).
  useEffect(() => {
    fetch("/api/telnyx/profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setTelnyxProfiles(d.profiles ?? []);
          if (d.error) setTelnyxProfileErr(d.error);
        } else {
          setTelnyxProfiles([]);
        }
      })
      .catch(() => setTelnyxProfiles([]));
  }, [id]);

  // While sending, quietly refresh so status + count stay live.
  useEffect(() => {
    if (campaign?.status !== "sending") return;
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load();
    }, 15000);
    return () => clearInterval(t);
  }, [campaign?.status, load]);

  useEffect(() => {
    if (variants.length > 0 && !variants.some((v) => v.id === assignVariant)) {
      setAssignVariant(variants[0].id);
    }
  }, [variants, assignVariant]);

  const assignedCount = useMemo(() => rows.filter((r) => r.variant_id).length, [rows]);
  const optedOutCount = useMemo(() => rows.filter((r) => r.opted_out).length, [rows]);

  function updateDraft(id: string, patch: { label?: string; message_template?: string }) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function isDirty(id: string): boolean {
    const d = drafts[id];
    const s = savedSnap[id];
    return !!d && !!s && (d.label !== s.label || d.message_template !== s.message_template);
  }

  async function saveInline(variantId: string) {
    const d = drafts[variantId];
    if (!d?.label.trim() || !d.message_template.trim()) {
      setVariantError("Label and message are required.");
      return;
    }
    setSavingId(variantId);
    setVariantError(null);
    const res = await fetch(`/api/campaigns/${id}/variants/${variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: d.label.trim(), message_template: d.message_template }),
    });
    setSavingId(null);
    if (!res.ok) {
      const data = await res.json();
      setVariantError(data.error || "Failed to save message.");
      return;
    }
    load();
  }

  async function saveNew() {
    if (!newForm.label.trim() || !newForm.message_template.trim()) {
      setVariantError("Label and message are required.");
      return;
    }
    setSavingNew(true);
    setVariantError(null);
    const res = await fetch(`/api/campaigns/${id}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newForm.label.trim(), message_template: newForm.message_template }),
    });
    setSavingNew(false);
    if (!res.ok) {
      const data = await res.json();
      setVariantError(data.error || "Failed to add message.");
      return;
    }
    setNewForm({ ...EMPTY_VARIANT, label: "A" });
    setNewOpen(false);
    load();
  }

  async function deleteVariant(v: CampaignVariant) {
    if (
      !confirm(
        `Delete variant "${v.label}"? Assigned contacts will be unassigned.\n\nThis can't be undone.`
      )
    )
      return;
    const res = await fetch(`/api/campaigns/${id}/variants/${v.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete variant.");
    }
    load();
  }

  function updateScDraft(scId: string, patch: Partial<ScDraft>) {
    setScDrafts((prev) => ({ ...prev, [scId]: { ...prev[scId], ...patch } }));
  }

  function isScDirty(scId: string): boolean {
    const d = scDrafts[scId];
    const s = scSaved[scId];
    return (
      !!d &&
      !!s &&
      (d.label !== s.label ||
        d.keywords !== s.keywords ||
        d.reply_template !== s.reply_template ||
        d.action !== s.action ||
        d.priority !== s.priority ||
        d.enabled !== s.enabled)
    );
  }

  async function saveScenario(scId: string) {
    const d = scDrafts[scId];
    if (!d?.label.trim()) {
      setScError("Scenario label is required.");
      return;
    }
    setScSavingId(scId);
    setScError(null);
    const res = await fetch(`/api/campaigns/${id}/scenarios/${scId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    setScSavingId(null);
    if (!res.ok) {
      const data = await res.json();
      setScError(data.error || "Failed to save scenario.");
      return;
    }
    load();
  }

  async function saveNewScenario() {
    if (!scNewForm.label.trim()) {
      setScError("Scenario label is required.");
      return;
    }
    setScSavingNew(true);
    setScError(null);
    const res = await fetch(`/api/campaigns/${id}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scNewForm),
    });
    setScSavingNew(false);
    if (!res.ok) {
      const data = await res.json();
      setScError(data.error || "Failed to add scenario.");
      return;
    }
    setScNewForm({ label: "", keywords: "", reply_template: "", action: "reply", priority: 100, enabled: true });
    setScNewOpen(false);
    load();
  }

  async function deleteScenario(sc: CampaignScenario) {
    if (!confirm(`Delete scenario "${sc.label}"? This can't be undone.`)) return;
    const res = await fetch(`/api/campaigns/${id}/scenarios/${sc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete scenario.");
    }
    load();
  }

  // Follow-ups helpers
  function updateFuDraft(fuId: string, patch: Partial<FuDraft>) {
    setFuDrafts((prev) => ({ ...prev, [fuId]: { ...prev[fuId], ...patch } }));
  }
  function isFuDirty(fuId: string): boolean {
    const d = fuDrafts[fuId];
    const s = fuSaved[fuId];
    return !!d && !!s && (d.delay_days !== s.delay_days || d.delay_hours !== s.delay_hours || d.message_template !== s.message_template || d.enabled !== s.enabled || d.position !== s.position);
  }
  async function saveFollowUp(fuId: string) {
    const d = fuDrafts[fuId];
    if (!d?.message_template.trim()) {
      setFuError("Follow-up message is required.");
      return;
    }
    if (d.delay_days === 0 && d.delay_hours === 0) {
      setFuError("Delay must be at least 1 hour.");
      return;
    }
    setFuSavingId(fuId);
    setFuError(null);
    const res = await fetch(`/api/campaigns/${id}/follow-ups/${fuId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    setFuSavingId(null);
    if (!res.ok) {
      const data = await res.json();
      setFuError(data.error || "Failed to save follow-up.");
      return;
    }
    load();
  }
  async function saveNewFollowUp() {
    if (!fuNewForm.message_template.trim()) {
      setFuError("Follow-up message is required.");
      return;
    }
    if (fuNewForm.delay_days === 0 && fuNewForm.delay_hours === 0) {
      setFuError("Delay must be at least 1 hour.");
      return;
    }
    setFuSavingNew(true);
    setFuError(null);
    const res = await fetch(`/api/campaigns/${id}/follow-ups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fuNewForm),
    });
    setFuSavingNew(false);
    if (!res.ok) {
      const data = await res.json();
      setFuError(data.error || "Failed to add follow-up.");
      return;
    }
    setFuNewForm({ delay_days: 1, delay_hours: 0, message_template: "", enabled: true, position: followUps.length + 2 });
    setFuNewOpen(false);
    load();
  }
  async function deleteFollowUp(fu: CampaignFollowUp) {
    if (!confirm(`Delete follow-up #${fu.position}? This can't be undone.`)) return;
    const res = await fetch(`/api/campaigns/${id}/follow-ups/${fu.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete follow-up.");
    }
    load();
  }

  async function applyGroup(remove: boolean) {
    if (!audienceGroupId || audienceBusy) return;
    if (!remove && !assignVariant) return;
    setAudienceBusy(true);
    try {
      const res = await fetch(`/api/contact-groups/${encodeURIComponent(audienceGroupId)}/contacts`);
      if (!res.ok) {
        alert("Couldn't load that group.");
        return;
      }
      const members: { id: string }[] = await res.json();
      const ids = members.map((m) => m.id);
      if (ids.length === 0) {
        alert("That group has no contacts.");
        return;
      }
      const r = await fetch(`/api/campaigns/${id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: ids,
          variantId: remove ? null : assignVariant,
        }),
      });
      if (!r.ok) {
        const data = await r.json();
        alert(data.error || "Failed to update the audience.");
        return;
      }
      setAudienceGroupId("");
      load();
    } finally {
      setAudienceBusy(false);
    }
  }

  async function handlePreview() {
    if (assignedCount === 0) {
      alert("Assign at least one contact to a variant before previewing.");
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/send?dryRun=1`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Preview failed.");
        return;
      }
      if (!data.preview) {
        alert("Nothing to preview — assign contacts and mark them as opted-in first.");
        return;
      }
      setPreview(data);
    } catch {
      alert("Network error — try again.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    if (assignedCount === 0) {
      alert("Assign at least one contact to a variant before sending.");
      return;
    }
    const windowNote =
      campaign!.send_start_hour != null && campaign!.send_end_hour != null
        ? ` The pump only delivers between ${campaign!.send_start_hour}:00 and ${campaign!.send_end_hour}:00 (${campaign!.timezone ?? "your timezone"}).`
        : "";
    const optedOutAssigned = rows.filter((r) => r.variant_id && r.opted_out).length;
    const message = `Queue ${assignedCount} message(s)?${windowNote}${
      optedOutAssigned > 0 ? ` (${optedOutAssigned} opted-out will be skipped)` : ""
    }`;
    if (!confirm(message)) return;

    setSending(true);
    setSendResult(null);
    const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
    const data = await res.json();
    setSending(false);
    setSendResult(data);
    load();
  }

  async function savePace(e: React.FormEvent) {
    e.preventDefault();
    setSavingPace(true);
    setPaceSaved(false);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        min_delay_seconds: Number(paceForm.min_delay_seconds) || 10,
        send_start_hour: paceForm.send_start_hour === "" ? null : Number(paceForm.send_start_hour),
        send_end_hour: paceForm.send_end_hour === "" ? null : Number(paceForm.send_end_hour),
        daily_cap: Number(paceForm.daily_cap) || 0,
        daily_budget: Number(paceForm.daily_budget) || 0,
        ...(paceForm.timezone ? { timezone: paceForm.timezone } : {}),
        ...(paceForm.telnyx_profile_id ? { telnyx_profile_id: paceForm.telnyx_profile_id } : {}),
      }),
    });
    setSavingPace(false);
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to save scheduler settings.");
      return;
    }
    setPaceSaved(true);
    load();
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (notFound || !campaign) {
    return (
      <p className="text-sm text-muted">
        Campaign not found.{" "}
        <Link href="/campaigns" className="text-signal hover:underline">
          Back to campaigns
        </Link>
      </p>
    );
  }

  const previewName = "Alex";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/campaigns" className="text-sm text-muted hover:text-ink">
          ← Back to campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-medium tracking-tight text-ink">{campaign.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[campaign.status]}`}>
              {campaign.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={previewing || sending}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-stone-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-dark"
          >
            {previewing ? "Rendering…" : "Preview"}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || previewing}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-dark"
          >
            {sending ? "Queuing…" : "Queue send"}
          </button>
        </div>
        </div>
      </div>

      {sendResult && (
        <div className="rounded-lg border border-line bg-white p-4 text-sm">
          <p className="font-medium text-ink">
            {campaign?.status !== "sending"
              ? "Messages queued — the pump delivers them paced & inside the window."
              : "Pump is delivering…"}
          </p>
          <p className="mt-1 text-muted">
            {sendResult.queued} queued · {sendResult.skippedOptedOut} opted-out skipped
            {sendResult.skippedNoConsent > 0 ? ` · ${sendResult.skippedNoConsent} no-consent skipped` : ""} ·{" "}
            {sendResult.unassigned} unassigned excluded
          </p>
          {sendResult.min_delay_seconds != null && sendResult.window && (
            <p className="mt-1 text-muted">
              Pace: 1 per {sendResult.min_delay_seconds}s · Window: {sendResult.window}
            </p>
          )}
          {(sendResult.first_send_at || sendResult.last_send_at) && (
            <p className="mt-1 text-muted">
              Starts {new Date(sendResult.first_send_at!).toLocaleString()} · completes{" "}
              {new Date(sendResult.last_send_at!).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border border-line bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-medium text-ink">Send preview</h2>
                <p className="text-sm text-muted">
                  {preview.total} will be queued
                  {preview.skippedOptedOut > 0 ? ` · ${preview.skippedOptedOut} opted-out skipped` : ""}
                  {preview.skippedNoConsent > 0 ? ` · ${preview.skippedNoConsent} no-consent skipped` : ""}
                  {preview.unassigned > 0 ? ` · ${preview.unassigned} unassigned excluded` : ""}
                  {preview.preview.length < preview.total
                    ? ` · showing first ${preview.preview.length} of ${preview.total}`
                    : ""}
                </p>
                {preview.min_delay_seconds != null && preview.window && (
                  <p className="mt-0.5 text-xs text-muted">
                    Pace: 1 per {preview.min_delay_seconds}s · Window: {preview.window}
                  </p>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                className="shrink-0 text-muted hover:text-ink"
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {preview.preview.map((m, i) => (
                <li key={i} className="rounded-lg border border-line bg-stone-50 p-3">
                  <p className="text-xs font-medium text-muted">
                    {m.contact_name} · {m.variant_label} · {new Date(m.send_at).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm text-ink">{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-ink">Scheduler</h2>
          <p className="text-sm text-muted">
            Pace sends and restrict delivery to business hours. The floor also applies to manual messages.
          </p>
        </div>
        <form onSubmit={savePace} className="rounded-lg border border-line bg-white p-4">
          <div className="grid max-w-md grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Min delay (s)</label>
              <input
                type="number"
                min={0}
                value={paceForm.min_delay_seconds}
                onChange={(e) => setPaceForm({ ...paceForm, min_delay_seconds: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Max msgs / day</label>
              <input
                type="number"
                min={0}
                placeholder="2"
                value={paceForm.daily_cap}
                onChange={(e) => setPaceForm({ ...paceForm, daily_cap: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">From (24h)</label>
              <input
                type="number"
                min={0}
                max={23}
                placeholder="10"
                value={paceForm.send_start_hour}
                onChange={(e) => setPaceForm({ ...paceForm, send_start_hour: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Until (24h)</label>
              <input
                type="number"
                min={0}
                max={23}
                placeholder="19"
                value={paceForm.send_end_hour}
                onChange={(e) => setPaceForm({ ...paceForm, send_end_hour: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-3 max-w-md">
            <label className="mb-1 block text-sm font-medium text-ink">
              Timezone for the window
            </label>
            <select
              value={paceForm.timezone}
              onChange={(e) => setPaceForm({ ...paceForm, timezone: e.target.value })}
              className={inputClass}
            >
              {paceForm.timezone &&
                !TIMEZONES.some((tz) => tz.value === paceForm.timezone) && (
                  <option value={paceForm.timezone}>{paceForm.timezone}</option>
                )}
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              The From/Until hours are delivered in this timezone — pick the zone your prospects
              are in, not your own.
            </p>
          </div>
          <div className="mt-3 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Max sends / day
              </label>
              <input
                type="number"
                min={0}
                placeholder="500 (0 = unlimited)"
                value={paceForm.daily_budget}
                onChange={(e) => setPaceForm({ ...paceForm, daily_budget: Number(e.target.value) })}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                Total outbound from this campaign per day; 0 = unlimited.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">
                Messaging profile (Telnyx)
              </label>
              <select
                value={paceForm.telnyx_profile_id}
                onChange={(e) => setPaceForm({ ...paceForm, telnyx_profile_id: e.target.value })}
                className={inputClass}
              >
                <option value="">Default number (as configured)</option>
                {telnyxProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 max-w-md">
            {telnyxProfileErr && (
              <p className="mt-1 text-xs text-status-failed">{telnyxProfileErr}</p>
            )}
            {!telnyxProfileErr && telnyxProfiles.length === 0 && (
              <p className="mt-1 text-xs text-muted">
                Telnyx not connected — set TELNYX_API_KEY to pick a messaging profile per
                campaign. Sends currently log to the console.
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={savingPace}
              className="rounded-lg bg-signal px-3.5 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {savingPace ? "Saving…" : "Save scheduler"}
            </button>
            {paceSaved && <span className="text-sm text-status-delivered">Saved.</span>}
            <span className="ml-auto text-xs text-muted">
              Leave window blank for 24/7 · “Max msgs / day” caps sends per contact (0 =
              unlimited) · outside hours are held until the next window
            </span>
          </div>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Message variants</h2>
            <p className="text-sm text-muted">
              Write the exact SMS your contacts receive. Use {"{{name}}"} to personalize —
              it&apos;s replaced with each contact&apos;s first name. The AI agent
              (if enabled) only qualifies replies — it never writes these outbound texts.
            </p>
          </div>
          <button
            onClick={() => {
              setVariantError(null);
              setNewOpen(true);
            }}
            className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-line/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            Add message
          </button>
        </div>

        {variantError && (
          <p className="mb-3 rounded-lg bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{variantError}</p>
        )}

        <ul className="space-y-3">
          {variants.map((v) => {
            const draft = drafts[v.id] ?? v;
            const dirty = isDirty(v.id);
            return (
              <li key={v.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={draft.label}
                      maxLength={10}
                      onChange={(e) => updateDraft(v.id, { label: e.target.value })}
                      aria-label="Variant label"
                      className="w-16 rounded border border-line bg-signal-light/40 px-2 py-1 text-center font-mono text-xs font-semibold text-signal-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                    <span className="text-xs text-muted">{v.contact_count} assigned</span>
                    {dirty && (
                      <span className="rounded bg-status-pending/10 px-1.5 py-0.5 text-[11px] font-medium text-status-pending">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    {dirty && (
                      <button
                        onClick={() => saveInline(v.id)}
                        disabled={savingId === v.id}
                        className="font-medium text-signal hover:underline disabled:opacity-60"
                      >
                        {savingId === v.id ? "Saving…" : "Save message"}
                      </button>
                    )}
                    <button onClick={() => deleteVariant(v)} className="text-status-failed hover:underline">
                      Delete
                    </button>
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={draft.message_template}
                  onChange={(e) => updateDraft(v.id, { message_template: e.target.value })}
                  placeholder="Hi {{name}}, we have an offer for you…"
                  className={`${inputClass} mt-3`}
                />
                {draft.message_template && (
                  <p className="mt-1.5 text-xs text-muted">
                    Preview: {draft.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                  </p>
                )}
              </li>
            );
          })}

          {(newOpen || variants.length === 0) && (
            <li className="rounded-lg border border-dashed border-signal/50 bg-white p-4">
              <div className="flex items-center gap-2">
                <input
                  value={newForm.label}
                  maxLength={10}
                  placeholder="A"
                  onChange={(e) => setNewForm({ ...newForm, label: e.target.value })}
                  aria-label="New message label"
                  className="w-16 rounded border border-signal/40 px-2 py-1 text-center font-mono text-xs font-semibold text-signal-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                />
                <span className="text-xs text-muted">
                  {variants.length === 0
                    ? "Write the first message your contacts receive — it gets saved as a variant."
                    : "New message"}
                </span>
              </div>
              <textarea
                rows={5}
                value={newForm.message_template}
                onChange={(e) => setNewForm({ ...newForm, message_template: e.target.value })}
                placeholder="Hi {{name}}, we have an offer for you…"
                className={`${inputClass} mt-3`}
              />
              {newForm.message_template && (
                <p className="mt-1.5 text-xs text-muted">
                  Preview: {newForm.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                {variants.length > 0 && (
                  <button
                    onClick={() => {
                      setNewOpen(false);
                      setNewForm({ ...EMPTY_VARIANT, label: "A" });
                      setVariantError(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={saveNew}
                  disabled={savingNew}
                  className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  {savingNew ? "Saving…" : "Save message"}
                </button>
              </div>
            </li>
          )}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Follow-ups</h2>
            <p className="text-sm text-muted">
              Nudge contacts who don&apos;t reply. Each follow-up sends <strong>delay days/hours after the initial message</strong> if no inbound is seen. Respects the send window & global pace.
            </p>
          </div>
          <button
            onClick={() => {
              setFuError(null);
              setFuNewOpen(true);
            }}
            className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-line/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            Add follow-up
          </button>
        </div>

        {fuError && <p className="mb-3 rounded-lg bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{fuError}</p>}

        <ul className="space-y-3">
          {followUps.map((fu) => {
            const draft = fuDrafts[fu.id];
            if (!draft) return null;
            const dirty = isFuDirty(fu.id);
            return (
              <li
                key={fu.id}
                className={`rounded-lg border bg-white p-4 ${fu.enabled ? "border-line" : "border-dashed border-line opacity-70"}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => updateFuDraft(fu.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                    aria-label={`Enable follow-up #${fu.position}`}
                    title="Enabled — only enabled follow-ups are queued"
                  />
                  <span className="rounded-full bg-signal-light px-2 py-0.5 text-xs font-semibold text-signal-dark">#{draft.position}</span>
                  <label className="flex items-center gap-1 text-xs text-ink">
                    Pos
                    <input
                      type="number"
                      min={1}
                      value={draft.position}
                      onChange={(e) => updateFuDraft(fu.id, { position: Number(e.target.value) })}
                      className="w-14 rounded border border-line px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-ink">
                    Days
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={draft.delay_days}
                      onChange={(e) => updateFuDraft(fu.id, { delay_days: Number(e.target.value) })}
                      className="w-14 rounded border border-line px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-ink">
                    Hours
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={draft.delay_hours}
                      onChange={(e) => updateFuDraft(fu.id, { delay_hours: Number(e.target.value) })}
                      className="w-14 rounded border border-line px-1.5 py-1 text-xs"
                    />
                  </label>
                  <span className="text-xs text-muted">
                    {draft.delay_days === 0 && draft.delay_hours === 0
                      ? "—"
                      : `${draft.delay_days ? draft.delay_days + "d " : ""}${draft.delay_hours ? draft.delay_hours + "h" : ""} after initial`}
                  </span>
                  {dirty && (
                    <span className="rounded bg-status-pending/10 px-1.5 py-0.5 text-[11px] font-medium text-status-pending">Unsaved</span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-sm">
                    {dirty && (
                      <button
                        onClick={() => saveFollowUp(fu.id)}
                        disabled={fuSavingId === fu.id}
                        className="font-medium text-signal hover:underline disabled:opacity-60"
                      >
                        {fuSavingId === fu.id ? "Saving…" : "Save"}
                      </button>
                    )}
                    <button onClick={() => deleteFollowUp(fu)} className="text-status-failed hover:underline">
                      Delete
                    </button>
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={draft.message_template}
                  onChange={(e) => updateFuDraft(fu.id, { message_template: e.target.value })}
                  placeholder="Hi {{name}}, just following up — still interested?"
                  className={`${inputClass} mt-3`}
                />
                {draft.message_template && (
                  <p className="mt-1.5 text-xs text-muted">
                    Preview: {draft.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                  </p>
                )}
              </li>
            );
          })}

          {(fuNewOpen || followUps.length === 0) && (
            <li className="rounded-lg border border-dashed border-signal/50 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-signal-dark">New follow-up</span>
                <label className="flex items-center gap-1 text-xs text-ink">
                  Pos
                  <input
                    type="number"
                    min={1}
                    value={fuNewForm.position}
                    onChange={(e) => setFuNewForm({ ...fuNewForm, position: Number(e.target.value) })}
                    className="w-14 rounded border border-signal/40 px-1.5 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-ink">
                  Days
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={fuNewForm.delay_days}
                    onChange={(e) => setFuNewForm({ ...fuNewForm, delay_days: Number(e.target.value) })}
                    className="w-14 rounded border border-line px-1.5 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-ink">
                  Hours
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={fuNewForm.delay_hours}
                    onChange={(e) => setFuNewForm({ ...fuNewForm, delay_hours: Number(e.target.value) })}
                    className="w-14 rounded border border-line px-1.5 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={fuNewForm.enabled}
                    onChange={(e) => setFuNewForm({ ...fuNewForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                  />
                  Enabled
                </label>
              </div>
              <textarea
                rows={3}
                value={fuNewForm.message_template}
                onChange={(e) => setFuNewForm({ ...fuNewForm, message_template: e.target.value })}
                placeholder="Hi {{name}}, just following up — still interested?"
                className={`${inputClass} mt-3`}
              />
              {fuNewForm.message_template && (
                <p className="mt-1.5 text-xs text-muted">
                  Preview: {fuNewForm.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                {followUps.length > 0 && (
                  <button
                    onClick={() => {
                      setFuNewOpen(false);
                      setFuError(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={saveNewFollowUp}
                  disabled={fuSavingNew}
                  className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  {fuSavingNew ? "Saving…" : "Save follow-up"}
                </button>
              </div>
            </li>
          )}
        </ul>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-ink">Reply scenarios</h2>
          <p className="text-sm text-muted">
            Inbound replies are matched against these top-down by priority. The AI agent (if enabled)
            can only pick which scenario fits — it never writes copy or books meetings on its own.
          </p>
        </div>

        {scError && (
          <p className="mb-3 rounded-lg bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{scError}</p>
        )}

        <ul className="space-y-3">
          {scenarios.map((sc) => {
            const draft = scDrafts[sc.id];
            if (!draft) return null;
            const dirty = isScDirty(sc.id);
            return (
              <li
                key={sc.id}
                className={`rounded-lg border bg-white p-4 ${
                  sc.enabled ? "border-line" : "border-dashed border-line opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => updateScDraft(sc.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                    aria-label={`Enable ${draft.label}`}
                  />
                  <input
                    value={draft.label}
                    onChange={(e) => updateScDraft(sc.id, { label: e.target.value })}
                    aria-label="Scenario label"
                    className="w-32 rounded border border-line px-2 py-1 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  />
                  <select
                    value={draft.action}
                    onChange={(e) => updateScDraft(sc.id, { action: e.target.value as ScenarioAction })}
                    aria-label="Action"
                    className="rounded border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                  >
                    <option value="reply">Reply only</option>
                    <option value="book">Reply + book</option>
                    <option value="opt_out">Opt out</option>
                    <option value="none">Stay silent</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    Priority
                    <input
                      type="number"
                      value={draft.priority}
                      onChange={(e) => updateScDraft(sc.id, { priority: Number(e.target.value) })}
                      className="w-14 rounded border border-line px-1.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                  </label>
                  {dirty && (
                    <span className="rounded bg-status-pending/10 px-1.5 py-0.5 text-[11px] font-medium text-status-pending">
                      Unsaved
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-sm">
                    {dirty && (
                      <button
                        onClick={() => saveScenario(sc.id)}
                        disabled={scSavingId === sc.id}
                        className="font-medium text-signal hover:underline disabled:opacity-60"
                      >
                        {scSavingId === sc.id ? "Saving…" : "Save"}
                      </button>
                    )}
                    <button onClick={() => deleteScenario(sc)} className="text-status-failed hover:underline">
                      Delete
                    </button>
                  </span>
                </div>
                <input
                  value={draft.keywords}
                  onChange={(e) => updateScDraft(sc.id, { keywords: e.target.value })}
                  placeholder="Keywords, comma-separated — e.g. yes, interested  (empty = catch-all)"
                  className={`${inputClass} mt-3 text-xs`}
                />
                <textarea
                  rows={2}
                  value={draft.reply_template}
                  onChange={(e) => updateScDraft(sc.id, { reply_template: e.target.value })}
                  placeholder={'Reply copy — e.g. "Great, {name}! When works best for you?"'}
                  className={`${inputClass} mt-2`}
                />
                {draft.reply_template && (
                  <p className="mt-1.5 text-xs text-muted">
                    Preview:{" "}
                    {draft.reply_template
                      .replace(/\{\{\s*name\s*\}\}/g, previewName)
                      .replace(/\{name\}/g, previewName)}
                  </p>
                )}
              </li>
            );
          })}

          {(scNewOpen || scenarios.length === 0) && (
            <li className="rounded-lg border border-dashed border-signal/50 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={scNewForm.label}
                  onChange={(e) => setScNewForm({ ...scNewForm, label: e.target.value })}
                  placeholder="Label — e.g. Interested"
                  aria-label="New scenario label"
                  className="w-40 rounded border border-signal/40 px-2 py-1 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                />
                <select
                  value={scNewForm.action}
                  onChange={(e) => setScNewForm({ ...scNewForm, action: e.target.value as ScenarioAction })}
                  aria-label="New scenario action"
                  className="rounded border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  <option value="reply">Reply only</option>
                  <option value="book">Reply + book</option>
                  <option value="opt_out">Opt out</option>
                  <option value="none">Stay silent</option>
                </select>
                <span className="text-xs text-muted">
                  {scenarios.length === 0
                    ? "Define what the campaign may say when someone replies."
                    : "New scenario"}
                </span>
              </div>
              <input
                value={scNewForm.keywords}
                onChange={(e) => setScNewForm({ ...scNewForm, keywords: e.target.value })}
                placeholder="Keywords, comma-separated — e.g. yes, interested  (empty = catch-all)"
                className={`${inputClass} mt-3 text-xs`}
              />
              <textarea
                rows={2}
                value={scNewForm.reply_template}
                onChange={(e) => setScNewForm({ ...scNewForm, reply_template: e.target.value })}
                placeholder={'Reply copy — e.g. "Great, {name}! When works best for you?"'}
                className={`${inputClass} mt-2`}
              />
              <div className="mt-3 flex justify-end gap-2">
                {scenarios.length > 0 && (
                  <button
                    onClick={() => {
                      setScNewOpen(false);
                      setScError(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={saveNewScenario}
                  disabled={scSavingNew}
                  className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  {scSavingNew ? "Saving…" : "Save scenario"}
                </button>
              </div>
            </li>
          )}
        </ul>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-ink">Audience</h2>
          <p className="text-sm text-muted">
            People are managed on the Contacts page — select them there and use &ldquo;Add to
            campaign&rdquo;. Here you can pull in whole groups at once.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                Add from group
              </label>
              <select
                value={audienceGroupId}
                onChange={(e) => setAudienceGroupId(e.target.value)}
                className={`${inputClass} w-56`}
              >
                <option value="">Choose group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.contact_count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                Into variant
              </label>
              <select
                value={assignVariant}
                onChange={(e) => setAssignVariant(e.target.value)}
                className={`${inputClass} w-40`}
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => applyGroup(false)}
              disabled={!audienceGroupId || !assignVariant || audienceBusy}
              className="rounded-lg bg-signal px-3.5 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-dark"
            >
              {audienceBusy ? "Working…" : "Add group"}
            </button>
            <button
              onClick={() => applyGroup(true)}
              disabled={!audienceGroupId || audienceBusy}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-status-failed hover:bg-status-failed/10 disabled:opacity-50"
            >
              Remove group
            </button>
          </div>
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            {assignedCount} of {rows.length} added contacts assigned to a variant ·{" "}
            {optedOutCount} opted-out will be skipped at send.
          </p>
        </div>
      </section>
    </div>
  );
}