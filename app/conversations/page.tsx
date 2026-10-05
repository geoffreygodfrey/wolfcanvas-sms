"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, ConversationDetail } from "@/lib/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yday";
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function bubbleTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const clock = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? clock : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

const STATUS_STYLES: Record<string, string> = {
  ai_active: "bg-signal-light text-signal-dark",
  human_takeover: "bg-status-failed/10 text-status-failed",
  closed: "bg-line/60 text-muted",
};

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    ai_active: "AI active",
    human_takeover: "Human",
    closed: "Closed",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${
        STATUS_STYLES[status] ?? "bg-line/60 text-muted"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function QualifiedBadge({ qualified }: { qualified: boolean }) {
  return qualified ? (
    <span className="rounded-full bg-status-delivered/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-status-delivered">
      Qualified
    </span>
  ) : (
    <span className="rounded-full bg-line/60 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
      Not qualified
    </span>
  );
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [qualifiedFilter, setQualifiedFilter] = useState("");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const sp = new URLSearchParams();
    if (campaignId) sp.set("campaign_id", campaignId);
    if (statusFilter) sp.set("status", statusFilter);
    if (qualifiedFilter) sp.set("qualified", qualifiedFilter);
    if (query.trim()) sp.set("q", query.trim());
    const qs = sp.toString();
    const res = await fetch(`/api/conversations${qs ? `?${qs}` : ""}`);
    const rows: Conversation[] = await res.json();
    setConversations(rows);
    return rows;
  }, [campaignId, statusFilter, qualifiedFilter, query]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    setDetail(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      const [cRes] = await Promise.all([fetch("/api/campaigns")]);
      if (cRes.ok) setCampaigns(await cRes.json());
      const params = new URLSearchParams(window.location.search);
      if (params.get("qualified") === "1") setQualifiedFilter("1");
      const rows = await loadConversations();
      setLoading(false);
      const cid = params.get("id");
      if (cid && rows.some((r) => r.id === cid)) {
        setSelected(cid);
        loadDetail(cid);
      } else if (rows.length > 0) {
        setSelected(rows[0].id);
        loadDetail(rows[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  useEffect(() => {
    setLoading(true);
    loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadConversations();
      if (selected) loadDetail(selected);
    }, 20000);
    return () => clearInterval(id);
  }, [selected, loadConversations, loadDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  const selectedRow = conversations.find((c) => c.id === selected) ?? null;

  async function patch(body: Record<string, unknown>) {
    if (!selected) return;
    setError(null);
    const res = await fetch(`/api/conversations/${encodeURIComponent(selected)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Update failed.");
      return;
    }
    const updated = await res.json();
    setDetail((d) => (d ? { ...d, ...updated } : d));
    setConversations((prev) =>
      prev.map((c) => (c.id === selected ? { ...c, ...updated } : c))
    );
    loadConversations();
  }

  async function sendHuman() {
    const body = draft.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(selected)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to send.");
        return;
      }
      setDetail((d) =>
        d
          ? {
              ...d,
              status: "human_takeover",
              messages: [
                ...d.messages,
                {
                  id: json.id,
                  role: "assistant",
                  content: json.content,
                  created_at: json.created_at,
                  message_id: json.message_id,
                  contact_name: json.contact_name,
                  contact_phone: json.contact_phone,
                },
              ],
            }
          : d
      );
      setDraft("");
      loadConversations();
    } catch {
      setError("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  async function takeOver() {
    if (detail?.status === "human_takeover") return;
    await patch({ status: "human_takeover" });
  }

  async function handBack() {
    await patch({ status: "ai_active" });
  }

  async function toggleQualified() {
    await patch({ qualified: !(detail?.qualified ?? false) });
  }

  async function closeConversation() {
    if (!confirm("Close this conversation? The AI agent will stop replying and it won't be resumed."))
      return;
    await patch({ status: "closed" });
  }

  const filterSelect = (value: string, onChange: (v: string) => void, options: { v: string; l: string }[]) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="reveal">
          <p className="eyebrow">Review</p>
          <h1 className="page-title mt-1">Conversations</h1>
          <p className="mt-1 text-sm text-muted">
            AI agent transcripts — review qualifying leads, take over threads, or hand them back.
          </p>
        </div>
        <button onClick={loadConversations} className="text-sm text-signal hover:underline">
          Refresh
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by contact…"
          className="w-56 rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
        />
        {filterSelect(campaignId, setCampaignId, [
          { v: "", l: "All campaigns" },
          ...campaigns.map((c) => ({ v: c.id, l: c.name })),
        ])}
        {filterSelect(statusFilter, setStatusFilter, [
          { v: "", l: "Any status" },
          { v: "ai_active", l: "AI active" },
          { v: "human_takeover", l: "Human takeover" },
          { v: "closed", l: "Closed" },
        ])}
        {filterSelect(qualifiedFilter, setQualifiedFilter, [
          { v: "", l: "Any qualification" },
          { v: "1", l: "Qualified" },
          { v: "0", l: "Not qualified" },
        ])}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading conversations…</p>
      ) : conversations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-14 text-center">
          <p className="text-sm font-medium text-ink">No AI conversations yet.</p>
          <p className="mt-1 text-sm text-muted">
            When an ai-enabled campaign gets replies, the transcripts show up here for review.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white lg:flex lg:h-[calc(100vh-15rem)] lg:min-h-[32rem]">
          <div className={`${selected ? "hidden lg:flex" : "flex"} h-[24rem] w-full flex-col lg:h-full lg:w-96`}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {conversations.map((c) => {
                const isSelected = selected === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={`flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
                      isSelected ? "bg-signal-light" : "hover:bg-line/30"
                    }`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal-light text-sm font-semibold text-signal-dark">
                      {initials(c.contact_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{c.contact_name}</span>
                        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                          {c.last_message_at ? timeAgo(c.last_message_at) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <StatusBadge status={c.status} />
                        {c.qualified && <QualifiedBadge qualified />}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-muted">
                        {c.last_direction === "inbound" ? "→ " : "← "}
                        {c.last_message?.slice(0, 60) ?? "No messages"}
                      </span>
                      {c.campaign_name && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {c.campaign_name}
                          {c.appointment_count > 0 ? ` · ${c.appointment_count} booked` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`${selected ? "flex" : "hidden lg:flex"} w-full flex-col border-t border-line lg:min-w-0 lg:flex-1 lg:border-l lg:border-t-0`}>
            {selectedRow && detail ? (
              <>
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                  <button
                    onClick={() => setSelected(null)}
                    className="rounded-md px-2 py-1 text-sm text-muted hover:bg-line/50 hover:text-ink lg:hidden"
                  >
                    ←
                  </button>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-signal-light text-sm font-semibold text-signal-dark">
                    {initials(selectedRow.contact_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-sm font-semibold text-ink">{selectedRow.contact_name}</div>
                      <StatusBadge status={selectedRow.status} />
                      <QualifiedBadge qualified={selectedRow.qualified} />
                    </div>
                    <div className="font-mono text-xs text-muted">
                      {selectedRow.phone}
                      {selectedRow.opted_out ? " · opted out" : ""}
                      {selectedRow.campaign_name ? ` · ${selectedRow.campaign_name}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedRow.status === "ai_active" ? (
                      <button
                        onClick={takeOver}
                       
                        className="rounded-md border border-status-failed/40 px-3 py-1.5 text-xs font-medium text-status-failed hover:bg-status-failed/10"
                      >
                        Take over
                      </button>
                    ) : selectedRow.status === "human_takeover" ? (
                      <button
                        onClick={handBack}
                       
                        className="rounded-md border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal-dark hover:bg-signal-light"
                      >
                        Resume AI
                      </button>
                    ) : null}
                    <button
                      onClick={toggleQualified}
                     
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-line/40"
                    >
                      {selectedRow.qualified ? "Mark unqualified" : "Mark qualified"}
                    </button>
                    <button
                      onClick={closeConversation}
                     
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-line/40 hover:text-status-failed"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {detail.appointments.length > 0 && (
                  <div className="border-b border-line bg-signal-light/30 px-4 py-2.5">
                    {detail.appointments.map((a) => (
                      <span key={a.id} className="text-xs text-signal-dark">
                        Booked · {new Date(a.scheduled_at).toLocaleString()} ·{" "}
                        <span className="capitalize">{a.status}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-line/20 px-4 py-5">
                  {detail.messages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted">
                      This conversation has no messages yet.
                    </p>
                  ) : (
                    detail.messages.map((m) => {
                      if (m.role === "system") {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <span className="max-w-[80%] rounded-lg bg-white/70 px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-wide text-muted">
                              {m.content}
                            </span>
                          </div>
                        );
                      }
                      const out = m.role === "assistant";
                      return (
                        <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                              out
                                ? "rounded-br-sm bg-signal text-white"
                                : "rounded-bl-sm border border-line bg-white text-ink"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                            <div className="mt-1 flex items-center justify-end gap-1.5">
                              <span className={`text-[10px] ${out ? "text-white/70" : "text-muted"}`}>
                                {bubbleTime(m.created_at)}
                              </span>
                              {out && (
                                <span className="text-[10px] uppercase tracking-wide text-white/50">
                                  {m.message_id ? "human" : "AI"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  {sending && (
                    <div className="flex justify-end">
                      <div className="rounded-2xl rounded-br-sm bg-signal/70 px-3.5 py-2 text-sm text-white">
                        Sending…
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-line bg-white p-3">
                  {selectedRow.opted_out ? (
                    <p className="rounded-lg bg-status-failed/10 px-3 py-2.5 text-sm text-status-failed">
                      This contact opted out — replies are blocked.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-end gap-2">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              sendHuman();
                            }
                          }}
                          rows={2}
                          placeholder={
                            selectedRow.status === "ai_active"
                              ? "Reply — taking over pauses the AI agent…"
                              : "Reply as a human…"
                          }
                          className="min-h-[3rem] flex-1 resize-none rounded-lg border border-line bg-white px-3.5 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
                        />
                        <button
                          onClick={sendHuman}
                          disabled={!draft.trim() || sending}
                          className="rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                        >
                          Send
                        </button>
                      </div>
                      {error && <p className="mt-2 text-xs text-status-failed">{error}</p>}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="py-16 text-center text-sm text-muted">Select a conversation to review it.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
