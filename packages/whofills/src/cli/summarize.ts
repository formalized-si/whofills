import { SUMMARY } from "./wording.ts";

export interface Summary {
  decisions: number;
  badLines: number;
  counts: { agent: number; unsure: number; human: number; noToken: number };
  attested: number;
  /** How many decisions said anything about the attestation. */
  attestKnown: number;
  signals: [string, number][];
}

const VERDICTS = new Set(["agent", "unsure", "human"]);

/**
 * Reads one decision per line, as you get it from `req.whofills`, `guard.fetch` or `guard.check`:
 *   { "verdict": { "verdict": "agent", "score": 3, "signals": ["webdriver"] }, "attested": false }
 *   { "verdict": null }                       the script did not run
 *   { "verdict": "agent", "signals": [...] }  flattened, if you stored it that way
 */
export function summarize(text: string): Summary {
  const s: Summary = {
    decisions: 0,
    badLines: 0,
    counts: { agent: 0, unsure: 0, human: 0, noToken: 0 },
    attested: 0,
    attestKnown: 0,
    signals: [],
  };
  const signals = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      s.badLines++;
      continue;
    }
    if (typeof d !== "object" || d === null || !("verdict" in d)) {
      s.badLines++;
      continue;
    }
    const nested = typeof d.verdict === "object" && d.verdict !== null;
    const verdict: unknown = nested ? d.verdict.verdict : d.verdict;
    if (verdict !== null && !VERDICTS.has(String(verdict))) {
      s.badLines++;
      continue;
    }
    s.decisions++;
    if (verdict === null) s.counts.noToken++;
    else s.counts[verdict as "agent" | "unsure" | "human"]++;
    if (typeof d.attested === "boolean") {
      s.attestKnown++;
      if (d.attested) s.attested++;
    }
    const list: unknown = nested ? d.verdict.signals : d.signals;
    if (Array.isArray(list)) for (const x of list) if (typeof x === "string") signals.set(x, (signals.get(x) ?? 0) + 1);
  }
  s.signals = [...signals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return s;
}

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;

export function renderSummary(s: Summary) {
  const notes = s.badLines ? [SUMMARY.badLines(s.badLines)] : [];
  if (!s.decisions) return [SUMMARY.empty, ...notes].join("\n");
  const row = (name: string, n: number, why = "") =>
    `  ${name.padEnd(9)} ${String(n).padStart(6)}  ${pct(n, s.decisions).padStart(6)}${why ? `  ${why}` : ""}`;
  const lines = [
    `${s.decisions} ${s.decisions === 1 ? "decision" : "decisions"}`,
    "",
    row("agent", s.counts.agent),
    row("unsure", s.counts.unsure),
    row("human", s.counts.human),
    row(SUMMARY.noToken, s.counts.noToken, SUMMARY.noTokenWhy),
  ];
  if (s.attestKnown) lines.push("", `Attestation ticked: ${s.attested} of ${s.attestKnown}`);
  if (s.signals.length) {
    lines.push("", "Signals seen");
    for (const [name, n] of s.signals) lines.push(`  ${name.padEnd(18)} ${String(n).padStart(6)}`);
  }
  lines.push("", SUMMARY.caveat, ...notes);
  return lines.join("\n");
}
