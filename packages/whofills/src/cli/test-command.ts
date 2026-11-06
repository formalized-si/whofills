import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { cliVersion, findAgentBin, findMcp, killAll, runAgent, warmMcp } from "./agents.ts";
import { parseAgentList, parseAgentSpec, parseTestArgs, type AgentSpec, type TestArgs } from "./args.ts";
import { Observer, within } from "./observe.ts";
import { judge } from "./outcome.ts";
import { findChrome, freePort, preflight, type Preflight } from "./preflight.ts";
import {
  renderFooter,
  renderTable,
  runLine,
  tally,
  verdict,
  type FormRole,
  type Report,
  type RunRecord,
} from "./report.ts";
import { checkTarget, cleanUrl, publicHostEntry, redact } from "./safety.ts";
import { buildTask, customTask, parseData, taskDetails } from "./task.ts";
import { CONFIRM, NOTE, REFUSE, RUNNING } from "./wording.ts";

/** Exit codes: 0 the test ran and at least one run decided, 2 refused or bad input, 3 no run reached a decision. */
class Refusal extends Error {}

/** How long to watch for a browser that was still starting when its agent was killed. */
const KILL_WAIT_MS = 4000;

function chooseAgents(args: TestArgs, env = process.env) {
  const specs: AgentSpec[] = args.agents
    ? parseAgentList(args.agents)
    : (["claude", "codex"] as const).filter((f) => findAgentBin(f, env)).map((f) => parseAgentSpec(f));
  if (!specs.length) throw new Refusal(REFUSE.noAgents);
  return specs.map((spec) => {
    const bin = findAgentBin(spec.family, env);
    if (!bin) throw new Refusal(REFUSE.missingAgent(spec.label, spec.family));
    return { spec, bin };
  });
}

async function confirmOwnership(hosts: string[], max: number) {
  if (!process.stdin.isTTY) throw new Refusal(REFUSE.notOwner);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(CONFIRM.prompt(hosts.join(" and "), max));
  rl.close();
  if (answer.trim().toLowerCase() !== hosts[0].toLowerCase()) throw new Refusal(REFUSE.declined);
}

/** Everything that would make the run mean nothing is caught here, before an agent spends money. */
function vet(p: Preflight, url: URL, success: string, role: FormRole, hasTask: boolean): string[] {
  const shown = cleanUrl(url.href);
  // A failed navigation leaves Chrome on its own error page, with no status at all.
  if (!/^https?:/.test(p.finalUrl)) throw new Refusal(REFUSE.unreachable(shown));
  const finalHost = new URL(p.finalUrl).hostname;
  const entry = publicHostEntry(finalHost);
  if (entry) throw new Refusal(REFUSE.redirected(finalHost, entry));
  if (p.status !== null && p.status >= 400) throw new Refusal(REFUSE.httpError(shown, p.status));
  if (p.sample.successMatch) throw new Refusal(REFUSE.successOnForm(success));
  if (!p.fields.length && !hasTask) throw new Refusal(REFUSE.noForm(shown));
  const notes: string[] = [];
  if (role === "target" && !p.sample.sdk) notes.push(NOTE.noSdk(shown));
  if (role === "compare" && p.sample.sdk) notes.push(NOTE.compareHasSdk(shown));
  if (p.fields.some((f) => f.type === "file" && f.required)) notes.push(NOTE.fileField);
  return notes;
}

export async function testCommand(argv: string[], version: string): Promise<number> {
  try {
    return await run(argv, version);
  } catch (e) {
    if (e instanceof Refusal || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error((e as Error).message);
      return 2;
    }
    throw e;
  }
}

async function run(argv: string[], version: string): Promise<number> {
  let args: TestArgs;
  try {
    args = parseTestArgs(argv);
  } catch (e) {
    throw new Refusal((e as Error).message);
  }
  const target = checkTarget(args.url);
  if (!target.ok) throw new Refusal(target.error);
  const compare = args.compare ? checkTarget(args.compare) : null;
  if (compare && !compare.ok) throw new Refusal(compare.error);
  if (!args.success?.trim()) throw new Refusal(REFUSE.noSuccess);
  const success = args.success.trim();
  if (typeof WebSocket === "undefined") throw new Refusal(REFUSE.node);

  let data: Record<string, string> | undefined;
  if (args.data) {
    try {
      data = parseData(readFileSync(args.data, "utf8"));
    } catch (e) {
      throw new Refusal(REFUSE.badData(args.data, (e as Error).message));
    }
  }
  let agents: ReturnType<typeof chooseAgents>;
  try {
    agents = chooseAgents(args);
  } catch (e) {
    throw new Refusal((e as Error).message);
  }
  const chrome = findChrome();
  if (!chrome) throw new Refusal(REFUSE.noChrome);

  const forms: { role: FormRole; url: URL }[] = [
    { role: "target", url: target.url },
    ...(compare?.ok ? [{ role: "compare" as const, url: compare.url }] : []),
  ];
  const total = agents.length * args.runs * forms.length;
  if (!args.owner)
    await confirmOwnership(
      forms.map((f) => f.url.hostname),
      total,
    );

  const hasCompare = forms.length > 1;
  const notes: string[] = [NOTE.submissions(total)];
  const tasks = new Map<FormRole, string>();
  const formUrls = new Map<FormRole, string>();
  // Everything the agents are given, so that none of it shows up in what they say.
  const given = new Set<string>(data ? Object.values(data) : []);
  for (const f of forms) {
    const p = await preflight(chrome, f.url, success);
    notes.push(...vet(p, f.url, success, f.role, !!args.task));
    formUrls.set(f.role, p.finalUrl);
    for (const v of Object.values(taskDetails(p.fields, data))) given.add(v);
    tasks.set(
      f.role,
      args.task ? customTask(args.task, f.url.href, target.url.href, data) : buildTask(f.url.href, p.fields, data),
    );
  }

  const mcp = findMcp();
  warmMcp(mcp);
  const startedAt = new Date().toISOString();
  console.log(`\nwhofills test: ${cleanUrl(target.url.href)}`);
  if (compare?.ok) console.log(`Without protection: ${cleanUrl(compare.url.href)}`);
  console.log(RUNNING(agents.map((a) => a.spec.label).join(", "), args.runs, success));
  for (const n of notes) console.log(n);
  console.log("");

  // Interleaved, so that a rate limit or a slow hour does not land on one form only.
  const jobs = Array.from({ length: args.runs }, (_, i) => i + 1).flatMap((n) =>
    forms.flatMap((form) => agents.map((agent) => ({ n, form, agent }))),
  );
  const observers = new Set<Observer>();
  let stopping = false;
  // Agents first, so that nothing new can start. Then the browsers, which sit outside the agents' process groups.
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    killAll();
    const closing = Promise.all([...observers].map((o) => o.finish(KILL_WAIT_MS).catch(() => {})));
    void within(closing, KILL_WAIT_MS + 3000).then(() => {
      console.error("\nStopped. No report was written.");
      process.exit(130);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const runs: RunRecord[] = [];
  const cli = new Map(agents.map((a) => [a.spec.label, cliVersion(a.bin)]));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { n, form, agent } = jobs[next++];
      const port = await freePort();
      const formUrl = formUrls.get(form.role)!;
      const observer = new Observer(port, formUrl, success);
      observers.add(observer);
      const ran = await runAgent(agent.spec, agent.bin, {
        prompt: tasks.get(form.role)!,
        port,
        hostname: form.url.hostname,
        mcp,
        timeoutMs: args.timeoutSec * 1000,
        chromeBin: process.env.CHROME_BIN,
      });
      const seen = await observer.finish(ran.timedOut ? KILL_WAIT_MS : 0);
      observers.delete(observer);
      if (stopping) return;
      const judged = judge({
        ...seen,
        toolCalls: ran.transcript.toolCalls,
        timedOut: ran.timedOut,
        exit: ran.exit,
        finalText: ran.transcript.finalText,
        stderr: ran.stderr,
      });
      const record: RunRecord = {
        agent: agent.spec.label,
        form: form.role,
        run: n,
        ...judged,
        // Sampled, so an agent can type and submit between looks. The count is only sound if the page stayed put.
        fieldsEntered: judged.stage === "after-submit" ? null : seen.fieldsEntered,
        fieldsTotal: seen.fieldsTotal,
        attestation: { present: seen.attest.present || seen.attestTicked, ticked: seen.attestTicked },
        sawStepUp: seen.holdSeen,
        submits: seen.submits,
        modelReported: ran.transcript.model,
        toolCalls: ran.transcript.toolCalls,
        durationMs: ran.durationMs,
        costUsd: ran.transcript.costUsd,
        exit: ran.exit,
        timedOut: ran.timedOut,
      };
      runs.push(record);
      const quote = redact(ran.transcript.finalText, [...given, ...ran.transcript.typed]);
      console.log(runLine(record, quote, hasCompare));
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.parallel, jobs.length) }, worker));
  // Interrupted: the workers returned early and the signal handler is closing up and will exit. No partial report.
  if (stopping) await new Promise(() => {});
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  const line = verdict(runs, hasCompare);
  const cost = runs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const report: Report = {
    tool: "whofills",
    version,
    schema: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    target: cleanUrl(target.url.href),
    compare: compare?.ok ? cleanUrl(compare.url.href) : null,
    success,
    taskSource: args.task ? "--task" : "built from the form",
    dataFile: !!data,
    runsPerAgent: args.runs,
    timeoutSec: args.timeoutSec,
    agents: agents.map((a) => ({ agent: a.spec.label, cli: cli.get(a.spec.label) ?? "unknown" })),
    summary: tally(runs),
    verdict: line,
    runs,
    ...(cost ? { costUsd: Number(cost.toFixed(4)) } : {}),
  };
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n${renderTable(runs, hasCompare)}\n`);
  console.log(`${line}\n`);
  console.log(`${renderFooter(!!args.task)}\n`);
  console.log(`Report: ${args.out}${cost ? `. Agent cost reported: $${cost.toFixed(2)}` : ""}`);
  return runs.some((r) => r.outcome === "completed" || r.outcome === "stopped") ? 0 : 3;
}
