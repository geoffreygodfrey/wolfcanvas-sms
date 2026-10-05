"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong.");
      return;
    }
    setDone(true);
    setDevUrl(json.devUrl ?? null);
    setEmailSent(json.devUrl == null);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="reveal mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-signal text-white shadow-lift">
            <Logo className="h-7 w-7" />
          </span>
          <div className="space-y-1">
            <p className="eyebrow">wolfcanvas</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">Forgot password</h1>
            <p className="text-sm text-muted">We&apos;ll email you a link to reset it.</p>
          </div>
        </div>

        {done ? (
          <div className="reveal reveal-d1 card space-y-4 p-6 text-center">
            <p className="text-sm text-ink">If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way.</p>
            <p className="text-xs text-muted">The link expires in 1 hour. Check your inbox (and spam).</p>
            {!emailSent && devUrl && (
              <div className="rounded-lg border border-line bg-paper px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  No email provider configured — dev link
                </p>
                <a href={devUrl} className="mt-1 block break-all text-sm text-signal hover:underline">
                  {devUrl}
                </a>
              </div>
            )}
            <Link href="/login" className="block text-sm text-signal hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="reveal reveal-d1 card space-y-5 p-6">
            {error && <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <Link href="/login" className="block text-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}