import { parseArgs } from "node:util";
import { REFUSE } from "./wording.ts";

export const MAX_RUNS = 20;

export interface TestArgs {
  url?: string;
  success?: string;
  task?: string;
  data?: string;
  agents?: string;
  compare?: string;
  runs: number;
  timeoutSec: number;
  parallel: number;
  out: string;
  owner: boolean;
}

const whole = (raw: string, name: string, min: number) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}.`);
  return n;
};

/** Throws with a message fit to show the user. */
export function parseTestArgs(argv: string[]): TestArgs {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      success: { type: "string" },
      task: { type: "string" },
      data: { type: "string" },
      agents: { type: "string" },
      compare: { type: "string" },
      runs: { type: "string", default: "3" },
      timeout: { type: "string", default: "240" },
      parallel: { type: "string", default: "1" },
      out: { type: "string", default: "whofills-report.json" },
      "i-own-this-form": { type: "boolean", default: false },
    },
  });
  if (positionals.length > 1) throw new Error(`Expected one URL, got ${positionals.length}.`);
  const runs = whole(v.runs!, "--runs", 1);
  if (runs > MAX_RUNS) throw new Error(REFUSE.runsCap(MAX_RUNS));
  return {
    url: positionals[0],
    success: v.success,
    task: v.task,
    data: v.data,
    agents: v.agents,
    compare: v.compare,
    runs,
    timeoutSec: whole(v.timeout!, "--timeout", 10),
    parallel: whole(v.parallel!, "--parallel", 1),
    out: v.out!,
    owner: v["i-own-this-form"]!,
  };
}

export interface AgentSpec {
  family: "claude" | "codex";
  model?: string;
  effort?: string;
  /** What the report calls this agent. */
  label: string;
}

/** claude, claude:sonnet, codex:gpt-6.1-terra:low. The bench's claude:pw:sonnet form is accepted too. */
export function parseAgentSpec(raw: string): AgentSpec {
  const parts = raw.trim().split(":");
  const family = parts.shift();
  if (family !== "claude" && family !== "codex")
    throw new Error(`Unknown agent "${raw}". Use claude or codex, optionally with a model: claude:sonnet.`);
  if (parts[0] === "pw") parts.shift();
  else if (/^pixel/.test(parts[0] ?? "") || parts[0] === "pwn")
    throw new Error(`"${raw}": this command drives agents through Playwright MCP only.`);
  const [model, effort] = parts.map((p) => p || undefined);
  if (parts.length > 2) throw new Error(`Unknown agent "${raw}". Use family:model:effort.`);
  return { family, model, effort, label: [family, model, effort].filter(Boolean).join(":") };
}

export const parseAgentList = (raw: string) => {
  const specs = raw
    .split(",")
    .filter((s) => s.trim())
    .map(parseAgentSpec);
  if (!specs.length) throw new Error("--agents is empty.");
  return specs;
};
