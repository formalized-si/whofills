#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { detectFramework, needsCopy, newSecret, renderInit } from "./init.ts";
import { renderSummary, summarize } from "./summarize.ts";
import { testCommand } from "./test-command.ts";
import { USAGE } from "./wording.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** dist/cli.js when published, src/cli/main.ts from the repo. */
function packageRoot() {
  for (const up of ["..", "../.."]) if (existsSync(join(here, up, "package.json"))) return join(here, up);
  return here;
}

const version = () => {
  try {
    return JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")).version as string;
  } catch {
    return "unknown";
  }
};

async function init(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { form: { type: "string", default: "form" } } });
  let pkg: unknown = {};
  try {
    pkg = JSON.parse(readFileSync("package.json", "utf8"));
  } catch {
    /* no package.json: plain HTML snippets */
  }
  const detected = detectFramework(pkg, existsSync);
  console.log(renderInit(detected, values.form!, newSecret()));
  // Nothing is written unless a person says yes in a terminal.
  if (!needsCopy(detected) || !detected.publicDir || !process.stdin.isTTY || !process.stdout.isTTY) return 0;
  const dist = join(packageRoot(), "dist");
  if (!existsSync(join(dist, "whofills.js"))) return 0;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const dir = detected.publicDir;
  const answer = await rl.question(`\nCopy whofills.js and hold.js into ${dir}/ now? [y/N] `);
  rl.close();
  if (/^y(es)?$/i.test(answer.trim())) {
    mkdirSync(join(dir, "__wf"), { recursive: true });
    copyFileSync(join(dist, "whofills.js"), join(dir, "whofills.js"));
    copyFileSync(join(dist, "hold.js"), join(dir, "__wf", "hold.js"));
    console.log(`Copied into ${dir}/.`);
  }
  return 0;
}

function summarizeCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "boolean", default: false } },
  });
  const file = positionals[0];
  if (!file) {
    console.error("Give a file of decisions, one JSON object per line: whofills summarize decisions.jsonl");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file === "-" ? 0 : file, "utf8");
  } catch {
    console.error(`Could not read ${file}.`);
    return 2;
  }
  const s = summarize(text);
  console.log(values.json ? JSON.stringify(s, null, 2) : renderSummary(s));
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "test") return await testCommand(rest, version());
    if (command === "init") return await init(rest);
    if (command === "summarize") return summarizeCommand(rest);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code?.startsWith("ERR_PARSE_ARGS")) {
      console.error((e as Error).message);
      return 2;
    }
    throw e;
  }
  if (command === "--version" || command === "-v") {
    console.log(version());
    return 0;
  }
  console.log(USAGE);
  return !command || command === "--help" || command === "-h" || command === "help" ? 0 : 2;
}

process.exitCode = await main();
