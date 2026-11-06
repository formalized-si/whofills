import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSpec } from "./args.ts";
import { isLocal } from "./safety.ts";

/** Pinned: a new Playwright MCP can change what agents see, and so the result. */
export const MCP_PACKAGE = "@playwright/mcp@0.0.84";
const MAC_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";

const executable = (p: string) => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export function onPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  isExec: (p: string) => boolean = executable,
) {
  for (const dir of (env.PATH ?? "").split(delimiter)) if (dir && isExec(join(dir, name))) return join(dir, name);
  return null;
}

/** The binary for one agent family, or null. CLAUDE_BIN and CODEX_BIN win over the PATH. */
export function findAgentBin(
  family: "claude" | "codex",
  env: NodeJS.ProcessEnv = process.env,
  isExec: (p: string) => boolean = executable,
) {
  const override = family === "claude" ? env.CLAUDE_BIN : env.CODEX_BIN;
  if (override) return isExec(override) ? override : null;
  const found = onPath(family, env, isExec);
  if (found) return found;
  return family === "codex" && isExec(MAC_CODEX) ? MAC_CODEX : null;
}

export function cliVersion(bin: string) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 8000 });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : "unknown";
}

export interface McpCommand {
  command: string;
  prefix: string[];
}

/** A copy next to this package or the project if there is one, otherwise npx. Keeps `npm i whofills` free of Playwright. */
export function findMcp(start = [process.cwd(), dirname(fileURLToPath(import.meta.url))]): McpCommand {
  for (const from of start) {
    let dir = resolve(from);
    for (;;) {
      const bin = join(dir, "node_modules/.bin/playwright-mcp");
      if (existsSync(bin)) return { command: bin, prefix: [] };
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return { command: "npx", prefix: ["-y", MCP_PACKAGE] };
}

/** Downloads Playwright MCP before the clock starts, so that a first run does not time out while installing. */
export function warmMcp(mcp: McpCommand) {
  if (mcp.prefix.length) spawnSync(mcp.command, [...mcp.prefix, "--version"], { stdio: "ignore", timeout: 180000 });
}

export function pwConfig(opts: { port: number; hostname: string; outputDir: string; chromeBin?: string }) {
  return {
    browser: {
      browserName: "chromium",
      isolated: true,
      launchOptions: {
        ...(opts.chromeBin ? { executablePath: opts.chromeBin } : { channel: "chrome" }),
        headless: true,
        args: [
          `--remote-debugging-port=${opts.port}`,
          ...(isLocal(opts.hostname) ? ["--ignore-certificate-errors"] : []),
        ],
      },
      contextOptions: { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: isLocal(opts.hostname) },
    },
    outputDir: opts.outputDir,
  };
}

export interface Command {
  cmd: string;
  args: string[];
  stdin?: string;
}

/** The same flags as the bench's DOM agents, so a result here means the same thing: no user settings, browser tools only. */
export function buildCommand(
  spec: AgentSpec,
  bin: string,
  o: { prompt: string; cwd: string; mcpConfigPath: string; mcp: McpCommand; pwConfigPath: string },
): Command {
  const mcpArgs = [...o.mcp.prefix, "--config", o.pwConfigPath];
  if (spec.family === "claude") {
    writeFileSync(
      o.mcpConfigPath,
      JSON.stringify({ mcpServers: { browser: { command: o.mcp.command, args: mcpArgs, env: {} } } }),
    );
    return {
      cmd: bin,
      args: [
        "-p",
        o.prompt,
        ...(spec.model ? ["--model", spec.model] : []),
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--mcp-config",
        o.mcpConfigPath,
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--tools",
        "",
        "--allowedTools",
        "mcp__browser__*",
        "--max-turns",
        "80",
        ...(spec.effort ? ["--effort", spec.effort] : []),
      ],
    };
  }
  const q = (s: string) => JSON.stringify(s);
  return {
    cmd: bin,
    args: [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--json",
      "-C",
      o.cwd,
      "-s",
      "read-only",
      ...(spec.model ? ["-m", spec.model] : []),
      "-c",
      `approval_policy="never"`,
      ...(spec.effort ? ["-c", `model_reasoning_effort="${spec.effort}"`] : []),
      "-c",
      `mcp_servers.browser.command=${q(o.mcp.command)}`,
      "-c",
      `mcp_servers.browser.args=${JSON.stringify(mcpArgs)}`,
      "-c",
      "mcp_servers.browser.startup_timeout_sec=60",
      "-c",
      "mcp_servers.browser.tool_timeout_sec=120",
      "-c",
      `mcp_servers.browser.default_tools_approval_mode="approve"`,
      "-",
    ],
    stdin: o.prompt,
  };
}

export interface Transcript {
  finalText: string;
  toolCalls: number;
  costUsd?: number;
  model?: string;
  /** Everything the agent typed. Kept only to remove it from what the agent says. */
  typed: Set<string>;
}

export const newTranscript = (): Transcript => ({ finalText: "", toolCalls: 0, typed: new Set() });

function collectTyped(input: unknown, into: Set<string>) {
  if (Array.isArray(input)) for (const v of input) collectTyped(v, into);
  else if (input && typeof input === "object")
    for (const [k, v] of Object.entries(input)) {
      if ((k === "text" || k === "value" || k === "values") && typeof v === "string") into.add(v);
      else collectTyped(v, into);
    }
}

/** One line of an agent's JSON output. Parsed in memory and dropped: transcripts hold submitted values, so none is saved. */
export function feedTranscript(t: Transcript, family: "claude" | "codex", line: string) {
  let e: any;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (family === "claude") {
    if (e.type === "system" && e.subtype === "init" && e.model) t.model = e.model;
    if (e.type === "assistant")
      for (const c of e.message?.content ?? []) {
        if (c.type === "tool_use") {
          t.toolCalls++;
          collectTyped(c.input, t.typed);
        }
        if (c.type === "text" && c.text?.trim()) t.finalText = c.text;
      }
    if (e.type === "result") {
      if (typeof e.result === "string" && e.result.trim()) t.finalText = e.result;
      if (typeof e.total_cost_usd === "number") t.costUsd = e.total_cost_usd;
    }
  } else if (e.type === "item.completed" && e.item) {
    const it = e.item;
    if (it.type === "agent_message" && it.text) t.finalText = it.text;
    if (it.type === "mcp_tool_call" || it.type === "function_call") {
      t.toolCalls++;
      collectTyped(it.arguments, t.typed);
    }
  }
}

export interface AgentExit {
  transcript: Transcript;
  stderr: string;
  exit: number | null;
  timedOut: boolean;
  durationMs: number;
}

/** Process groups of running agents, so that Ctrl+C leaves no browser behind on a shared machine. */
export const running = new Set<number>();
const killGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
};
/** Working directories in use: they can hold page snapshots with typed values, so an interrupted run removes them too. */
const scratch = new Set<string>();
const removeScratch = (dir: string) => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  scratch.delete(dir);
};
export const killAll = () => {
  for (const pid of running) killGroup(pid, "SIGKILL");
  for (const dir of [...scratch]) removeScratch(dir);
};

const STDERR_KEEP = 8000;

export async function runAgent(
  spec: AgentSpec,
  bin: string,
  o: { prompt: string; port: number; hostname: string; mcp: McpCommand; timeoutMs: number; chromeBin?: string },
): Promise<AgentExit> {
  // The agent can see its working directory, so it says nothing about what is going on and sits outside any repo.
  // Playwright MCP also writes page snapshots under it, which can show typed values, so it is deleted after the run.
  const base = existsSync("/tmp") ? realpathSync("/tmp") : tmpdir();
  const cwd = mkdtempSync(join(base, "work-"));
  const conf = mkdtempSync(join(base, "conf-"));
  scratch.add(cwd).add(conf);
  const pwConfigPath = join(conf, "pw.json");
  writeFileSync(pwConfigPath, JSON.stringify(pwConfig({ ...o, outputDir: join(cwd, "out") })));
  const command = buildCommand(spec, bin, {
    prompt: o.prompt,
    cwd,
    mcp: o.mcp,
    pwConfigPath,
    mcpConfigPath: join(conf, "mcp.json"),
  });
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const t0 = Date.now();
  const transcript = newTranscript();
  let stderr = "";
  let timedOut = false;
  try {
    const child = spawn(command.cmd, command.args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    child.stdin.on("error", () => {});
    child.stdin.end(command.stdin ?? "");
    if (child.pid) running.add(child.pid);
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) feedTranscript(transcript, spec.family, l);
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-STDERR_KEEP);
    });
    const exit = await new Promise<number | null>((done) => {
      const killer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killGroup(child.pid, "SIGTERM");
        setTimeout(() => {
          if (child.pid) killGroup(child.pid, "SIGKILL");
          done(null); // a grandchild may hold the pipes open for ever
        }, 5000);
      }, o.timeoutMs);
      child.on("error", (e) => {
        stderr += `spawn failed: ${e.message}\n`;
        clearTimeout(killer);
        done(null);
      });
      child.on("close", (code) => {
        clearTimeout(killer);
        done(code);
      });
    });
    if (buf) feedTranscript(transcript, spec.family, buf);
    if (child.pid) {
      running.delete(child.pid);
      killGroup(child.pid, "SIGKILL");
    }
    return { transcript, stderr, exit, timedOut, durationMs: Date.now() - t0 };
  } finally {
    removeScratch(cwd);
    removeScratch(conf);
  }
}
