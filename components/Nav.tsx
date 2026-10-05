"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

interface NavUser {
  name: string;
  email: string;
  role: string;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10.5h17M8 3v4M16 3v4" />
      <path d="M8.5 15h7" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.9-3.2 3.5-5 7-5s6.1 1.8 7 5" />
    </svg>
  );
}

function MessagesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L4 21l1.6-4.1A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

function CampaignsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="m3 11 14-5v12L3 13v-2Z" />
      <path d="M17 12h3a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2h-1" />
      <path d="M12.5 18.5a2 2 0 0 0 3.4-1.3" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M7 20v-7M12 20V9M17 20v-10" />
    </svg>
  );
}

function ConversationsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M9 4h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <circle cx="8.5" cy="10" r="0.5" fill="currentColor" />
      <circle cx="12" cy="10" r="0.5" fill="currentColor" />
      <circle cx="15.5" cy="10" r="0.5" fill="currentColor" />
    </svg>
  );
}

function Wolfmark() {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-signal text-white">
      <Logo />
    </span>
  );
}

const leftLinks = [
  { href: "/contacts", label: "Contacts", icon: ContactsIcon },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarIcon },
  { href: "/messages", label: "Messages", icon: MessagesIcon },
  { href: "/conversations", label: "Review", icon: ConversationsIcon },
  { href: "/campaigns", label: "Campaigns", icon: CampaignsIcon },
];

function pill(active: boolean, extra?: string) {
  return [
    "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
    active ? "bg-white text-signal-dark shadow-sm" : "text-white/75 hover:bg-white/10 hover:text-white",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) setUser((await res.json()).user);
      } catch {
        /* not signed in */
      }
    })();
  }, []);

  async function signOut() {
    if (!confirm("Sign out?")) return;
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-signal-dark">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 sm:px-6">
        <Link
          href="/"
          aria-label="wolfcanvas home"
          className="mr-2 flex shrink-0 items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Wolfmark />
          <span className="font-display text-lg font-medium tracking-tight text-white">wolfcanvas</span>
        </Link>

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {leftLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={pill(active)}>
                <Icon />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dashboard"
            className={[
              "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              pathname?.startsWith("/dashboard")
                ? "bg-white text-signal-dark shadow-lift"
                : "border border-white/25 text-white hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <DashboardIcon />
            Dashboard
          </Link>
          {user && (
            <button
              onClick={signOut}
              title={`${user.email} · ${user.role} — click to sign out`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/30 bg-white/10 text-xs font-semibold text-white transition-colors hover:border-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}