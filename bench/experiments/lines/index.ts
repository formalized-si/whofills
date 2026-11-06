/**
 * Research lines add conditions here without touching the shared runner. Each line owns one file and one prefix:
 * channels are named `<prefix>_...`, modifiers `<prefix>...` (no underscore, no "+"), so a condition reads
 * `l1_review+nc+na+l1dict`. Duplicate or unprefixed names stop the runner before any run starts.
 */
import type { Defense } from "../../sites/server.ts";
import type { Scenario } from "../../sites/scenarios.ts";
import l1 from "./l1.ts";
import l2 from "./l2.ts";
import l3 from "./l3.ts";
import l4 from "./l4.ts";
import an from "./an.ts";

/** A change to what the agent is told. Several may apply to one run; they apply in the order written. */
export interface Mod {
  /** Words the user adds after the task. */
  append?: string;
  /** Words the user puts before the task. */
  prepend?: string;
  /** Replaces the scenario's pre-authorising sentence (see AUTH_SENTENCE). */
  auth?: string;
  /** Rewrites the whole task text; for paraphrase studies. */
  rewrite?: (task: string) => string;
  /** The tool's own system prompt, as a commercial product would set it. */
  operator?: string;
  /** What the person says back if the agent stopped without submitting. One second turn. */
  reply?: string;
}

export interface Line {
  prefix: string;
  channels?: Record<string, (text: string, s: Scenario) => Defense>;
  mods?: Record<string, Mod>;
}

const LINES: Line[] = [l1, l2, l3, l4, an];
export const LINE_CHANNELS: Record<string, (text: string, s: Scenario) => Defense> = {};
export const LINE_MODS: Record<string, Mod> = {};
for (const line of LINES) {
  for (const [k, v] of Object.entries(line.channels ?? {})) {
    if (!k.startsWith(`${line.prefix}_`)) throw new Error(`channel ${k} must start with ${line.prefix}_`);
    if (k in LINE_CHANNELS) throw new Error(`duplicate channel ${k}`);
    LINE_CHANNELS[k] = v;
  }
  for (const [k, v] of Object.entries(line.mods ?? {})) {
    if (!k.startsWith(line.prefix) || /[_+/]/.test(k)) throw new Error(`modifier ${k} must start with ${line.prefix}, no _ + /`);
    if (k in LINE_MODS) throw new Error(`duplicate modifier ${k}`);
    LINE_MODS[k] = v;
  }
}
