/**
 * Replays recorded telemetry through the SDK's scorer. For runs that reached a submission, how many would the
 * current detector hold? Needs raw runs in bench/runs: `tsx bench/detection.ts r1 r2a`.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extract, score, type RawEvent } from "../packages/whofills/src/features.ts";

function convert(ev: any[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const e of ev) {
    switch (e.k) {
      case "mousemove":
        out.push({ k: "move", t: e.t, tr: e.tr });
        break;
      case "mousedown":
        out.push({ k: "down", t: e.t, x: e.x, y: e.y, tr: e.tr });
        break;
      case "mouseup":
        out.push({ k: "up", t: e.t, x: e.x, y: e.y, tr: e.tr });
        break;
      case "click":
        out.push({
          k: "click",
          t: e.t,
          x: e.x,
          y: e.y,
          tr: e.tr,
          off: e.el ? Math.hypot(e.x - e.el.cx, e.y - e.el.cy) : undefined,
          w: e.el?.w,
          h: e.el?.h,
          d: e.d,
        });
        break;
      case "keydown":
        out.push({ k: "kd", t: e.t, tr: e.tr });
        break;
      case "input":
        out.push({ k: "input", t: e.t, tr: e.tr, it: e.it ?? "", len: e.len ?? 0 });
        break;
      case "wheel":
        out.push({ k: "wheel", t: e.t, tr: e.tr });
        break;
      case "paste":
        out.push({ k: "paste", t: e.t, tr: e.tr });
        break;
    }
  }
  return out;
}
function load(dir: string) {
  const p = join(dir, "site.jsonl");
  if (!existsSync(p)) return null;
  const tel = readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "telemetry" && e.data);
  return { ev: convert(tel.flatMap((e) => e.data.ev).sort((a: any, b: any) => a.t - b.t)), env: tel[0]?.data.env };
}
const groups: Record<string, Record<string, number>> = {};
for (const round of process.argv.slice(2)) {
  const root = join("bench/runs", round);
  if (!existsSync(join(root, "results.jsonl"))) continue;
  for (const l of readFileSync(join(root, "results.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.outcome !== "SUBMITTED") continue;
    const run = load(join(root, r.runId));
    if (!run?.ev.length) continue;
    const g = (groups[r.agent] ??= { n: 0, agent: 0, unsure: 0, human: 0 });
    g.n++;
    g[score(extract(run.ev), run.env ?? {}).verdict]++;
  }
}
for (const [k, g] of Object.entries(groups).sort())
  console.log(k.padEnd(40), `agent ${g.agent}/${g.n}  unsure ${g.unsure}  human ${g.human}`);
