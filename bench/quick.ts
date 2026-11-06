/**
 * The fast loop: `npm run quick -- sdk_gate [more conditions]`.
 * Two DOM agents, the quickest kind, plus one baseline run each. About a minute. Good for deciding what to try next, and
 * too small to publish: confirm anything that matters with `npm run bench`. `--pixel` adds a screenshot-only agent (slower).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const pixel = args.includes("--pixel");
const conds = args.filter((a) => !a.startsWith("--")).map((c) => (c.includes("+nc") ? c : `${c}+nc`));
if (!conds.length) {
  console.error("usage: npm run quick -- <condition> [more] [--pixel]");
  process.exit(2);
}
const macCodex = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";
const env = { ...process.env, CODEX_BIN: process.env.CODEX_BIN ?? (existsSync(macCodex) ? macCodex : "codex") };
const agents = ["claude:pw:sonnet", "codex:pw:gpt-6.1-terra:low", ...(pixel ? ["claude:pixel:sonnet"] : [])].join(",");
const round = `quick-${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}`;
const run = (conditions: string, n: number) =>
  spawnSync(
    "node_modules/.bin/tsx",
    [
      "bench/run.ts",
      "--round",
      round,
      "--agents",
      agents,
      "--scenarios",
      "phd",
      "--conditions",
      conditions,
      "--n",
      String(n),
      "--parallel",
      "4",
      "--timeout",
      "150",
    ],
    { env, stdio: "ignore" },
  );
const t0 = Date.now();
run("none+nc", 1);
run(conds.join(","), 2);
const rows = readFileSync(join("bench/runs", round, "results.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
console.log(
  `${"condition".padEnd(26)}${"submitted".padEnd(12)}${"entered nothing".padEnd(18)}${"held".padEnd(7)}no verdict`,
);
for (const c of ["none+nc", ...conds]) {
  const r = rows.filter((x) => x.cond === c);
  const decided = r.filter((x) => x.outcome === "SUBMITTED" || x.outcome === "STOPPED");
  const count = (f: (x: (typeof r)[number]) => boolean) => `${decided.filter(f).length}/${decided.length}`;
  console.log(
    `${c.padEnd(26)}${count((x) => x.outcome === "SUBMITTED").padEnd(12)}${count((x) => x.filledFields === 0).padEnd(18)}${count((x) => x.held > 0).padEnd(7)}${r.length - decided.length}`,
  );
}
console.log(`${Math.round((Date.now() - t0) / 1000)} s. Agents' reasons: bench/runs/${round}/results.jsonl`);
