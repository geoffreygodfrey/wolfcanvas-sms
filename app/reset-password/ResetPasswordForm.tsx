"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";

export default function ResetPasswordForm() {
  const search = useSearchParams();
  const token = search.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong.");
      if (res.status === 400) setExpired(true);
      return;
    }
    setDone(true);
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
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">Reset password</h1>
            <p className="text-sm text-muted">Choose a new password for your account.</p>
          </div>
        </div>

        {done ? (
          <div className="reveal reveal-d1 card space-y-4 p-6 text-center">
            <p className="text-sm text-ink">Your password has been reset.</p>
            <Link href="/login" className="block text-sm text-signal hover:underline">
              Sign in with your new password
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="reveal reveal-d1 card space-y-5 p-6">
            {!token && (
              <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">
                This link is missing its reset token.
              </p>
            )}
            {error && <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">New password</label>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
              <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Confirm password</label>
              <input
                required
                type="password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !token || expired}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set new password"}
            </button>

            <Link href={expired ? "/forgot-password" : "/login"} className="block text-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              {expired ? "Request a new link" : "Back to sign in"}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}