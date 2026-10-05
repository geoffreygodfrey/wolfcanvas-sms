import { firstName } from "@/lib/personalize";

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentContext {
  systemPrompt: string;
  contactName: string;
  history: AgentMessage[];
}

export interface AgentDecision {
  reply: string;
  qualified: boolean;
  appointmentAt: string | null;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a text-message sales assistant for a business following up with a prospect who replied to an " +
  "outreach SMS. Your job is to qualify the prospect and, if they're clearly interested, book an appointment. " +
  "Keep replies short, natural, and under 160 characters. No emojis. Never invent prices, deadlines, or " +
  "commitments that weren't stated. " +
  'Respond with ONLY JSON in this exact shape: {"reply":"...","qualified":true|false,"appointmentAt":"ISO 8601 datetime or null"}. ' +
  "Set appointmentAt to a specific ISO datetime only if the prospect named a time/date; otherwise null.";

const FALLBACK_QUALIFIED =
  "Thanks {name}! Sounds like a great fit. Is there a time that works best for a quick call — this week or next?";
const FALLBACK_CLOSE =
  "No problem, {name}. Thanks for replying — if anything changes, just text us here.";
const FALLBACK_PROBE =
  "Thanks for getting back, {name}. Could you tell me a little more about what you're looking for, so I can point you the right way?";

export async function decideReply(ctx: AgentContext): Promise<AgentDecision> {
  const provider = resolveProvider();
  if (provider) {
    try {
      return await llmDecision(ctx, provider);
    } catch (err) {
      console.warn("[agent] LLM call failed, using heuristic fallback:", err);
    }
  }
  return heuristicDecision(ctx);
}

/**
 * Scenario classifier — the AI's ONLY job when scenarios are configured:
 * pick which configured scenario best fits the inbound reply, or none.
 * It never composes text and never decides to book.
 */
export async function classifyScenario(opts: {
  inboundText: string;
  history: AgentMessage[];
  scenarios: { label: string; keywords: string }[];
}): Promise<string | null> {
  const provider = resolveProvider();
  if (!provider) return null;

  const list = opts.scenarios
    .map((s) => `- "${s.label}" (signals: ${s.keywords || "anything / fallback"})`)
    .join("\n");
  const system =
    "You route inbound SMS replies for a sales team. Choose the single best-matching scenario " +
    "label from the list below for the prospect's latest message, or NONE if nothing fits. " +
    "Do not write a reply. Respond with ONLY JSON: {\"scenario\":\"<exact label>\"} or {\"scenario\":\"NONE\"}.\n\n" +
    `Scenarios:\n${list}`;

  const messages: AgentMessage[] = [
    { role: "system", content: system },
    ...opts.history.slice(-8),
    { role: "user", content: opts.inboundText },
  ];

  try {
    const content = await chatJson(provider, messages);
    const parsed = parseModelJson(content);
    const picked = typeof parsed?.scenario === "string" ? parsed.scenario.trim() : "";
    if (!picked || picked.toUpperCase() === "NONE") return null;
    const hit = opts.scenarios.find((s) => s.label.toLowerCase() === picked.toLowerCase());
    return hit?.label ?? null;
  } catch (err) {
    console.warn("[agent] scenario classification failed:", err);
    return null;
  }
}

async function chatJson(provider: LlmProvider, messages: AgentMessage[]): Promise<string> {
  const body: Record<string, unknown> = { messages, temperature: 0 };
  if (provider.model) body.model = provider.model;
  if (provider.jsonMode) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const res = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider.baseUrl} responded ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

interface LlmProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
}

/**
 * Resolve which OpenAI-compatible endpoint to use. Checked in order:
 *   1. LLM_BASE_URL + LLM_API_KEY + LLM_MODEL — any custom host (Ollama, LmStudio, self-hosted, …)
 *   2. GROQ_API_KEY                     — Groq free tier, defaults to a Llama model
 *   3. QWEN_API_KEY / DASHSCOPE_API_KEY — Alibaba DashScope, defaults to qwen-plus
 * Returns null (keyword heuristics) when no provider is configured.
 */
function resolveProvider(): LlmProvider | null {
  const model = process.env.LLM_MODEL?.trim();

  const baseUrl = process.env.LLM_BASE_URL?.trim();
  if (baseUrl) {
    return {
      baseUrl,
      apiKey: process.env.LLM_API_KEY?.trim() ?? "",
      model: model ?? "",
      jsonMode: false,
    };
  }

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
      model: model || "llama-3.3-70b-versatile",
      jsonMode: true,
    };
  }

  const qwenKey = process.env.QWEN_API_KEY?.trim() ?? process.env.DASHSCOPE_API_KEY?.trim();
  if (qwenKey) {
    return {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: qwenKey,
      model: model || "qwen-plus",
      jsonMode: true,
    };
  }

  return null;
}

function parseModelJson(content: string): any {
  let cleaned = content.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to slicing
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* not JSON — surface the real error below */
    }
  }
  throw new Error("model did not respond with parseable JSON");
}

async function llmDecision(ctx: AgentContext, provider: LlmProvider): Promise<AgentDecision> {
  const system = ctx.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const messages: AgentMessage[] = [{ role: "system", content: system }, ...ctx.history.slice(-16)];

  const content = await chatJson(provider, messages);
  const parsed = parseModelJson(content);

  let appointmentAt: string | null = null;
  if (parsed.appointmentAt) {
    const date = new Date(parsed.appointmentAt);
    if (!isNaN(date.getTime())) appointmentAt = date.toISOString();
  }

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 500) : "",
    qualified: parsed.qualified === true,
    appointmentAt,
  };
}

function fill(template: string, name: string): string {
  return template.replace(/\{name\}/g, firstName(name));
}

function heuristicDecision(ctx: AgentContext): AgentDecision {
  const lastUser = [...ctx.history].reverse().find((m) => m.role === "user");
  const text = (lastUser?.content ?? "").toLowerCase();
  const name = ctx.contactName;

  const positive = /\b(yes|yeah|yep|sure|interested|book|appointment|schedule|available|let'?s do it)\b/.test(text);
  const negative = /\b(no|nope|not interested|don'?t (want|need)|never mind|leave me alone)\b/.test(text);

  if (negative) {
    return { reply: fill(FALLBACK_CLOSE, name), qualified: false, appointmentAt: null };
  }
  if (positive) {
    return {
      reply: fill(FALLBACK_QUALIFIED, name),
      qualified: true,
      appointmentAt: suggestAppointment(text),
    };
  }
  return { reply: fill(FALLBACK_PROBE, name), qualified: false, appointmentAt: null };
}

/** Best-effort parse of a proposed appointment time from the prospect's text. */
export function suggestAppointment(text: string): string | null {
  const time = text.match(/(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\b/i);
  const day = /\btomorrow\b/.test(text) ? 1 : /\btoday\b/.test(text) ? 0 : null;
  if (!time || day === null) return null;

  let hour = parseInt(time[1], 10);
  const minute = time[2] ? parseInt(time[2], 10) : 0;
  const meridian = (time[3] || "").toLowerCase();

  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (hour < 8 || hour > 20) return null;

  const date = new Date();
  date.setDate(date.getDate() + day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}