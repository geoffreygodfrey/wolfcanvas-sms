"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamMode, setTeamMode] = useState<"" | "login" | "register">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/status");
        const json = await res.json();
        setHasUsers(json.hasUsers === true);
      } catch {
        setHasUsers(true);
      }
    })();
  }, []);

  function mode(): "" | "login" | "register" {
    if (teamMode) return teamMode;
    return hasUsers ? "login" : "register";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const isRegister = mode() === "register";
    const res = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isRegister ? { name, email, password } : { email, password }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong.");
      return;
    }
    window.location.href = "/";
  }

  const isRegister = mode() === "register";

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="reveal mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-signal text-white shadow-lift">
            <Logo className="h-7 w-7" />
          </span>
          <div className="space-y-1">
            <p className="eyebrow">SMS outreach</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">wolfcanvas</h1>
            <p className="text-sm text-muted">
              {hasUsers === null
                ? "…"
                : isRegister
                  ? hasUsers
                    ? "Admins only — add a team member"
                    : "Create the admin account"
                  : "Sign in to your account"}
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="reveal reveal-d1 card space-y-5 p-6"
        >
          {error && <p className="rounded-md bg-status-failed/10 px-3 py-2 text-sm text-status-failed">{error}</p>}

          {isRegister && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>

          <button
            type="submit"
            disabled={busy || hasUsers === null}
            className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-signal-dark disabled:opacity-60"
          >
            {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>

          {hasUsers && !teamMode && (
            <button
              type="button"
              onClick={() => setTeamMode("register")}
              className="w-full text-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Admin? Invite a team member
            </button>
          )}
          {hasUsers && !isRegister && (
            <Link
              href="/forgot-password"
              className="block text-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Forgot password?
            </Link>
          )}
          {teamMode === "register" && (
            <button
              type="button"
              onClick={() => setTeamMode("")}
              className="w-full text-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}