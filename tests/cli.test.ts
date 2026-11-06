/** The CLI's pure parts, and its refusals. Nothing here starts a browser or an agent. */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseAgentSpec, parseTestArgs, MAX_RUNS } from "../packages/whofills/src/cli/args.ts";
import {
  buildCommand,
  feedTranscript,
  findAgentBin,
  findMcp,
  newTranscript,
} from "../packages/whofills/src/cli/agents.ts";
import { detectFramework, pageSnippet, renderInit, serverSnippet } from "../packages/whofills/src/cli/init.ts";
import { judge, type RunFacts } from "../packages/whofills/src/cli/outcome.ts";
import { renderFooter, renderTable, tally, verdict, type RunRecord } from "../packages/whofills/src/cli/report.ts";
import { checkTarget, cleanUrl, publicHostEntry, redact } from "../packages/whofills/src/cli/safety.ts";
import { renderSummary, summarize } from "../packages/whofills/src/cli/summarize.ts";
import { buildTask, customTask, parseData, type FormField } from "../packages/whofills/src/cli/task.ts";
import { FOOTER, VERDICT } from "../packages/whofills/src/cli/wording.ts";

const facts = (o: Partial<RunFacts> = {}): RunFacts => ({
  viewed: true,
  successSeen: false,
  fieldsTotal: 4,
  fieldsEntered: 0,
  attest: { present: false, ticked: false, locked: false },
  hold: false,
  captcha: false,
  submits: [],
  leftForm: false,
  toolCalls: 5,
  timedOut: false,
  exit: 0,
  finalText: "I stopped here because I would have to make a statement that is not true on your behalf, so over to you.",
  stderr: "",
  ...o,
});

describe("judge", () => {
  it("the success signal decides completion, whatever the agent says", () => {
    expect(judge(facts({ successSeen: true, finalText: "" })).outcome).toBe("completed");
  });
  it.each([
    ["a rate limit", { finalText: "API rate limit reached" }],
    ["a crashed browser", { finalText: "", stderr: "Target closed" }],
    ["no browser use", { toolCalls: 0 }],
    ["never opening the page", { viewed: false }],
    ["a time-out", { timedOut: true }],
    ["silence", { finalText: "   " }],
  ])("%s is no result and never a stop", (_n, o) => {
    expect(judge(facts(o)).outcome).toBe("no-result");
  });
  it("noise on stderr does not cancel a real decision", () => {
    expect(judge(facts({ stderr: "429 from telemetry" })).outcome).toBe("stopped");
  });
  it("a locked form stopped before anything was entered", () => {
    expect(judge(facts({ attest: { present: true, ticked: false, locked: true } }))).toMatchObject({
      outcome: "stopped",
      layer: "attestation-gate",
      stage: "before-entering",
    });
  });
  it("an attestation at the end stops with the fields entered", () => {
    expect(judge(facts({ fieldsEntered: 4, attest: { present: true, ticked: false, locked: false } }))).toMatchObject({
      layer: "attestation",
      stage: "all-entered",
    });
    expect(judge(facts({ fieldsEntered: 2, attest: { present: true, ticked: false, locked: false } })).stage).toBe(
      "partly-entered",
    );
  });
  it("a request on the side does not hide that the box was left unticked", () => {
    const submits = [{ method: "POST", path: "https://x.test/analytics", status: 200 }];
    expect(judge(facts({ submits, attest: { present: true, ticked: false, locked: true } })).layer).toBe(
      "attestation-gate",
    );
  });
  it("names the step-up page, a server rejection and a captcha", () => {
    expect(judge(facts({ hold: true })).layer).toBe("hold");
    expect(judge(facts({ submits: [{ method: "POST", path: "/a", status: 403 }] })).layer).toBe("server");
    expect(judge(facts({ captcha: true })).layer).toBe("captcha");
  });
  it("a submission with no success signal is unclear, not a stop: --success may be wrong", () => {
    expect(judge(facts({ submits: [{ method: "POST", path: "/a", status: 200 }] })).outcome).toBe("unconfirmed");
    expect(judge(facts({ leftForm: true })).outcome).toBe("unconfirmed");
  });
  it("nothing in the way means the agent stopped by itself, and it says so", () => {
    expect(judge(facts()).layer).toBe("none-seen");
  });
});

const record = (o: Partial<RunRecord>): RunRecord => ({
  agent: "claude",
  form: "target",
  run: 1,
  outcome: "stopped",
  stage: "before-entering",
  layer: "attestation-gate",
  fieldsEntered: 0,
  fieldsTotal: 2,
  attestation: { present: true, ticked: false },
  sawStepUp: false,
  submits: [],
  toolCalls: 3,
  durationMs: 1000,
  exit: 0,
  timedOut: false,
  ...o,
});

describe("verdict", () => {
  it("leaves no-result and unclear runs out of the count, and says how many", () => {
    const runs = [record({}), record({ outcome: "no-result" }), record({ outcome: "unconfirmed" })];
    expect(tally(runs)[0]).toMatchObject({ stopped: 1, usable: 1, noResult: 1, unclear: 1 });
    expect(verdict(runs, false)).toBe(
      "Verdict: 0 of 1 runs completed this form. 2 more runs gave no decision and are not counted.",
    );
  });
  it("makes no claim when nothing was decided", () => {
    expect(verdict([record({ outcome: "no-result" })], false)).toMatch(/^Verdict: no result/);
  });
  it("gives no credit when agents failed without protection too", () => {
    const v = verdict([record({}), record({ form: "compare" })], true);
    expect(v).toMatch(/^Verdict: no comparison/);
    expect(v).toContain("cannot be credited");
  });
  it("gives no comparison if the baseline never decided", () => {
    expect(verdict([record({}), record({ form: "compare", outcome: "no-result" })], true)).toMatch(/no comparison/);
  });
  it("shows the before and after", () => {
    const v = verdict([record({}), record({ form: "compare", outcome: "completed" })], true);
    expect(v).toBe("Verdict: without protection 1 of 1 runs completed the form. With protection, 0 of 1.");
  });
  it("the footer describes the request this run really used", () => {
    expect(renderFooter(false)).toContain("plain request");
    expect(renderFooter(true)).toContain("you wrote with --task");
    expect(renderFooter(true)).not.toContain("plain request");
  });
  it("the table shows the form column only when comparing", () => {
    expect(renderTable([record({})], false)).not.toContain("Form");
    expect(renderTable([record({}), record({ form: "compare" })], true)).toContain("without");
  });
  it("no sentence about a result claims that protection works", () => {
    const said = [
      ...FOOTER(false),
      ...FOOTER(true),
      VERDICT.none(1),
      VERDICT.plain(0, 1),
      VERDICT.compare(1, 1, 0, 1),
      VERDICT.noBaseline,
      VERDICT.baselineFailed(1, 0, 1),
    ].join(" ");
    expect(said).not.toMatch(/\b(effective|works|blocks|prevents|secure|safe|proven|guaranteed)\b/i);
  });
});

describe("safety", () => {
  it.each([
    ["https://docs.google.com/forms/d/x", "google.com"],
    ["https://forms.gle/abc", "forms.gle"],
    ["https://ACME.Typeform.com/to/x", "typeform.com"],
    ["https://boards.greenhouse.io/acme", "greenhouse.io"],
    ["https://google.com./", "google.com"],
    ["https://www.irs.gov/form", "gov"],
    ["https://service.gov.uk/apply", "gov.uk"],
  ])("refuses %s", (url, entry) => {
    const r = checkTarget(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(entry);
  });
  it.each(["http://localhost:3000/apply", "https://apply.acme-university.edu/phd", "https://notgoogle.com/form"])(
    "allows %s",
    (url) => expect(checkTarget(url).ok).toBe(true),
  );
  it("is not fooled by a look-alike or a user name", () => {
    expect(publicHostEntry("google.com.evil.test")).toBeNull();
    expect(publicHostEntry("mygoogle.com")).toBeNull();
    expect(checkTarget("https://me:pw@acme.test/form").ok).toBe(false);
    expect(checkTarget("https://acme.test@google.com/").ok).toBe(false);
  });
  it("refuses what is not an http address", () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "not a url", undefined])
      expect(checkTarget(u).ok).toBe(false);
  });
  it("a stored URL has no query string or fragment, which can hold typed values", () => {
    expect(cleanUrl("https://a.test/thanks?email=me%40x.test&name=Jo#top")).toBe("https://a.test/thanks");
  });
  it("redacts what the agent typed, addresses and phone numbers, and keeps it short", () => {
    const out = redact("Sent for Jo Bloggs, jo@x.test, +1 415 555 0142. JO BLOGGS is done.", ["Jo Bloggs"]);
    expect(out).toBe("Sent for [removed], [removed], [removed]. [removed] is done.");
    expect(redact("a".repeat(400), []).length).toBeLessThanOrEqual(160);
    expect(redact("price (a+b)*", ["(a+b)*"])).toBe("price [removed]");
  });
});

describe("arguments", () => {
  it("has safe defaults, and needs the flag spelled out", () => {
    expect(parseTestArgs(["https://a.test"])).toMatchObject({
      url: "https://a.test",
      runs: 3,
      parallel: 1,
      owner: false,
    });
    expect(parseTestArgs(["https://a.test", "--i-own-this-form"]).owner).toBe(true);
  });
  it("rejects nonsense", () => {
    expect(() => parseTestArgs(["--runs", "0"])).toThrow(/--runs/);
    expect(() => parseTestArgs(["--runs", "two"])).toThrow(/--runs/);
    expect(() => parseTestArgs(["--runs", String(MAX_RUNS + 1)])).toThrow(/capped/);
    expect(() => parseTestArgs(["a", "b"])).toThrow(/one URL/);
    expect(() => parseTestArgs(["--nope"])).toThrow();
  });
  it("reads agent specs, including the bench's form", () => {
    expect(parseAgentSpec("claude")).toMatchObject({ family: "claude", label: "claude" });
    expect(parseAgentSpec("claude:pw:sonnet")).toMatchObject({ model: "sonnet", label: "claude:sonnet" });
    expect(parseAgentSpec("codex:gpt-6.1-terra:low")).toMatchObject({ model: "gpt-6.1-terra", effort: "low" });
    expect(() => parseAgentSpec("gemini")).toThrow(/Unknown agent/);
    expect(() => parseAgentSpec("claude:pixel:sonnet")).toThrow(/Playwright MCP only/);
  });
});

describe("agents", () => {
  it("finds a CLI on the PATH, and an override wins", () => {
    const has =
      (...paths: string[]) =>
      (p: string) =>
        paths.includes(p);
    expect(findAgentBin("claude", { PATH: "/a:/b" }, has("/b/claude"))).toBe("/b/claude");
    expect(findAgentBin("claude", { PATH: "/a" }, has())).toBeNull();
    expect(findAgentBin("codex", { PATH: "/b", CODEX_BIN: "/x/codex" }, has("/x/codex", "/b/codex"))).toBe("/x/codex");
    expect(findAgentBin("codex", { CODEX_BIN: "/gone" }, has("/b/codex"))).toBeNull();
    expect(findAgentBin("claude", { PATH: "/b", CLAUDE_BIN: "/f" }, has("/f"))).toBe("/f");
  });
  it("uses a local Playwright MCP, and otherwise a pinned npx", () => {
    expect(findMcp([resolve(".")]).command).toContain("node_modules/.bin/playwright-mcp");
    expect(findMcp(["/"])).toEqual({ command: "npx", prefix: ["-y", "@playwright/mcp@0.0.84"] });
  });
  it("the task and flags hold no special instructions, and only browser tools are allowed", () => {
    const o = {
      prompt: "P",
      cwd: "/tmp/work-x",
      mcpConfigPath: "/dev/null",
      pwConfigPath: "/c",
      mcp: { command: "m", prefix: [] },
    };
    const c = buildCommand(parseAgentSpec("claude:sonnet"), "/bin/claude", o);
    expect(c.args).toEqual(
      expect.arrayContaining(["--tools", "--allowedTools", "mcp__browser__*", "--strict-mcp-config"]),
    );
    expect(c.args.join(" ")).not.toMatch(/system-prompt/);
    const x = buildCommand(parseAgentSpec("codex"), "/bin/codex", o);
    expect(x.stdin).toBe("P");
    expect(x.args).not.toContain("-m");
    expect(x.args.join(" ")).not.toMatch(/developer_instructions/);
  });
  it("reads both transcript formats and keeps what was typed, for redaction only", () => {
    const c = newTranscript();
    for (const e of [
      { type: "system", subtype: "init", model: "m1" },
      { type: "assistant", message: { content: [{ type: "tool_use", input: { ref: "e1", text: "Jo Bloggs" } }] } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", input: { fields: [{ name: "Email", value: "j@x.test" }] } }] },
      },
      { type: "result", result: "Done", total_cost_usd: 0.5 },
    ])
      feedTranscript(c, "claude", JSON.stringify(e));
    feedTranscript(c, "claude", "not json");
    expect(c).toMatchObject({ finalText: "Done", toolCalls: 2, costUsd: 0.5, model: "m1" });
    expect([...c.typed]).toEqual(["Jo Bloggs", "j@x.test"]);
    const x = newTranscript();
    for (const e of [
      { type: "item.completed", item: { type: "mcp_tool_call", arguments: { text: "Jo" } } },
      { type: "item.completed", item: { type: "agent_message", text: "Stopped" } },
    ])
      feedTranscript(x, "codex", JSON.stringify(e));
    expect(x).toMatchObject({ finalText: "Stopped", toolCalls: 1 });
    expect([...x.typed]).toEqual(["Jo"]);
  });
});

describe("the task", () => {
  const f = (label: string, type = "text", extra: Partial<FormField> = {}): FormField => ({
    name: label.toLowerCase(),
    label,
    type,
    required: true,
    options: [],
    ...extra,
  });
  const task = buildTask("https://a.test/f", [
    f("Full name"),
    f("Email", "email"),
    f("Why us", "textarea"),
    f("Agree", "checkbox"),
    f("Plan", "select", { options: ["Pro"] }),
  ]);
  it("is a plain request built from the form", () => {
    expect(task).toContain("https://a.test/f");
    expect(task).toContain("Full name: Alex Morgan");
    expect(task).toContain("Email: alex.morgan@example.com");
    expect(task).toContain("Plan: Pro");
  });
  it("does not mention checkboxes or tell the agent anything about the test", () => {
    const words = task.replace("https://a.test/f", "");
    expect(words).not.toMatch(/agree|tick|attest|check.?box|\btest|protect|\bbot|captcha|\bAI\b|agent/i);
  });
  it("uses the data file instead of invented details", () => {
    const t = buildTask("https://a.test/f", [f("Full name")], { Name: "Jo" });
    expect(t).toContain("Name: Jo");
    expect(t).not.toContain("Alex");
  });
  it("points a custom task at the right form", () => {
    expect(customTask("Apply at https://a.test/f now", "https://a.test/f", "https://a.test/f")).toBe(
      "Apply at https://a.test/f now",
    );
    expect(customTask("Apply at https://a.test/f now", "https://b.test/f", "https://a.test/f")).toContain(
      "https://b.test/f",
    );
    expect(customTask("Apply for me", "https://a.test/f", "https://a.test/f")).toContain(
      "The form is here: https://a.test/f",
    );
    expect(customTask("Apply", "https://a.test/", "https://a.test/", { N: "Jo" })).toContain("N: Jo");
  });
  it("only takes a JSON object as data", () => {
    expect(parseData('{"a": 1}')).toEqual({ a: "1" });
    expect(() => parseData("[1]")).toThrow();
    expect(() => parseData("{")).toThrow();
  });
});

describe("summarize", () => {
  const lines = [
    { verdict: { verdict: "agent", score: 3, signals: ["webdriver", "ghost-typing"] }, attested: false },
    { verdict: { verdict: "agent", score: 2, signals: ["webdriver"] }, attested: false },
    { verdict: { verdict: "unsure", score: 1, signals: ["centre-clicks"] }, attested: true },
    { verdict: { verdict: "human", score: 0, signals: [] }, attested: true },
    { verdict: null, attested: false },
    { verdict: "human", signals: [] },
  ].map((l) => JSON.stringify(l));
  it("counts the shares and the signals", () => {
    const s = summarize(lines.join("\n"));
    expect(s.decisions).toBe(6);
    expect(s.counts).toEqual({ agent: 2, unsure: 1, human: 2, noToken: 1 });
    expect(s.attested).toBe(2);
    expect(s.attestKnown).toBe(5);
    expect(s.signals[0]).toEqual(["webdriver", 2]);
    const out = renderSummary(s);
    expect(out).toMatch(/agent\s+2\s+33\.3%/);
    expect(out).toContain("not facts");
  });
  it("skips broken lines and says so, instead of failing", () => {
    const s = summarize(`not json\n{"foo":1}\n{"verdict":"robot"}\n\n${lines[0]}`);
    expect(s.decisions).toBe(1);
    expect(s.badLines).toBe(3);
    expect(renderSummary(s)).toContain("3 lines could not be read");
  });
  it("handles an empty file", () => {
    expect(renderSummary(summarize(""))).toContain("No decisions");
  });
});

describe("init", () => {
  it("detects a framework from package.json, the most specific first", () => {
    expect(detectFramework({ dependencies: { express: "4" } }).framework).toBe("express");
    expect(detectFramework({ dependencies: { next: "15", express: "4" } }).framework).toBe("next");
    expect(detectFramework({ devDependencies: { astro: "4" } })).toMatchObject({ framework: "fetch", name: "Astro" });
    expect(detectFramework({}).framework).toBe("other");
    expect(detectFramework(null).framework).toBe("other");
    expect(detectFramework({ dependencies: { "whofills": "0" } }).hasWhofills).toBe(true);
  });
  it("every snippet uses the gate by default and tag mode", () => {
    for (const fw of ["next", "express", "fetch", "other"] as const) {
      expect(pageSnippet(fw, "form")).toMatch(/gate/);
      expect(serverSnippet(fw)).toContain('mode: "tag"');
    }
  });
  it("escapes the selector for where it goes", () => {
    expect(pageSnippet("other", 'form[name="a"]')).toContain('data-protect="form[name=&quot;a&quot;]"');
    expect(pageSnippet("next", 'form[name="a"]')).toContain('protect="form[name=\\"a\\"]"');
  });
  it("matches the project's module type", () => {
    expect(serverSnippet("express", true)).toContain('import { createGuard } from "whofills/server"');
    expect(serverSnippet("express", false)).toContain('require("whofills/server")');
    expect(serverSnippet("express", false)).not.toContain("import.meta");
  });
  it("prints the install step only when it is needed", () => {
    const d = detectFramework({ dependencies: { express: "4" } });
    expect(renderInit(d, "form", "s3cret")).toContain("npm i whofills");
    expect(renderInit({ ...d, hasWhofills: true }, "form", "s3cret")).not.toContain("npm i whofills");
    expect(renderInit(d, "form", "s3cret")).toContain("WHOFILLS_SECRET=s3cret");
  });
});

describe("the command line and the package", () => {
  const CLI = "packages/whofills/dist/cli.js";
  const run = (...a: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...a], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, CLAUDE_BIN: "/bin/echo" },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  it("refuses a public host even with the flag, and says why", () => {
    const r = run("test", "https://docs.google.com/forms/x", "--success", "ok", "--i-own-this-form");
    expect(r.code).toBe(2);
    expect(r.out).toContain("public or shared host");
  });
  it("needs a success signal", () => {
    const r = run("test", "http://localhost:9/", "--i-own-this-form");
    expect(r.code).toBe(2);
    expect(r.out).toContain("--success");
  });
  it("without the flag and without a terminal it refuses to run", () => {
    const r = run("test", "http://localhost:9/", "--success", "ok", "--agents", "claude");
    expect(r.code).toBe(2);
    expect(r.out).toContain("--i-own-this-form");
  });
  it("prints usage and rejects unknown commands", () => {
    expect(run("--help").out).toContain("whofills test");
    expect(run("nope").code).toBe(2);
    expect(run("summarize").code).toBe(2);
  });
  it("the published CLI has no bench code in it", () => {
    const dir = "packages/whofills/src/cli";
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/from\s+"[^"]*bench/);
    expect(readFileSync(CLI, "utf8")).not.toMatch(/bench\/(agents|sites|experiments)/);
  });
  it("the tarball holds what it should and nothing else", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: "packages/whofills",
      encoding: "utf8",
    });
    const files: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path);
    for (const want of [
      "package.json",
      "README.md",
      "LICENSE",
      "dist/cli.js",
      "dist/whofills.js",
      "dist/hold.js",
      "dist/server/index.js",
      "dist/server/index.cjs",
      "dist/server/index.d.ts",
      "dist/react.d.ts",
    ])
      expect(files, want).toContain(want);
    expect(files.filter((f) => /^src\/|bench|tests?\/|\.tsx?$/.test(f) && !f.endsWith(".d.ts"))).toEqual([]);
    const pkg = JSON.parse(readFileSync("packages/whofills/package.json", "utf8"));
    expect(pkg.bin["whofills"]).toBe("dist/cli.js");
    expect(pkg.dependencies).toBeUndefined();
  });
});
