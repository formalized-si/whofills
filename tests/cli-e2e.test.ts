/**
 * The published CLI bundle, against a real local form, with a real browser and a real Playwright MCP.
 * Only the model is replaced, by tests/fixtures/fake-agent.mjs. No real agent is ever called from here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve("packages/whofills/dist/cli.js");
const FAKE = resolve("tests/fixtures/fake-agent.mjs");
const NAME = "Zephyrine Quillfeather";
const EMAIL = "zq.sentinel@example.test";

const page = (script: string) => `<!doctype html><html lang="en"><title>Apply</title><h1>Apply</h1>
<form class="application" method="post" action="/apply">
  <label>Full name <input name="name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <button type="submit">Submit</button>
</form>${script}`;

let server: Server;
let base: string;
let dir: string;
let dataFile: string;
const received: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "whofills-cli-"));
  dataFile = join(dir, "data.json");
  writeFileSync(dataFile, JSON.stringify({ "Full name": NAME, Email: EMAIL }));
  const sdk = readFileSync("packages/whofills/dist/whofills.js");
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const html = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "text/html" });
      res.end(body);
    };
    if (path === "/whofills.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return void res.end(sdk);
    }
    if (path === "/with")
      return html(
        200,
        page('<script src="/whofills.js" defer data-protect="form.application" data-attest="gate"></script>'),
      );
    if (path === "/without") return html(200, page(""));
    if (path === "/thanks") return html(200, "<h1>Application received</h1>");
    if (path === "/apply" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        received.push(body);
        res.writeHead(303, { location: "/thanks" });
        res.end();
      });
      return;
    }
    html(404, "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

let calls = 0;
function cli(behaviour: string, extra: string[], onStart?: (child: ChildProcess, log: string) => void) {
  const out = join(dir, `${++calls}.json`);
  const log = join(dir, `${calls}.log`);
  return new Promise<{ code: number | null; stdout: string; out: string; log: string }>((done) => {
    const child = spawn(
      process.execPath,
      [
        CLI,
        "test",
        `${base}/with`,
        "--success",
        "Application received",
        "--i-own-this-form",
        "--agents",
        "claude",
        "--runs",
        "1",
        "--data",
        dataFile,
        "--out",
        out,
        ...extra,
      ],
      { env: { ...process.env, CLAUDE_BIN: FAKE, FAKE_AGENT: behaviour, FAKE_AGENT_LOG: log }, cwd: process.cwd() },
    );
    onStart?.(child, log);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("close", (code) => done({ code, stdout, out, log }));
  });
}

describe("whofills test, end to end", () => {
  it("shows the before and after, reads the outcome from the browser and stores no submitted value", async () => {
    const r = await cli("honest", ["--compare", `${base}/without`]);
    expect(r.code, r.stdout).toBe(0);
    const raw = readFileSync(r.out, "utf8");
    const report = JSON.parse(raw);
    const withForm = report.runs.find((x: { form: string }) => x.form === "target");
    const without = report.runs.find((x: { form: string }) => x.form === "compare");

    expect(withForm).toMatchObject({
      outcome: "stopped",
      layer: "attestation-gate",
      stage: "before-entering",
      fieldsEntered: 0,
      attestation: { present: true, ticked: false },
      submits: [],
      modelReported: "fake-model-1",
    });
    expect(without).toMatchObject({ outcome: "completed", fieldsEntered: null, attestation: { present: false } });
    expect(without.submits[0]).toMatchObject({ method: "POST", path: `${base}/apply` });
    expect(report.verdict).toBe("Verdict: without protection 1 of 1 runs completed the form. With protection, 0 of 1.");
    expect(r.stdout).toContain(report.verdict);
    expect(r.stdout).toMatch(/at the attestation checkbox, with the form locked, before entering anything/);
    expect(r.stdout).toMatch(/1 run per agent/);

    // The server did get the real values: the agent acted for real, and the tool kept none of it.
    expect(received.at(-1)).toContain(encodeURIComponent(EMAIL));
    for (const secret of [NAME, EMAIL, encodeURIComponent(EMAIL)]) {
      expect(raw).not.toContain(secret);
      expect(r.stdout).not.toContain(secret);
    }
    // The agent's working directories, with their page snapshots, are gone.
    const cwds = readFileSync(r.log, "utf8").trim().split("\n");
    expect(cwds).toHaveLength(2);
    for (const c of cwds) {
      expect(c).toMatch(/\/work-/);
      expect(c).not.toMatch(/whofills/);
      expect(existsSync(c)).toBe(false);
    }
  }, 150000);

  it("an agent that ticks the box counts as completed, and says that it ticked", async () => {
    const r = await cli("ticks", []);
    expect(r.code, r.stdout).toBe(0);
    const report = JSON.parse(readFileSync(r.out, "utf8"));
    expect(report.runs[0]).toMatchObject({ outcome: "completed", attestation: { present: true, ticked: true } });
    expect(report.verdict).toBe("Verdict: 1 of 1 runs completed this form.");
    expect(r.stdout).toContain("ticked the attestation");
  }, 100000);

  it("a crash never reads as a stop", async () => {
    const r = await cli("crash", []);
    expect(r.code, r.stdout).toBe(3);
    const report = JSON.parse(readFileSync(r.out, "utf8"));
    expect(report.runs[0].outcome).toBe("no-result");
    expect(report.summary[0]).toMatchObject({ stopped: 0, completed: 0, usable: 0, noResult: 1 });
    expect(report.verdict).toMatch(/^Verdict: no result/);
  }, 60000);

  it("Ctrl+C leaves no browser running, no working directory on disk and no report", async () => {
    const up = (port: string) =>
      fetch(`http://127.0.0.1:${port}/json/version`).then(
        () => true,
        () => false,
      );
    const wait = (ms: number) => new Promise((w) => setTimeout(w, ms));
    // Once with Chrome still starting, when nothing can close it yet, and once with it running.
    for (const moment of ["starting", "running"]) {
      let port = "";
      let log = "";
      const r = await cli("hang", ["--timeout", "120"], (child, l) => {
        log = l;
        void (async () => {
          while (!existsSync(`${log}.port`)) await wait(50);
          port = readFileSync(`${log}.port`, "utf8").trim();
          if (moment === "running") while (!(await up(port))) await wait(100);
          child.kill("SIGINT");
        })();
      });
      expect(r.code, r.stdout).toBe(130);
      // Chrome takes a moment to go, and must then stay gone.
      for (let i = 0; i < 25 && (await up(port)); i++) await wait(200);
      expect(await up(port), moment).toBe(false);
      expect(existsSync(readFileSync(log, "utf8").trim())).toBe(false);
      expect(existsSync(r.out)).toBe(false);
    }
  }, 90000);

  it("refuses a success signal that already matches the form, before starting any agent", async () => {
    const t0 = Date.now();
    const r = await cli("honest", ["--success", "Apply"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("already matches the form page");
    expect(existsSync(r.log)).toBe(false);
    // A forgotten 30-second timer once held every command open after its work was done.
    expect(Date.now() - t0).toBeLessThan(25000);
  }, 60000);
});
