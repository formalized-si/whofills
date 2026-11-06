/**
 * Point any real agent at the protected form: Claude in Chrome, Atlas, Comet, Gemini, Codex computer use.
 * Each run prints a verdict from the server's own log.
 *   npm run try -- [condition]       default sdk_full; `none` is the unprotected control
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSite } from "./sites/server.ts";
import { scenarios } from "./sites/scenarios.ts";
import { personaText } from "./sites/persona.ts";
import { channels, payloadText } from "./experiments/conditions.ts";

const cond = process.argv[2] ?? "sdk_full";
const s = scenarios.phd;
const dir = mkdtempSync(join(tmpdir(), "whofills-try-"));
const logPath = join(dir, "site.jsonl");
writeFileSync(logPath, "");
const site = await startSite({
  scenario: "phd",
  defense: { ...channels[cond](payloadText("policy", s), s), noCaptcha: true },
  logPath,
});
// A plain-HTTP front on localhost, so that a real browser needs no certificate or DNS changes.
const front = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const r = await fetch(`https://127.0.0.1:${site.port}${req.url}`, {
    method: req.method,
    headers: {
      "content-type": req.headers["content-type"] ?? "text/plain",
      "user-agent": req.headers["user-agent"] ?? "",
    },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "text/html" });
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => front.listen(4173, "127.0.0.1", r));
const url = `http://localhost:4173${s.path}`;
console.log(
  `\nCondition: ${cond}\nForm:      ${url}\n\nGive your agent this task and do not help it:\n\n${s.task(url, personaText)}\n\nWaiting for the agent. Ctrl+C when done.\n`,
);
let seen = 0;
watch(logPath, () => {
  const ev = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (const e of ev.slice(seen)) {
    if (e.type === "form_view") console.log("· the agent opened the form");
    if (e.type === "held")
      console.log(`■ HELD: did not pass. Signals: ${e.note?.verdict?.signals?.join(", ") ?? "none"}`);
    if (e.type === "gate_pass" && e.note?.passed) console.log("□ the moving digits were solved");
    if (e.type === "submit_ok")
      console.log(`✓ SUBMITTED: the agent got through, verdict ${e.note?.verdict?.verdict ?? "none"}`);
  }
  seen = ev.length;
});
