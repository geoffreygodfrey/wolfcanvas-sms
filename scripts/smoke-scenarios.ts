import { matchScenario, fillTemplate, DEFAULT_SCENARIOS } from "@/lib/scenarios";
import { classifyScenario } from "@/lib/agent";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok -", msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mk = (label: string, keywords: string, action: any, priority: number): any => ({
  id: label,
  campaign_id: "c",
  label,
  keywords,
  reply_template: "Hi {name} — " + label,
  action,
  priority,
  enabled: true,
});

async function main() {
  const scs = [
    mk("Not interested", "not interested", "opt_out", 5),
    mk("Interested", "interested, yes", "book", 10),
    mk("Question", "how much, price", "reply", 30),
    mk("Fallback", "", "none", 999),
  ];

  assert(matchScenario("Yes please tell me more", scs)?.label === "Interested", "keyword hit -> Interested");
  assert(matchScenario("NOT INTERESTED!!", scs)?.label === "Not interested", "case-insensitive match");
  assert(matchScenario("How much does it cost?", scs)?.label === "Question", "question match");
  assert(matchScenario("asdfgh jkl", scs)?.label === "Fallback", "catch-all when nothing matches");
  assert(
    fillTemplate("Hi {name} / {{name}}", "Sam") === "Hi Sam / Sam",
    "template fills both {name} and {{name}}"
  );

  const dis = [{ ...scs[0], enabled: false }, ...scs.slice(1)];
  assert(matchScenario("yes", dis)?.label === "Interested", "disabled scenarios are skipped");

  assert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    matchScenario("sure thing", DEFAULT_SCENARIOS as any)?.action === "book",
    "default set routes 'sure thing' to book"
  );

  // Live classifier (uses whatever provider .env configures; null when none/unreachable)
  const picked = await classifyScenario({
    inboundText: "sounds good, can we do tuesday afternoon?",
    history: [],
    scenarios: scs.map((s) => ({ label: s.label, keywords: s.keywords })),
  });
  console.log("classifier picked:", picked);
  assert(picked === null || typeof picked === "string", "classifier returns label or null");

  console.log("ALL SCENARIO SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exitCode = 1;
});