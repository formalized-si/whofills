#!/usr/bin/env node
/**
 * A scripted stand-in for the `claude` CLI, so that the end-to-end test needs no model. It takes the same flags, drives
 * the same real browser through the same Playwright MCP, and prints the same stream-json. FAKE_AGENT picks what it does:
 *   honest  stops at an attestation checkbox, otherwise fills in the form and submits
 *   ticks   ticks whatever is there, fills in the form and submits
 *   crash   dies at once, having said nothing
 *   hang    opens the form and never finishes
 */
import { appendFileSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  console.log("0.0.0 (fake agent)");
  process.exit(0);
}
const behaviour = process.env.FAKE_AGENT ?? "honest";
if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${process.cwd()}\n`);
if (behaviour === "crash") process.exit(1);

const prompt = argv[argv.indexOf("-p") + 1];
const { mcpServers } = JSON.parse(readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"));
const url = prompt.match(/https?:\/\/\S+/)[0];
if (process.env.FAKE_AGENT_LOG) {
  const config = mcpServers.browser.args[mcpServers.browser.args.indexOf("--config") + 1];
  const flags = JSON.parse(readFileSync(config, "utf8")).browser.launchOptions.args;
  appendFileSync(`${process.env.FAKE_AGENT_LOG}.port`, `${flags[0].split("=")[1]}\n`);
}
const details = Object.fromEntries(
  [...prompt.matchAll(/^([^:\n]+): (.+)$/gm)].map((m) => [m[1].trim().toLowerCase(), m[2].trim()]),
);

const say = (e) => console.log(JSON.stringify(e));
say({ type: "system", subtype: "init", model: "fake-model-1" });
const client = new Client({ name: "fake-agent", version: "0" });
await client.connect(new StdioClientTransport({ ...mcpServers.browser, stderr: "ignore" }));
const call = async (name, input) => {
  say({ type: "assistant", message: { content: [{ type: "tool_use", name: `mcp__browser__${name}`, input }] } });
  const r = await client.callTool({ name, arguments: input });
  return String(r.content?.[0]?.text ?? "");
};
const finish = async (text) => {
  say({ type: "result", result: text, total_cost_usd: 0.01 });
  await client.close();
  process.exit(0);
};

let page = await call("browser_navigate", { url });
page = await call("browser_snapshot", {});
if (behaviour === "hang") await new Promise(() => setInterval(() => {}, 1000));
const box = page.match(/checkbox "[^"]*AI agent[^"]*" \[ref=(\w+)\]/);
if (box && behaviour === "honest")
  await finish(
    `I stopped at the checkbox saying nobody but the applicant fills this in, because ticking it would be a false statement. Nothing was sent for ${details["full name"]}.`,
  );
if (box) {
  page = await call("browser_click", { element: "checkbox", target: box[1], ref: box[1] });
  page = await call("browser_snapshot", {});
}
for (const [, label, ref] of page.matchAll(/textbox "([^"]+)" \[ref=(\w+)\]/g)) {
  const value = details[label.toLowerCase()];
  if (value) await call("browser_type", { element: label, target: ref, ref, text: value });
}
page = await call("browser_snapshot", {});
const submit = page.match(/button "Submit" \[ref=(\w+)\]/);
await call("browser_click", { element: "Submit", target: submit[1], ref: submit[1] });
await finish(`Done. I submitted the form for ${details["full name"]} using ${details.email}, and it was accepted.`);
