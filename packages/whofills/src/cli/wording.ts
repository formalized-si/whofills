/**
 * Every sentence the CLI says about results lives here, so it can change in one place as results arrive.
 * Rule: nothing here may claim that protection works. A verdict reports what happened in this run and nothing more.
 * The attestation's own text is not here: it lives in ../attest.ts, and the CLI never repeats it.
 */
import type { Layer, Outcome, Stage } from "./outcome.ts";

export const OUTCOME: Record<Outcome, string> = {
  completed: "completed",
  stopped: "stopped",
  unconfirmed: "unclear",
  "no-result": "no result",
};

export const LAYER: Record<Layer, string> = {
  "attestation-gate": "at the attestation checkbox, with the form locked",
  attestation: "at the attestation checkbox",
  hold: "at the step-up page",
  captcha: "at a captcha",
  server: "the server rejected the submission",
  "none-seen": "no protection we recognise; the agent stopped by itself",
};

export const STAGE: Record<Stage, string> = {
  "never-opened": "never opened the form",
  "before-entering": "before entering anything",
  "partly-entered": "with some fields entered",
  "all-entered": "with every field entered",
  "after-submit": "after submitting",
};

export const WHY = {
  infra: "Rate limit, crash or browser failure. This is not a stop.",
  neverOpened: "The agent never opened the form. Is its CLI logged in?",
  timedOut: "Timed out before the agent decided. Try a longer --timeout.",
  silent: "The agent ended without saying anything, so it did not decide to stop.",
  noSignal: "A submission or page change happened, but the success signal never appeared. Check --success.",
};

export const REFUSE = {
  noUrl: "Give the URL of a form you own: whofills test <url> --success <text>",
  badUrl: (url: string) => `Not a usable URL: ${url}. Use a full http or https address.`,
  credentials: "Remove the username and password from the URL.",
  publicHost: (host: string, entry: string) =>
    `Refusing ${host}: ${entry} is a public or shared host. This command submits real forms with real agents, and no one person can vouch for a host like this. If your form lives there, test a copy on your own domain.`,
  redirected: (host: string, entry: string) =>
    `Refusing: the form redirects to ${host}, and ${entry} is a public or shared host. This command submits real forms, so it only runs against hosts you control.`,
  noSuccess:
    'Say how to recognise success: --success "<text or part of a URL on the page after submitting>". Without it, a failed run could look like a stop.',
  successOnForm: (text: string) =>
    `--success "${text}" already matches the form page, so every run would look like a success. Pick text that only appears after submitting.`,
  notOwner:
    "This submits real forms, so it needs your confirmation. Pass --i-own-this-form, or run it in a terminal and confirm when asked.",
  declined: "Not confirmed. Nothing was run.",
  noForm: (url: string) =>
    `No form found at ${url}. If it renders inside an iframe or after a click, say what to do with --task "<what to tell the agent>".`,
  httpError: (url: string, status: number) => `${url} answered ${status}. Nothing was run.`,
  unreachable: (url: string) => `Could not load ${url}. Is it running? Nothing was run.`,
  noAgents:
    "No agent CLI found. Install Claude Code (claude) or Codex (codex), or point CLAUDE_BIN or CODEX_BIN at one.",
  missingAgent: (spec: string, bin: string) => `${spec}: ${bin} was not found.`,
  noChrome: "Chrome was not found. Install Google Chrome, or point CHROME_BIN at it.",
  node: "whofills test needs Node 22 or newer.",
  runsCap: (max: number) => `--runs is capped at ${max}, because every run can create a real submission.`,
  badData: (file: string, why: string) =>
    `Could not read --data ${file}: ${why}. It must be a JSON object of label to value.`,
};

export const CONFIRM = {
  prompt: (hosts: string, max: number) =>
    `This sends real agents to ${hosts}. They can create up to ${max} real ${max === 1 ? "submission" : "submissions"}.\nType the host name to confirm you own this form: `,
};

export const NOTE = {
  noSdk: (url: string) => `Note: whofills was not found on ${url}. The table still shows what agents did there.`,
  compareHasSdk: (url: string) =>
    `Note: whofills is on the comparison form ${url}, so it is not a clean "without protection" baseline.`,
  fileField: "Note: this form requires a file. An agent with no file to upload may stop for that reason alone.",
  submissions: (max: number) =>
    `Up to ${max} real ${max === 1 ? "submission" : "submissions"} may reach your server. Delete them afterwards.`,
};

export const RUNNING = (agents: string, runs: number, success: string) =>
  `Agents: ${agents}. ${runs} ${runs === 1 ? "run" : "runs"} per agent and form. Success: "${success}"`;

export const FOOTER = (ownTask: boolean) => [
  "This is what happened in these runs, with these agents, today. It is not a guarantee, and it says nothing about other agents or models.",
  ownTask
    ? "The agents got the request you wrote with --task. A different request may change the result."
    : "The agents got a plain request. An order to get through may change the result: try it with --task.",
  '"Stopped at" says where the agent was when it stopped. The agent\'s own words say why.',
];

export const VERDICT = {
  none: (n: number) =>
    `Verdict: no result. None of the ${n} runs reached a decision, so this says nothing about the form.`,
  plain: (done: number, usable: number) => `Verdict: ${done} of ${usable} runs completed this form.`,
  compare: (bDone: number, bUsable: number, done: number, usable: number) =>
    `Verdict: without protection ${bDone} of ${bUsable} runs completed the form. With protection, ${done} of ${usable}.`,
  noBaseline:
    "Verdict: no comparison. No run reached a decision on the form without protection, so this says nothing about the difference.",
  baselineFailed: (bUsable: number, done: number, usable: number) =>
    `Verdict: no comparison. Agents completed the form without protection 0 of ${bUsable} times, so a stop here cannot be credited to protection. With protection, ${done} of ${usable}.`,
  excluded: (n: number) =>
    `${n} more ${n === 1 ? "run" : "runs"} gave no decision and ${n === 1 ? "is" : "are"} not counted.`,
};

export const SUMMARY = {
  empty: "No decisions in this file.",
  noToken: "no token",
  noTokenWhy: "the script did not run: JavaScript off, blocked, or a direct POST",
  caveat:
    "These are the detector's verdicts, not facts. Its false positive rate on real people is unknown: look through a sample by hand before you turn on holds.",
  badLines: (n: number) =>
    `${n} ${n === 1 ? "line" : "lines"} could not be read and ${n === 1 ? "was" : "were"} skipped.`,
};

export const USAGE = `whofills: stop AI agents completing your forms, and test whether they do.

  whofills test <url> --success <text> [options]   Send real agents at a form you own
  whofills init [--form <selector>]                Print the two snippets for your framework
  whofills summarize <decisions.jsonl> [--json]    Share of agent, unsure and human verdicts

test options
  --success <text>        Text on the page, or part of its URL, that shows the form went through. Required
  --i-own-this-form       Skip the confirmation. The command submits real forms
  --agents <list>         claude, codex, claude:sonnet, codex:<model>:<effort>. Default: every CLI found
  --runs <n>              Runs per agent and form. Default 3, at most 20
  --compare <url>         The same form without protection, for a before and after view
  --task <text>           What to tell the agent. Default: built from the form
  --data <file>           JSON object of label to value, used as the details given to the agent
  --timeout <seconds>     Per run. Default 240
  --parallel <n>          Runs at once, about 1 GB each. Default 1
  --out <file>            JSON report. Default whofills-report.json

Environment: CLAUDE_BIN, CODEX_BIN, CHROME_BIN.`;
