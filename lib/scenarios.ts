export type ScenarioAction = "reply" | "book" | "opt_out" | "none";

export interface ScenarioRow {
  id: string;
  campaign_id: string;
  label: string;
  keywords: string;
  reply_template: string;
  action: ScenarioAction;
  priority: number;
  enabled: boolean;
}

import { firstName } from "@/lib/personalize";

/**
 * Deterministic keyword match. Scenarios are evaluated in priority order
 * (lower first); a scenario with no keywords is a catch-all that matches
 * anything. Returns null when nothing matches.
 */
export function matchScenario(text: string, scenarios: ScenarioRow[]): ScenarioRow | null {
  const t = (text ?? "").toLowerCase();
  const sorted = scenarios.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);

  for (const s of sorted) {
    const kws = s.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (kws.length === 0) return s; // catch-all
    if (kws.some((k) => t.includes(k))) return s;
  }
  return null;
}

/** Fill {name} / {{name}} placeholders in a reply template with the
 *  contact's first name. */
export function fillTemplate(template: string, name: string): string {
  const fname = firstName(name);
  return template.replace(/\{\{\s*name\s*\}\}/g, fname).replace(/\{name\}/g, fname);
}

/** Starter set seeded when a campaign is created — editable in the UI. */
export const DEFAULT_SCENARIOS: Omit<ScenarioRow, "id" | "campaign_id">[] = [
  {
    label: "Not interested",
    keywords: "not interested, no thanks, nope, stop texting, leave me alone, don't text me",
    reply_template: "Understood, {name} — we'll close your file. Reply HELP if this was a mistake.",
    action: "opt_out",
    priority: 5,
    enabled: true,
  },
  {
    label: "Interested",
    keywords: "interested, yes, yeah, yep, sure, sounds good, tell me more, let's do it",
    reply_template: "Great, {name}! When works best for a quick call — mornings or afternoons?",
    action: "book",
    priority: 10,
    enabled: true,
  },
  {
    label: "Question",
    keywords: "question, how much, price, pricing, cost, what is this, who is this, ?",
    reply_template: "Good question, {name}! Happy to fill you in — is a quick call this week okay?",
    action: "reply",
    priority: 30,
    enabled: true,
  },
  {
    label: "Later",
    keywords: "later, busy, call me back, next week, another time, not right now",
    reply_template: "No problem, {name} — when's a better time to reach you?",
    action: "reply",
    priority: 40,
    enabled: true,
  },
  {
    label: "Fallback",
    keywords: "",
    reply_template: "",
    action: "none",
    priority: 999,
    enabled: true,
  },
];