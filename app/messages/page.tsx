"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Contact } from "@/lib/types";

interface Thread {
  contact_id: string;
  name: string;
  phone: string;
  opted_out: boolean;
  last_message: string;
  last_direction: "inbound" | "outbound";
  last_status: string;
  last_message_at: string;
  inbound_count: number;
  groups: string[];
}

interface MessageRow {
  id: string;
  contact_id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  error_detail: string | null;
  sent_at: string;
  contact_name: string;
  phone: string;
  opted_out: boolean;
  campaign_name: string | null;
  variant_label: string | null;
}

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

const MODEL_STYLES: Record<string, string> = {
  delivered: "text-status-delivered",
  failed: "text-status-failed",
  sent: "text-white/70",
  queued: "text-white/70",
};

function ThreadList({
  threads,
  newContacts,
  selected,
  query,
  onQuery,
  onSelect,
}: {
  threads: Thread[];
  newContacts: Contact[];
  selected: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col lg:w-80 lg:border-r lg:border-line">
      <div className="border-b border-line p-3">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search conversations or contacts"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.length === 0 && newContacts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No conversations yet. Search for a contact to text them.
          </p>
        ) : (
          <>
            {newContacts.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Start a conversation
                </div>
                {newContacts.map((c) => {
                  const isSelected = selected === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelect(c.id)}
                      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
                        isSelected ? "bg-signal-light" : "hover:bg-line/30"
                      }`}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal-light text-sm font-semibold text-signal-dark">
                        {initials(c.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                        {c.groups && c.groups.length > 0 && (
                          <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wide text-signal-dark">
                            {c.groups.join(" · ")}
                          </span>
                        )}
                        <span className="mt-0.5 block truncate font-mono text-xs text-muted">
                          {c.phone} · no messages yet
                        </span>
                      </span>
                    </button>
                  );
                })}
                <div className="mx-3 my-1 border-t border-line/70" />
              </>
            )}
            {threads.length > 0 && (
              <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Conversations
              </div>
            )}
            {threads.map((t) => {
              const isSelected = selected === t.contact_id;
              return (
                <button
                  key={t.contact_id}
                  onClick={() => onSelect(t.contact_id)}
                  className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
                    isSelected ? "bg-signal-light" : "hover:bg-line/30"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal-light text-sm font-semibold text-signal-dark">
                    {initials(t.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{t.name}</span>
                      {t.groups?.slice(0, 2).map((g) => (
                        <span
                          key={g}
                          className="shrink-0 rounded-full bg-signal-light px-2 py-px font-mono text-[9px] font-medium uppercase tracking-wide text-signal-dark"
                        >
                          {g}
                        </span>
                      ))}
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                        {timeAgo(t.last_message_at)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-xs ${
                          isSelected ? "text-signal-dark/80" : "text-muted"
                        }`}
                      >
                        {t.last_direction === "inbound" ? "→ " : "← "}
                        {t.last_message}
                      </span>
                      {t.inbound_count > 0 && (
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-signal px-1 font-mono text-[10px] font-semibold text-white">
                          {t.inbound_count}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<{ name: string; phone: string; opted_out: boolean; groups?: string[] } | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const res = await fetch(
      `/api/messages/threads${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`
    );
    const rows: Thread[] = await res.json();
    setThreads(rows);
  }, [query]);

  const loadMessages = useCallback(async (contactId: string) => {
    const res = await fetch(`/api/messages?contact_id=${encodeURIComponent(contactId)}`);
    const rows: MessageRow[] = await res.json();
    setMessages(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/messages/threads");
      const rows: Thread[] = await res.json();
      if (cancelled) return;
      setThreads(rows);
      setLoading(false);

      const cid = new URLSearchParams(window.location.search).get("contact");
      if (cid) {
        const t = rows.find((r) => r.contact_id === cid);
        if (t) {
          setSelected(cid);
          setSelectedMeta({ name: t.name, phone: t.phone, opted_out: t.opted_out, groups: t.groups });
        } else {
          const cr = await fetch(`/api/contacts/${encodeURIComponent(cid)}`);
          if (cr.ok && !cancelled) {
            const c = (await cr.json()) as Contact;
            setSelected(cid);
            setSelectedMeta({ name: c.name, phone: c.phone, opted_out: c.opted_out, groups: c.groups ?? [] });
          }
        }
      } else if (rows.length > 0) {
        setSelected((s) => s ?? rows[0].contact_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setContactResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
        const rows: Contact[] = await res.json();
        if (!cancelled) setContactResults(rows);
      } catch {
        if (!cancelled) setContactResults([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads, query]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/messages?contact_id=${encodeURIComponent(selected)}`);
      const rows: MessageRow[] = await res.json();
      if (!cancelled) setMessages(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadThreads();
      if (selected) loadMessages(selected);
    }, 20000);
    return () => clearInterval(id);
  }, [selected, loadThreads, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const newContacts = contactResults.filter((c) => !threads.some((t) => t.contact_id === c.id));
  const selectedThread = threads.find((t) => t.contact_id === selected) ?? null;
  const activeContact =
    selectedThread ??
    (selected && selectedMeta ? ({ contact_id: selected, ...selectedMeta } as Thread) : null);

  function selectConversation(id: string) {
    const t = threads.find((x) => x.contact_id === id);
    if (t) {
      setSelectedMeta({ name: t.name, phone: t.phone, opted_out: t.opted_out, groups: t.groups });
    } else {
      const c = contactResults.find((x) => x.id === id);
      if (c) setSelectedMeta({ name: c.name, phone: c.phone, opted_out: c.opted_out, groups: c.groups ?? [] });
    }
    setSelected(id);
  }

  async function send() {
    const body = draft.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: selected, body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSendError(json.error ?? "Failed to send.");
        return;
      }
      setMessages((prev) => [...prev, json as MessageRow]);
      setDraft("");
      loadThreads();
    } catch {
      setSendError("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="reveal">
          <p className="eyebrow">Threads</p>
          <h1 className="page-title mt-1">Messages</h1>
          <p className="mt-1 text-sm text-muted">Inbound and outbound SMS in one place</p>
        </div>
        <button onClick={loadThreads} className="text-sm text-signal hover:underline">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading conversations…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white lg:flex lg:h-[calc(100vh-13rem)] lg:min-h-[30rem]">
          <div className={`${selected ? "hidden lg:flex" : "flex"} h-[22rem] w-full flex-col lg:h-full lg:w-80`}>
            <ThreadList
              threads={threads}
              newContacts={newContacts}
              selected={selected}
              query={query}
              onQuery={setQuery}
              onSelect={selectConversation}
            />
          </div>

          <div className={`${selected ? "flex" : "hidden lg:flex"} w-full flex-col lg:min-w-0 lg:flex-1`}>
            {activeContact ? (
              <>
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <button
                    onClick={() => setSelected(null)}
                    className="rounded-md px-2 py-1 text-sm text-muted hover:bg-line/50 hover:text-ink lg:hidden"
                  >
                    ←
                  </button>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-signal-light text-sm font-semibold text-signal-dark">
                    {initials(activeContact.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-sm font-semibold text-ink">{activeContact.name}</div>
                      {activeContact.groups?.slice(0, 2).map((g) => (
                        <span
                          key={g}
                          className="shrink-0 rounded-full bg-signal-light px-2 py-px font-mono text-[9px] font-medium uppercase tracking-wide text-signal-dark"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                    <div className="font-mono text-xs text-muted">
                      {activeContact.phone}
                      {activeContact.opted_out ? " · opted out" : ""}
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-line/20 px-4 py-5">
                  {messages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted">
                      No messages with this contact yet. Text them below to start the conversation.
                    </p>
                  ) : (
                    messages.map((m) => {
                      const out = m.direction === "outbound";
                      return (
                        <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                              out
                                ? "rounded-br-sm bg-signal text-white"
                                : "rounded-bl-sm border border-line bg-white text-ink"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <div className="mt-1 flex items-center justify-end gap-1.5">
                              <span
                                className={`text-[10px] ${
                                  out ? "text-white/70" : "text-muted"
                                }`}
                              >
                                {bubbleTime(m.sent_at)}
                              </span>
                              {out && (
                                <span
                                  className={`text-[10px] font-medium capitalize ${MODEL_STYLES[m.status] ?? "text-white/70"}`}
                                  title={m.error_detail ?? undefined}
                                >
                                  {m.status}
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
                  {activeContact.opted_out ? (
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
                              send();
                            }
                          }}
                          rows={2}
                          placeholder="Text this contact…"
                          className="min-h-[3rem] flex-1 resize-none rounded-lg border border-line bg-white px-3.5 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
                        />
                        <button
                          onClick={send}
                          disabled={!draft.trim() || sending}
                          className="rounded-lg bg-signal px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                        >
                          Send
                        </button>
                      </div>
                      {sendError && <p className="mt-2 text-xs text-status-failed">{sendError}</p>}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="py-16 text-center text-sm text-muted">Select a conversation to view it.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}