"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import type { Contact, ContactGroup } from "@/lib/types";
import { CONTACT_TAG_PRESETS } from "@/lib/tags";

const EMPTY_FORM = { name: "", email: "", phone: "" };

const TEMPLATE_CSV = "name,email,phone,consent_status\nJane Smith,jane@example.com,+447911123456,opted_in\nJohn Doe,john@example.com,+14401234567,";

function GroupChips({ groups }: { groups?: string[] }) {
  if (!groups?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.map((g) => (
        <span
          key={g}
          className="rounded-full bg-signal-light px-2 py-0.5 font-mono text-[10px] font-medium text-signal-dark"
        >
          {g}
        </span>
      ))}
    </div>
  );
}

const TAG_STYLES: Record<string, string> = {
  "Needs qualification": "bg-signal-light text-signal-dark",
  "Needs follow up": "bg-status-pending/10 text-status-pending",
  "Needs reminder": "bg-status-delivered/10 text-status-delivered",
  "Awaiting deletion": "bg-status-failed/10 text-status-failed",
};

function TagChips({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
            TAG_STYLES[t] ?? "bg-line/60 text-muted"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function TagControl({
  value,
  onChange,
  busy,
  onApply,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onApply: (remove: boolean) => void;
}) {
  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
      >
        <option value="">Tag as…</option>
        {CONTACT_TAG_PRESETS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        onClick={() => onApply(false)}
        disabled={!value || busy}
        className="rounded-md bg-signal px-3 py-1.5 font-medium text-white hover:bg-signal-dark disabled:opacity-60"
      >
        Tag
      </button>
      <button
        onClick={() => onApply(true)}
        disabled={!value || busy}
        className="rounded-md border border-signal/40 bg-white px-3 py-1.5 font-medium text-signal-dark hover:border-signal disabled:opacity-60"
      >
        Untag
      </button>
    </>
  );
}

function OptOutBanner({ onPurged }: { onPurged: () => void }) {
  const [stats, setStats] = useState<{
    opted_out: number;
    purge_days: number;
    eligible_contacts: number;
  } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [statsRes, meRes] = await Promise.all([fetch("/api/contacts/optouts"), fetch("/api/auth/me")]);
      if (cancelled) return;
      if (statsRes.ok) setStats(await statsRes.json());
      if (meRes.ok) {
        const data = await meRes.json();
        setAdmin((data.user?.role ?? "member") === "admin");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats || stats.opted_out === 0) return null;

  async function purge() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/optouts", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Purge failed.");
        return;
      }
      const result = await res.json();
      const res2 = await fetch("/api/contacts/optouts");
      if (res2.ok) setStats(await res2.json());
      if (result.contacts > 0) onPurged();
    } finally {
      setBusy(false);
    }
  }

  const subtitle = admin
    ? `${stats.eligible_contacts} past ${stats.purge_days} days can be permanently deleted now.`
    : `Auto-deleted after ${stats.purge_days} days.`;

  return (
    <div className="mb-4 rounded-lg border border-status-optedout/30 bg-status-optedout/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">
            {stats.opted_out} contact{stats.opted_out === 1 ? "" : "s"} opted out.
          </p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        {admin && (
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-status-failed">{error}</span>}
            <button
              onClick={purge}
              disabled={busy || stats.eligible_contacts === 0}
              className="rounded-md bg-signal px-3 py-1.5 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {busy ? "Purging…" : "Purge now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importGroupId, setImportGroupId] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: { row: number; reason: string }[]; group_name?: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [copyGroupId, setCopyGroupId] = useState("");
  const [tagToApply, setTagToApply] = useState("");
  const [consentTarget, setConsentTarget] = useState("");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);

  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerHits, setPickerHits] = useState<Contact[]>([]);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);

  // Selection -> campaign membership dialog
  const [campOpen, setCampOpen] = useState(false);
  const [campList, setCampList] = useState<{ id: string; name: string }[]>([]);
  const [campId, setCampId] = useState("");
  const [campVariants, setCampVariants] = useState<{ id: string; label: string }[]>([]);
  const [campVariantId, setCampVariantId] = useState("");
  const [campBusy, setCampBusy] = useState(false);

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/contact-groups");
    if (res.ok) setGroups(await res.json());
  }, []);

  const loadContacts = useCallback(async (gid: string | null, q: string) => {
    setLoading(true);
    let url: string;
    if (q.trim()) {
      url = `/api/contacts?q=${encodeURIComponent(q.trim())}`; // search is always global
    } else if (gid) {
      url = `/api/contact-groups/${encodeURIComponent(gid)}/contacts`;
    } else {
      url = "/api/contacts";
    }
    const res = await fetch(url);
    const rows = await res.json();
    setContacts(rows);
    setSelectedIds([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGroups();
    loadContacts(null, "");
  }, [loadGroups, loadContacts]);

  useEffect(() => {
    const timeout = setTimeout(() => loadContacts(activeGroup, query), 250);
    return () => clearTimeout(timeout);
  }, [query, activeGroup, loadContacts]);

  const activeGroupInfo = groups.find((g) => g.id === activeGroup) ?? null;
  const inGroupView = Boolean(activeGroup && !query.trim());
  const showCheckboxes = activeGroup ? !query.trim() : true;
  const showChips = !inGroupView;

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setForm({ name: contact.name, email: contact.email ?? "", phone: contact.phone });
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    let res: Response;
    if (editing) {
      res = await fetch(`/api/contacts/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else if (activeGroup) {
      res = await fetch(`/api/contact-groups/${encodeURIComponent(activeGroup)}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: form }),
      });
    } else {
      res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setModalOpen(false);
    loadContacts(activeGroup, query);
    loadGroups();
  }

  async function handleDelete(contact: Contact) {
    if (!confirm(`Remove ${contact.name} from contacts? This deletes them everywhere.`)) return;
    await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
    loadContacts(activeGroup, query);
    loadGroups();
  }

  async function handleRemoveFromGroup(contact: Contact) {
    if (!activeGroup) return;
    await fetch(`/api/contact-groups/${encodeURIComponent(activeGroup)}/contacts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: [contact.id] }),
    });
    loadContacts(activeGroup, query);
    loadGroups();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.length === contacts.length ? [] : contacts.map((c) => c.id)));
  }

  async function handleCopyToGroup() {
    if (!copyGroupId || selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/contact-groups/${encodeURIComponent(copyGroupId)}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_ids: selectedIds }),
      });
      const json = await res.json();
      const target = groups.find((g) => g.id === copyGroupId)?.name ?? "group";
      setCopyMsg(`Copied ${json.added ?? selectedIds.length} to ${target}.`);
      setTimeout(() => setCopyMsg(null), 4000);
      loadGroups();
    } finally {
      setBulkBusy(false);
      setSelectedIds([]);
    }
  }

  async function applyTag(remove: boolean) {
    if (!tagToApply || selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds, tag: tagToApply, remove }),
      });
      if (!res.ok) return;
      setCopyMsg(
        remove
          ? `Removed "${tagToApply}" from ${selectedIds.length}.`
          : `Tagged ${selectedIds.length} "${tagToApply}".`
      );
      setTimeout(() => setCopyMsg(null), 4000);
      setSelectedIds([]);
      setTagToApply("");
      await loadContacts(activeGroup, query);
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyConsent() {
    if (!consentTarget || selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/contacts/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, status: consentTarget }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Consent update failed.");
      const label = consentTarget === "opted_in" ? "opted in" : "opted out";
      setCopyMsg(`Marked ${json.updated ?? selectedIds.length} as ${label}.`);
      setTimeout(() => setCopyMsg(null), 4000);
      setConsentTarget("");
      setSelectedIds([]);
      await loadContacts(activeGroup, query);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Consent update failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulk(action: "remove" | "delete") {
    if (selectedIds.length === 0) return;
    if (action === "remove" && !activeGroup) return;
    if (action === "delete") {
      const ok = confirm(
        `Delete ${selectedIds.length} contact${selectedIds.length === 1 ? "" : "s"} everywhere? This can't be undone.`
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      if (action === "remove") {
        await fetch(`/api/contact-groups/${encodeURIComponent(activeGroup!)}/contacts`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: selectedIds }),
        });
      } else {
        await Promise.all(selectedIds.map((id) => fetch(`/api/contacts/${id}`, { method: "DELETE" })));
      }
      await loadContacts(activeGroup, query);
      loadGroups();
    } finally {
      setBulkBusy(false);
    }
  }

  async function openCampDialog() {
    setCampOpen(true);
    setCampId("");
    setCampVariants([]);
    setCampVariantId("");
    const res = await fetch("/api/campaigns");
    if (res.ok) setCampList(await res.json());
  }

  async function pickCampaign(cid: string) {
    setCampId(cid);
    setCampVariants([]);
    setCampVariantId("");
    if (!cid) return;
    const res = await fetch(`/api/campaigns/${cid}/variants`);
    if (res.ok) setCampVariants(await res.json());
  }

  async function applyToCampaign(remove: boolean) {
    if (!campId || selectedIds.length === 0 || campBusy) return;
    if (!remove && !campVariantId) return;
    setCampBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: selectedIds,
          variantId: remove ? null : campVariantId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update campaign membership.");
        return;
      }
      const name = campList.find((c) => c.id === campId)?.name ?? "campaign";
      setCopyMsg(
        remove
          ? `Removed ${selectedIds.length} from ${name}.`
          : `Added ${selectedIds.length} to ${name}.`
      );
      setTimeout(() => setCopyMsg(null), 4000);
      setSelectedIds([]);
      setCampOpen(false);
    } finally {
      setCampBusy(false);
    }
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name || addingGroup) return;
    setAddingGroup(true);
    setGroupError(null);
    const res = await fetch("/api/contact-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    setAddingGroup(false);
    if (!res.ok) {
      setGroupError(json.error ?? "Couldn't create group.");
      return;
    }
    setNewGroupName("");
    await loadGroups();
    setActiveGroup(json.id);
    loadContacts(json.id, query);
  }

  async function handleDeleteGroup() {
    if (!activeGroupInfo) return;
    if (
      !confirm(
        `Delete group "${activeGroupInfo.name}" (${activeGroupInfo.contact_count} members)? The contacts themselves are kept.`
      )
    )
      return;
    await fetch(`/api/contact-groups/${encodeURIComponent(activeGroupInfo.id)}`, { method: "DELETE" });
    setActiveGroup(null);
    loadGroups();
    loadContacts(null, "");
  }

  async function handleImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const csv = await importFile.text();
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, groupId: importGroupId || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setImportError(json.error ?? "Import failed.");
        return;
      }
      setImportResult(json);
      loadContacts(activeGroup, query);
      loadGroups();
    } catch {
      setImportError("Couldn’t read that file.");
    } finally {
      setImportBusy(false);
    }
  }

  function openImport() {
    setImportOpen(true);
    setImportFile(null);
    setImportGroupId(activeGroup ?? "");
    setDragActive(false);
    setImportResult(null);
    setImportError(null);
  }

  function handleDropFile(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setImportFile(file);
  }

  useEffect(() => {
    const q = pickerQuery.trim();
    if (!q) {
      setPickerHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
        const rows: Contact[] = await res.json();
        if (!cancelled) setPickerHits(rows.slice(0, 30));
      } catch {
        if (!cancelled) setPickerHits([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pickerQuery]);

  async function addExisting() {
    if (!activeGroup || pickerSelected.length === 0) return;
    setPickerBusy(true);
    await fetch(`/api/contact-groups/${encodeURIComponent(activeGroup)}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: pickerSelected }),
    });
    setPickerBusy(false);
    setAddExistingOpen(false);
    loadContacts(activeGroup, query);
    loadGroups();
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="reveal">
          <p className="eyebrow">People</p>
          <h1 className="page-title mt-1">Contacts</h1>
          <p className="mt-1 text-sm text-muted">
            {contacts.length} shown{activeGroupInfo ? ` · in ${activeGroupInfo.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openImport}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:border-signal/40 hover:text-signal focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            Import CSV
          </button>
          <button
            onClick={openAdd}
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-dark"
          >
            Add contact
          </button>
        </div>
      </div>

      <div className="lg:flex lg:gap-6">
        <aside className="mb-4 shrink-0 lg:mb-0 lg:w-52">
          <div className="space-y-1">
            <button
              onClick={() => {
                setActiveGroup(null);
                setQuery("");
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                !activeGroup ? "bg-signal-light font-medium text-signal-dark" : "text-ink/70 hover:bg-line/40 hover:text-ink"
              }`}
            >
              <span className="truncate">All contacts</span>
              {!activeGroup && <span className="font-mono text-xs text-signal-dark">{contacts.length}</span>}
            </button>

            {groups.map((g) => {
              const active = activeGroup === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => {
                    setActiveGroup(g.id);
                    setQuery("");
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                    active
                      ? "bg-signal-light font-medium text-signal-dark"
                      : "text-ink/70 hover:bg-line/40 hover:text-ink"
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  {active && <span className="font-mono text-xs text-signal-dark">{g.contact_count}</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-line pt-3">
            {groupError && <p className="mb-2 text-xs text-status-failed">{groupError}</p>}
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createGroup();
              }}
              placeholder="New group name"
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
            <button
              onClick={createGroup}
              disabled={addingGroup || !newGroupName.trim()}
              className="mt-2 w-full rounded-md border border-signal/30 bg-signal-light/50 px-3 py-2 text-sm font-medium text-signal-dark hover:border-signal/60 disabled:opacity-50"
            >
              {addingGroup ? "Creating…" : "+ New group"}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {activeGroup && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">{activeGroupInfo?.name}</p>
                <p className="font-mono text-xs text-muted">
                  {activeGroupInfo?.contact_count ?? 0} contact{activeGroupInfo?.contact_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={openAdd} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:border-signal/40 hover:text-signal">
                  + Add new
                </button>
                <button
                  onClick={() => {
                    setPickerQuery("");
                    setPickerSelected([]);
                    setAddExistingOpen(true);
                  }}
                  className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:border-signal/40 hover:text-signal"
                >
                  + Add existing
                </button>
                <button
                  onClick={handleDeleteGroup}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-status-failed hover:bg-status-failed/10"
                >
                  Delete group
                </button>
              </div>
            </div>
          )}

          {activeGroup && inGroupView && selectedIds.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-signal/30 bg-signal-light/60 px-4 py-2 text-sm">
              <span className="font-medium text-signal-dark">
                {selectedIds.length} selected
              </span>
              <div className="flex flex-wrap gap-2">
                <TagControl value={tagToApply} onChange={setTagToApply} busy={bulkBusy} onApply={applyTag} />
                <select
                  value={consentTarget}
                  onChange={(e) => setConsentTarget(e.target.value)}
                  disabled={bulkBusy}
                  className="rounded-md border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  <option value="">Consent…</option>
                  <option value="opted_in">Opted in</option>
                  <option value="opted_out">Opted out</option>
                </select>
                <button
                  onClick={applyConsent}
                  disabled={!consentTarget || bulkBusy}
                  className="rounded-md bg-signal px-3 py-1.5 font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  Apply
                </button>
                <button
                  onClick={openCampDialog}
                  disabled={bulkBusy}
                  className="rounded-md border border-signal/40 bg-white px-3 py-1.5 font-medium text-signal-dark hover:border-signal disabled:opacity-60"
                >
                  Add to campaign…
                </button>
                <button
                  onClick={() => handleBulk("remove")}
                  disabled={bulkBusy}
                  className="rounded-md bg-signal px-3 py-1.5 font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  Remove from group
                </button>
                <button
                  onClick={() => handleBulk("delete")}
                  disabled={bulkBusy}
                  className="rounded-md px-3 py-1.5 font-medium text-status-failed hover:bg-status-failed/10 disabled:opacity-60"
                >
                  Delete globally
                </button>
              </div>
            </div>
          )}

          {!activeGroup && selectedIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal/30 bg-signal-light/60 px-4 py-2 text-sm">
              <span className="font-medium text-signal-dark">
                {selectedIds.length} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={copyGroupId}
                  onChange={(e) => setCopyGroupId(e.target.value)}
                  className="rounded-md border border-line bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  <option value="">Copy to group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCopyToGroup}
                  disabled={!copyGroupId || bulkBusy}
                  className="rounded-md bg-signal px-3 py-1.5 font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  {bulkBusy ? "Copying…" : "Copy"}
                </button>
                <TagControl value={tagToApply} onChange={setTagToApply} busy={bulkBusy} onApply={applyTag} />
                <select
                  value={consentTarget}
                  onChange={(e) => setConsentTarget(e.target.value)}
                  disabled={bulkBusy}
                  className="rounded-md border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  <option value="">Consent…</option>
                  <option value="opted_in">Opted in</option>
                  <option value="opted_out">Opted out</option>
                </select>
                <button
                  onClick={applyConsent}
                  disabled={!consentTarget || bulkBusy}
                  className="rounded-md bg-signal px-3 py-1.5 font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  Apply
                </button>
                <button
                  onClick={openCampDialog}
                  disabled={bulkBusy}
                  className="rounded-md border border-signal/40 bg-white px-3 py-1.5 font-medium text-signal-dark hover:border-signal disabled:opacity-60"
                >
                  Add to campaign…
                </button>
                <button
                  onClick={() => handleBulk("delete")}
                  disabled={bulkBusy}
                  className="rounded-md px-3 py-1.5 font-medium text-status-failed hover:bg-status-failed/10 disabled:opacity-60"
                >
                  Delete selected
                </button>
              </div>
            </div>
          )}

          {copyMsg && (
            <p className="mb-3 rounded-lg border border-signal/30 bg-signal-light/60 px-4 py-2 text-sm font-medium text-signal-dark">
              {copyMsg}
            </p>
          )}

          <OptOutBanner onPurged={() => loadContacts(activeGroup, query)} />

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all contacts by name, email, or phone"
            className="mb-4 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:border-signal"
          />

          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {showCheckboxes && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={contacts.length > 0 && selectedIds.length === contacts.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={showCheckboxes ? 6 : 5} className="px-4 py-8 text-center text-muted">
                      Loading…
                    </td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={showCheckboxes ? 6 : 5} className="px-4 py-8 text-center text-muted">
                      {inGroupView
                        ? "This group is empty. Add a contact or import a CSV into it."
                        : "No contacts found. Add your first one to get started."}
                    </td>
                  </tr>
                ) : (
                  contacts.map((c) => (
                    <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-line/20">
                      {showCheckboxes && (
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                            aria-label={`Select ${c.name}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{c.name}</div>
                        <TagChips tags={c.tags} />
                        {showChips && <GroupChips groups={c.groups} />}
                      </td>
                      <td className="px-4 py-2.5 text-ink/70">{c.email || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-ink/70">{c.phone}</td>
                      <td className="px-4 py-2.5">
                        {c.opted_out ? (
                          <span className="rounded-full bg-status-optedout/10 px-2 py-0.5 text-xs font-medium text-status-optedout">
                            Opted out
                          </span>
                        ) : (
                          <span className="rounded-full bg-status-delivered/10 px-2 py-0.5 text-xs font-medium text-status-delivered">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/messages?contact=${c.id}`} className="mr-3 font-medium text-signal hover:underline">
                          Message
                        </Link>
                        {inGroupView && (
                          <button
                            onClick={() => handleRemoveFromGroup(c)}
                            className="mr-3 text-signal hover:underline"
                            title="Remove from this group only"
                          >
                            Remove
                          </button>
                        )}
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
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit contact" : "Add contact"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}
          {!editing && activeGroupInfo && (
            <p className="rounded-md bg-signal-light/60 px-3 py-2 text-sm text-signal-dark">
              Will be added to <span className="font-semibold">{activeGroupInfo.name}</span>
            </p>
          )}
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
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Phone (E.164 format)</label>
            <input
              required
              placeholder="+447911123456"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
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
              {saving ? "Saving…" : editing ? "Save changes" : "Add contact"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import contacts from CSV">
        <div className="space-y-4">
          {importError && (
            <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{importError}</p>
          )}

          {importResult ? (
            <div>
              <div className="mb-3 flex flex-wrap gap-3 text-sm">
                <span className="rounded-md bg-status-delivered/10 px-3 py-1.5 font-medium text-status-delivered">
                  {importResult.imported} imported
                </span>
                <span className="rounded-md bg-line px-3 py-1.5 font-medium text-ink/70">
                  {importResult.duplicates} already existed
                </span>
                {importResult.group_name && (
                  <span className="rounded-md bg-signal-light px-3 py-1.5 font-medium text-signal-dark">
                    Saved to {importResult.group_name}
                  </span>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-line bg-paper">
                  {importResult.errors.map((er) => (
                    <div key={er.row} className="border-b border-line/70 px-3 py-1.5 font-mono text-xs text-ink/70 last:border-0">
                      Row {er.row}: {er.reason}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setImportOpen(false);
                  setImportResult(null);
                }}
                className="mt-3 w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Save into contact group</label>
                <select
                  value={importGroupId}
                  onChange={(e) => setImportGroupId(e.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                >
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDropFile}
                className={`block cursor-pointer rounded-md border border-dashed px-4 py-8 text-center text-sm transition-colors ${
                  dragActive ? "border-signal bg-signal-light/40 text-signal-dark" : "border-line bg-paper text-muted"
                } hover:border-signal/50`}
              >
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                {importFile ? (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-medium text-signal-dark">{importFile.name}</span>
                    <span className="text-xs">Drop a different file to replace it</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span>{dragActive ? "Drop it here" : "Drop your .csv file here"}</span>
                    <span className="text-xs">or click to browse your PC</span>
                  </div>
                )}
              </label>

              <p className="text-xs leading-relaxed text-muted">
                Columns: <code className="font-mono">name</code> and <code className="font-mono">phone</code> are
                required; <code className="font-mono">email</code>, <code className="font-mono">consent_status</code>, and{" "}
                <code className="font-mono">opted_out</code> are optional. A header row is auto-detected; without one,
                the order is name, phone, email.
              </p>

              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`}
                download="contacts-template.csv"
                className="text-sm text-signal hover:underline"
              >
                Download a template
              </a>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setImportOpen(false)}
                  className="rounded-md px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importFile || importBusy}
                  className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
                >
                  {importBusy ? "Importing…" : "Import"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={addExistingOpen} onClose={() => setAddExistingOpen(false)} title={`Add to ${activeGroupInfo?.name ?? "group"}`}>
        <div className="space-y-3">
          <input
            autoFocus
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search contacts to add…"
            className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          />
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {pickerHits.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">
                {pickerQuery.trim() ? "No matches." : "Type to search all contacts."}
              </p>
            ) : (
              pickerHits.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-line/40"
                >
                  <input
                    type="checkbox"
                    checked={pickerSelected.includes(c.id)}
                    onChange={() =>
                      setPickerSelected((prev) =>
                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                      )
                    }
                    className="h-4 w-4 rounded border-line text-signal focus:ring-signal"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="block truncate font-mono text-xs text-muted">{c.phone}</span>
                  </span>
                  {c.groups && c.groups.length > 0 && (
                    <span className="shrink-0 truncate font-mono text-[10px] text-signal-dark">
                      {c.groups.join(", ")}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setAddExistingOpen(false)}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
            >
              Cancel
            </button>
            <button
              onClick={addExisting}
              disabled={pickerSelected.length === 0 || pickerBusy}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {pickerBusy ? "Adding…" : `Add ${pickerSelected.length || ""} contact${pickerSelected.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={campOpen} onClose={() => setCampOpen(false)} title="Campaign membership">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {selectedIds.length} contact{selectedIds.length === 1 ? "" : "s"} selected
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Campaign</label>
            <select
              value={campId}
              onChange={(e) => pickCampaign(e.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              <option value="">Choose campaign…</option>
              {campList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Message variant</label>
            <select
              value={campVariantId}
              onChange={(e) => setCampVariantId(e.target.value)}
              disabled={!campId}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:bg-line/30"
            >
              <option value="">Choose variant…</option>
              {campVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setCampOpen(false)}
              className="rounded-md px-4 py-2 text-sm font-medium text-ink/70 hover:bg-line/60"
            >
              Cancel
            </button>
            <button
              onClick={() => applyToCampaign(true)}
              disabled={!campId || campBusy}
              className="rounded-md px-4 py-2 text-sm font-medium text-status-failed hover:bg-status-failed/10 disabled:opacity-50"
            >
              Remove from campaign
            </button>
            <button
              onClick={() => applyToCampaign(false)}
              disabled={!campId || !campVariantId || campBusy}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {campBusy ? "Working…" : "Add to variant"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}