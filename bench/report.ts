/**
 * One table per round, agent by condition, from bench/results/<round>.jsonl. Nothing is pooled across rounds or models.
 * A cell is `submitted/n`. Runs that timed out or failed to start are listed apart and never counted as stops.
 * Usage: tsx bench/report.ts w2a w2b ... > docs/experiments/tables.md
 */
import { readFileSync } from "node:fs";

const FAILED = new Set(["INFRA", "INVALID", "UNKNOWN"]);
const short = (a: string) => {
  const [, surface, model, effort] = a.split(":");
  const name = model.replace("gpt-6.1-", "").replace("claude-", "");
  return `${name}${surface.startsWith("pixel") ? " (pixels)" : ""}${effort && !a.startsWith("codex") ? `, ${effort}` : ""}`;
};
const out: string[] = [];
for (const round of process.argv.slice(2)) {
  const rows = readFileSync(`bench/results/${round}.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const agents = [...new Set(rows.map((r) => r.agent))].sort();
  const conds = [...new Set(rows.map((r) => r.cond))].sort();
  const cell = new Map<
    string,
    { sub: number; n: number; held: number; failed: number; said: Record<string, number> }
  >();
  for (const r of rows) {
    const k = `${r.cond}|${r.agent}`;
    const c = cell.get(k) ?? { sub: 0, n: 0, held: 0, failed: 0, said: {} };
    if (r.timedOut || FAILED.has(r.outcome)) c.failed++;
    else {
      c.n++;
      if (r.submits > 0) c.sub++;
      if (r.held > 0) c.held++;
      const who = r.fields?.completed_by ?? r.fields?.wf_declared;
      if (r.submits > 0 && who) c.said[who] = (c.said[who] ?? 0) + 1;
      for (const d of r.declared ?? []) c.said[`held:${d}`] = (c.said[`held:${d}`] ?? 0) + 1;
    }
    cell.set(k, c);
  }
  out.push(`## ${round}`, "", `${rows.length} runs. Cell: submitted/n, then held runs and failed runs if any.`, "");
  out.push(`| Condition | ${agents.map(short).join(" | ")} |`, `|---|${agents.map(() => "---").join("|")}|`);
  for (const cond of conds) {
    const cells = agents.map((a) => {
      const c = cell.get(`${cond}|${a}`);
      if (!c) return "";
      const extra = [
        c.held ? `held ${c.held}` : "",
        c.failed ? `failed ${c.failed}` : "",
        Object.keys(c.said).length
          ? Object.entries(c.said)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")
          : "",
      ].filter(Boolean);
      return `${c.sub}/${c.n}${extra.length ? ` (${extra.join("; ")})` : ""}`;
    });
    out.push(`| \`${cond}\` | ${cells.join(" | ")} |`);
  }
  out.push("");
}
console.log(out.join("\n"));
