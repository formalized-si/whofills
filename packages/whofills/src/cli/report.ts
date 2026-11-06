import type { Judgement, Submit } from "./outcome.ts";
import { FOOTER, LAYER, OUTCOME, STAGE, VERDICT } from "./wording.ts";

export type FormRole = "target" | "compare";

/** One run as stored. Outcomes only: no field values, no query strings, none of the agent's words. */
export interface RunRecord extends Judgement {
  agent: string;
  form: FormRole;
  run: number;
  /** Null once the page has moved on: the count comes from samples, and could miss a fast agent. */
  fieldsEntered: number | null;
  fieldsTotal: number;
  attestation: { present: boolean; ticked: boolean };
  sawStepUp: boolean;
  submits: Submit[];
  modelReported?: string;
  toolCalls: number;
  durationMs: number;
  costUsd?: number;
  exit: number | null;
  timedOut: boolean;
}

export interface Tally {
  agent: string;
  form: FormRole;
  completed: number;
  stopped: number;
  unclear: number;
  noResult: number;
  usable: number;
  ticked: number;
  top: string;
}

/** Where a run stopped, in words. */
export const whereStopped = (r: Pick<RunRecord, "layer" | "stage" | "why" | "outcome">) => {
  if (r.outcome === "completed") return "";
  if (r.outcome !== "stopped") return r.why ?? "";
  const place = r.layer ? LAYER[r.layer] : "";
  // After a submit the layer says it all; before one, how far the agent got is the point.
  return r.stage === "after-submit" ? place : `${place}, ${STAGE[r.stage]}`;
};

export function tally(runs: RunRecord[]): Tally[] {
  const keys = [...new Set(runs.map((r) => `${r.agent}\u0000${r.form}`))];
  return keys.map((k) => {
    const [agent, form] = k.split("\u0000") as [string, FormRole];
    const mine = runs.filter((r) => r.agent === agent && r.form === form);
    const count = (o: RunRecord["outcome"]) => mine.filter((r) => r.outcome === o).length;
    const places = new Map<string, number>();
    for (const r of mine.filter((x) => x.outcome === "stopped")) {
      const w = whereStopped(r);
      places.set(w, (places.get(w) ?? 0) + 1);
    }
    const best = [...places.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      agent,
      form,
      completed: count("completed"),
      stopped: count("stopped"),
      unclear: count("unconfirmed"),
      noResult: count("no-result"),
      // An unclear run might have gone through, and a no-result run decided nothing. Neither counts either way.
      usable: count("completed") + count("stopped"),
      ticked: mine.filter((r) => r.attestation.ticked).length,
      top: best ? best[0] : "",
    };
  });
}

export function verdict(runs: RunRecord[], hasCompare: boolean) {
  const sum = (form: FormRole) => {
    const t = tally(runs.filter((r) => r.form === form));
    return {
      done: t.reduce((a, x) => a + x.completed, 0),
      usable: t.reduce((a, x) => a + x.usable, 0),
      excluded: t.reduce((a, x) => a + x.unclear + x.noResult, 0),
    };
  };
  const target = sum("target");
  const base = sum("compare");
  const excluded = target.excluded + (hasCompare ? base.excluded : 0);
  const tail = excluded ? ` ${VERDICT.excluded(excluded)}` : "";
  if (target.usable === 0) return VERDICT.none(runs.length);
  if (!hasCompare) return VERDICT.plain(target.done, target.usable) + tail;
  if (base.usable === 0) return VERDICT.noBaseline + tail;
  if (base.done === 0) return VERDICT.baselineFailed(base.usable, target.done, target.usable) + tail;
  return VERDICT.compare(base.done, base.usable, target.done, target.usable) + tail;
}

function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

export function renderTable(runs: RunRecord[], hasCompare: boolean) {
  const head = ["Agent", ...(hasCompare ? ["Form"] : []), "Completed", "Stopped", "Unclear", "No result", "Stopped at"];
  const label = (f: FormRole) => (f === "target" ? "with" : "without");
  const rows = tally(runs).map((t) => [
    t.agent,
    ...(hasCompare ? [label(t.form)] : []),
    `${t.completed}/${t.usable}`,
    String(t.stopped),
    String(t.unclear),
    String(t.noResult),
    t.top,
  ]);
  return table([head, ...rows]);
}

/** One line per run, as it happens. `quote` is shown here only and is never stored. */
export function runLine(r: RunRecord, quote: string, hasCompare: boolean) {
  const form = hasCompare ? ` ${r.form === "target" ? "with" : "without"}` : "";
  const where = whereStopped(r);
  const ticked = r.attestation.present ? (r.attestation.ticked ? ", ticked the attestation" : "") : "";
  return (
    `  ${r.agent}${form} #${r.run}: ${OUTCOME[r.outcome]}` +
    `${where ? `, ${where}` : ""}${ticked} (${secs(r.durationMs)})` +
    (quote ? `\n    "${quote}"` : "")
  );
}

export const renderFooter = (ownTask: boolean) => FOOTER(ownTask).join("\n");

export interface Report {
  tool: "whofills";
  version: string;
  schema: 1;
  startedAt: string;
  finishedAt: string;
  target: string;
  compare: string | null;
  success: string;
  taskSource: "built from the form" | "--task";
  dataFile: boolean;
  runsPerAgent: number;
  timeoutSec: number;
  agents: { agent: string; cli: string }[];
  summary: Tally[];
  verdict: string;
  runs: RunRecord[];
  costUsd?: number;
}
