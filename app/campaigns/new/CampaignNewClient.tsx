"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CampaignStatus } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal";

type VariantDraft = { label: string; message_template: string };
type FollowUpDraft = {
  delay_days: number;
  delay_hours: number;
  message_template: string;
  enabled: boolean;
};

export default function NewCampaignPage() {
  const router = useRouter();

  // Basics
  const [name, setName] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [scheduledAt, setScheduledAt] = useState("");

  // Scheduler
  const [minDelay, setMinDelay] = useState(10);
  const [sendStart, setSendStart] = useState("");
  const [sendEnd, setSendEnd] = useState("");

  // AI
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  // Initial messages (variants)
  const [variants, setVariants] = useState<VariantDraft[]>([
    { label: "A", message_template: "" },
  ]);

  // Follow-ups
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const previewName = "Alex";

  function addVariant() {
    const nextLabel = String.fromCharCode(65 + variants.length); // A, B, C...
    setVariants([...variants, { label: nextLabel, message_template: "" }]);
  }
  function updateVariant(idx: number, patch: Partial<VariantDraft>) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function removeVariant(idx: number) {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  function addFollowUp() {
    setFollowUps([...followUps, { delay_days: 1, delay_hours: 0, message_template: "", enabled: true }]);
  }
  function updateFollowUp(idx: number, patch: Partial<FollowUpDraft>) {
    setFollowUps((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function removeFollowUp(idx: number) {
    setFollowUps((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    const cleanVariants = variants
      .map((v) => ({ label: v.label.trim(), message_template: v.message_template.trim() }))
      .filter((v) => v.label && v.message_template);
    if (cleanVariants.length === 0) {
      setError("Add at least one initial message (variant) — this is what contacts receive first.");
      return;
    }
    // validate follow-ups have template if delay set
    for (let i = 0; i < followUps.length; i++) {
      const f = followUps[i];
      if (!f.message_template.trim()) {
        setError(`Follow-up #${i + 1}: message is required or remove it.`);
        return;
      }
      if (f.delay_days === 0 && f.delay_hours === 0) {
        setError(`Follow-up #${i + 1}: delay must be at least 1 hour.`);
        return;
      }
    }

    setSaving(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        status,
        scheduled_at: scheduledAt || null,
        min_delay_seconds: Number(minDelay) || 10,
        send_start_hour: sendStart === "" ? null : Number(sendStart),
        send_end_hour: sendEnd === "" ? null : Number(sendEnd),
        ai_enabled: aiEnabled,
        ai_system_prompt: aiPrompt,
        initialMessages: cleanVariants,
        followUps: followUps.map((f, idx) => ({
          position: idx + 1,
          delay_days: f.delay_days,
          delay_hours: f.delay_hours,
          message_template: f.message_template.trim(),
          enabled: f.enabled,
        })),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to create campaign.");
      return;
    }
    router.push(`/campaigns/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link href="/campaigns" className="text-sm text-muted hover:text-ink">
          ← Back to campaigns
        </Link>
        <h1 className="page-title mt-2">New campaign</h1>
        <p className="mt-1 text-sm text-muted">
          Set up the initial SMS, follow-ups, scheduler and AI in one place. Variants and follow-ups live on the campaign detail page after creation too.
        </p>
      </div>

      {error && <p className="rounded-lg bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basics */}
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-base font-semibold text-ink">1 · Campaign details</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Campaign name *</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Miami cleaning Q1"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)} className={inputClass}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="sending">Sending</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Scheduled time (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Initial messages */}
        <section className="rounded-lg border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">2 · Initial message(s) *</h2>
              <p className="mt-1 text-sm text-muted">
                The first SMS contacts receive. Add variants A/B for testing — contacts are assigned manually. Use <code className="font-mono">{"{{name}}"}</code> for personalization.
              </p>
            </div>
            <button
              type="button"
              onClick={addVariant}
              className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-line/40"
            >
              + Variant
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {variants.map((v, idx) => (
              <div key={idx} className="rounded-lg border border-line/70 bg-paper p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={v.label}
                      onChange={(e) => updateVariant(idx, { label: e.target.value })}
                      maxLength={10}
                      className="w-16 rounded border border-line bg-white px-2 py-1 text-center font-mono text-xs font-semibold text-signal-dark"
                      aria-label={`Variant ${idx + 1} label`}
                    />
                    <span className="text-xs text-muted">Variant {idx + 1}</span>
                  </div>
                  {variants.length > 1 && (
                    <button type="button" onClick={() => removeVariant(idx)} className="text-sm text-status-failed hover:underline">
                      Remove
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={v.message_template}
                  onChange={(e) => updateVariant(idx, { message_template: e.target.value })}
                  placeholder="Hi {{name}}, we help Miami businesses with..."
                  className={`${inputClass} mt-3`}
                  required
                />
                {v.message_template && (
                  <p className="mt-1.5 text-xs text-muted">
                    Preview: {v.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Follow-ups */}
        <section className="rounded-lg border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">3 · Follow-ups</h2>
              <p className="mt-1 text-sm text-muted">
                Auto-nudge contacts who don&apos;t reply. Each follow-up is queued after the initial send if no inbound is seen. Runs inside the send window & global pace.
              </p>
            </div>
            <button
              type="button"
              onClick={addFollowUp}
              className="shrink-0 rounded-lg border border-signal/30 bg-signal-light/40 px-3 py-1.5 text-sm font-medium text-signal-dark hover:bg-signal-light"
            >
              + Follow-up
            </button>
          </div>

          {followUps.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line bg-paper px-4 py-6 text-center text-sm text-muted">
              No follow-ups yet. Add one to re-engage non-responders (e.g. 2 days later).
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {followUps.map((f, idx) => (
                <div key={idx} className="rounded-lg border border-line/70 bg-paper p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="rounded-full bg-signal-light px-2.5 py-0.5 text-xs font-semibold text-signal-dark">
                      #{idx + 1}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        onChange={(e) => updateFollowUp(idx, { enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                      />
                      Enabled
                    </label>
                    <button type="button" onClick={() => removeFollowUp(idx)} className="text-sm text-status-failed hover:underline">
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink">Delay — days</label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={f.delay_days}
                        onChange={(e) => updateFollowUp(idx, { delay_days: Number(e.target.value) })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink">Delay — hours</label>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={f.delay_hours}
                        onChange={(e) => updateFollowUp(idx, { delay_hours: Number(e.target.value) })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Sends {f.delay_days > 0 ? `${f.delay_days}d` : ""} {f.delay_hours > 0 ? `${f.delay_hours}h` : ""} after the initial message if still no reply.
                  </p>

                  <textarea
                    rows={3}
                    value={f.message_template}
                    onChange={(e) => updateFollowUp(idx, { message_template: e.target.value })}
                    placeholder="Hi {{name}}, just bumping this — still interested?"
                    className={`${inputClass} mt-3`}
                  />
                  {f.message_template && (
                    <p className="mt-1.5 text-xs text-muted">
                      Preview: {f.message_template.replace(/\{\{\s*name\s*\}\}/g, previewName)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Scheduler */}
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-base font-semibold text-ink">4 · Scheduler</h2>
          <p className="mt-1 text-sm text-muted">Pace sends and restrict delivery to business hours.</p>
          <div className="mt-4 grid max-w-md grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Min delay (s)</label>
              <input type="number" min={0} value={minDelay} onChange={(e) => setMinDelay(Number(e.target.value))} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">From (24h)</label>
              <input
                type="number"
                min={0}
                max={23}
                placeholder="10"
                value={sendStart}
                onChange={(e) => setSendStart(e.target.value)}
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
                value={sendEnd}
                onChange={(e) => setSendEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Blank window = 24/7. Outside hours are held until the next window.</p>
        </section>

        {/* AI */}
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-base font-semibold text-ink">5 · AI agent (optional)</h2>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
            />
            Let the AI handle replies for this campaign
          </label>
          <p className="mt-1 text-xs text-muted">
            What it may say is limited to <strong>Reply scenarios</strong> on the campaign page.
          </p>
          {aiEnabled && (
            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-ink">Fallback system prompt</label>
              <textarea
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Qualification criteria, tone, business context…"
                className={inputClass}
              />
            </div>
          )}
        </section>

        <div className="flex items-center justify-between gap-3">
          <Link href="/campaigns" className="rounded-lg px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-signal px-6 py-2.5 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
