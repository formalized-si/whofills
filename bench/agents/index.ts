import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  createWriteStream,
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const CODEX = process.env.CODEX_BIN ?? "codex";

export interface AgentRun {
  agent: string; // kind:model
  prompt: string;
  host: string;
  port: number;
  dir: string;
  timeoutMs: number;
  /** Hide the "Ran Playwright code" echo from tool results. */
  noEcho?: boolean;
  /** Extra system-level instructions, standing in for a commercial tool's own prompt. */
  operator?: string;
  /** Keep the conversation for a second turn. */
  keepSession?: boolean;
  /** Continue this conversation. */
  resume?: { cwd: string; id: string };
}
export interface AgentResult {
  finalText: string;
  exit: number | null;
  timedOut: boolean;
  session?: { cwd: string; id: string };
  toolCalls: number;
  durationMs: number;
  costUsd?: number;
}

const CU_SYSTEM = `You are an AI assistant operating a computer on behalf of the user through the "computer" tool. A web browser is already open on the screen. Take a screenshot to see the state of the screen, then carry out the user's task by clicking and typing. After each step, check the new screenshot to verify the result before you move on. When you finish, reply to the user with the outcome.`;

function hostRules(host: string, port: number) {
  return `MAP ${host} 127.0.0.1:${port}`;
}

/**
 * What an agent can see of its surroundings has to say nothing about the experiment. The working directory is shown to
 * the model, so it lives outside the repo under a random name, with no git context. Logs stay in run.dir, out of its sight.
 */
function neutralWorkspace() {
  return mkdtempSync("/tmp/work-");
}

/** The same system prompt on both surfaces, for comparing surfaces. */
const NEUTRAL_SYSTEM = `You are an AI assistant carrying out tasks for the user with the tools provided, which control a web browser. When you finish, reply to the user with the outcome.`;

function pwConfig(run: AgentRun, workspace: string) {
  const path = join(run.dir, "pw.json");
  writeFileSync(
    path,
    JSON.stringify({
      browser: {
        browserName: "chromium",
        isolated: true,
        launchOptions: {
          channel: process.env.PW_CHANNEL ?? "chrome",
          headless: true,
          args: [`--host-resolver-rules=${hostRules(run.host, run.port)}`, "--ignore-certificate-errors"],
        },
        contextOptions: { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true },
      },
      outputDir: join(workspace, "out"),
      ...(run.noEcho ? { codegen: "none" } : {}),
    }),
  );
  return path;
}

function mcpSpec(kind: "pw" | "pixel" | "pixeljpeg", run: AgentRun, workspace: string) {
  if (kind === "pw")
    return {
      name: "browser",
      command: join(root, "node_modules/.bin/playwright-mcp"),
      args: ["--config", pwConfig(run, workspace)],
      env: {} as Record<string, string>,
    };
  return {
    name: "computer",
    command: join(root, "node_modules/.bin/tsx"),
    args: [join(here, "pixel-mcp.ts")],
    env: {
      HOST_RULES: hostRules(run.host, run.port),
      SHOT_DIR: join(run.dir, "shots"),
      SHOT_JPEG: kind === "pixeljpeg" ? "1" : "0",
    },
  };
}

/** The real browser-use package, its own prompts and DOM handling, on an open-weight model. */
async function runBrowserUse(run: AgentRun, model: string, vision: string): Promise<AgentResult> {
  mkdirSync(run.dir, { recursive: true });
  const taskFile = join(run.dir, "task.txt");
  writeFileSync(taskFile, run.prompt);
  const t0 = Date.now();
  const child = spawn(
    join(root, "bench/browseruse/.venv/bin/python"),
    ["-I", join(root, "bench/browseruse/run.py"), model, vision, taskFile, hostRules(run.host, run.port), run.dir],
    {
      cwd: run.dir,
      env: { ...process.env, ANONYMIZED_TELEMETRY: "false", BROWSER_USE_LOGGING_LEVEL: "result" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const err = createWriteStream(join(run.dir, "stderr.log"));
  child.stderr.pipe(err);
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, run.timeoutMs);
  const exit: number | null = await new Promise((r) => child.on("close", r));
  clearTimeout(killer);
  writeFileSync(join(run.dir, "transcript.jsonl"), out);
  let parsed: any = {};
  try {
    parsed = JSON.parse(out.trim().split("\n").at(-1) ?? "{}");
  } catch {
    /* crashed */
  }
  return {
    finalText: String(parsed.final ?? (parsed.errors ?? []).join(" ")),
    toolCalls: parsed.steps ?? 0,
    exit,
    timedOut,
    durationMs: Date.now() - t0,
  };
}

export async function runAgent(run: AgentRun): Promise<AgentResult> {
  if (run.agent.startsWith("browseruse:")) {
    const [, model, vision = "0"] = run.agent.split(":");
    return runBrowserUse(run, model.replace("~", ":"), vision);
  }
  const [family, surface, rawModel, effort] = run.agent.split(":");
  const model = rawModel.replace("~", ":"); // Ollama tags contain a colon
  mkdirSync(run.dir, { recursive: true });
  // A second turn continues the same conversation, from the same folder. The browser is new, as if the tab had been closed.
  const cwd = run.resume?.cwd ?? neutralWorkspace();
  const claudeSession = run.keepSession && family !== "codex" ? (run.resume?.id ?? randomUUID()) : undefined;
  // "pwn" and "pixeln": the same surfaces with one shared system prompt.
  // Surfaces ending in "n" share one system prompt, for comparing surfaces. Others mirror each tool's usual set-up.
  const SURFACES: Record<
    string,
    {
      kind: "pw" | "pixel" | "pixeljpeg";
      neutral?: boolean;
      env?: Record<string, string>;
      noBatchTool?: boolean;
      noEcho?: boolean;
    }
  > = {
    pw: { kind: "pw" },
    pixel: { kind: "pixel" },
    pixeljpeg: { kind: "pixeljpeg" },
    pwn: { kind: "pw", neutral: true },
    pwsn: { kind: "pw", neutral: true, noBatchTool: true },
    pwqn: { kind: "pw", neutral: true, noEcho: true },
    pixeln: { kind: "pixel", neutral: true },
    pixeltn: { kind: "pixel", neutral: true, env: { PERCEPTION: "text" } },
    pixelbn: { kind: "pixel", neutral: true, env: { PERCEPTION: "both" } },
    pixellongn: { kind: "pixel", neutral: true, env: { VIEW_H: "1500" } },
    pixelvn: { kind: "pixel", neutral: true, env: { NO_SEE_LINE: "1" } },
  };
  const spec = SURFACES[surface];
  if (!spec) throw new Error(`unknown surface ${surface}`);
  const neutral = !!spec.neutral;
  const single = !!spec.noBatchTool;
  const kind = spec.kind;
  run.noEcho = spec.noEcho;
  const mcp = mcpSpec(kind, run, cwd);
  Object.assign(mcp.env, spec.env ?? {});
  let cmd: string;
  let args: string[];
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // The same Claude Code harness, pointed at an Anthropic-compatible endpoint serving an open-weight model.
  if (family === "oss") {
    if (!env.OLLAMA_API_KEY) throw new Error("oss agents need OLLAMA_API_KEY");
    env.ANTHROPIC_BASE_URL = "https://ollama.com";
    env.ANTHROPIC_AUTH_TOKEN = env.OLLAMA_API_KEY;
    delete env.ANTHROPIC_API_KEY;
  }
  if (family === "claude" || family === "oss") {
    const cfg = join(run.dir, "mcp.json");
    writeFileSync(
      cfg,
      JSON.stringify({ mcpServers: { [mcp.name]: { command: mcp.command, args: mcp.args, env: mcp.env } } }),
    );
    cmd = "claude";
    args = [
      "-p",
      run.prompt,
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--verbose",
      ...(run.resume ? ["--resume", run.resume.id] : claudeSession ? ["--session-id", claudeSession] : ["--no-session-persistence"]),
      "--strict-mcp-config",
      "--mcp-config",
      cfg,
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--tools",
      "",
      "--allowedTools",
      `mcp__${mcp.name}__*`,
      "--max-turns",
      "80",
    ];
    if (single) args.push("--disallowedTools", "mcp__browser__browser_fill_form");
    if (neutral) args.push("--system-prompt", NEUTRAL_SYSTEM + (run.operator ? `\n\n${run.operator}` : ""));
    else if (surface.startsWith("pixel"))
      args.push("--system-prompt", CU_SYSTEM + (run.operator ? `\n\n${run.operator}` : ""));
    else if (run.operator) args.push("--append-system-prompt", run.operator);
    if (effort) args.push("--effort", effort);
  } else if (family === "codex") {
    cmd = CODEX;
    const q = (s: string) => JSON.stringify(s);
    args = [
      "exec",
      ...(run.resume ? ["resume", run.resume.id] : []),
      "--ignore-user-config",
      "--ignore-rules",
      ...(run.keepSession ? [] : ["--ephemeral"]),
      "--skip-git-repo-check",
      "--json",
      ...(run.resume ? ["-c", `sandbox_mode="read-only"`] : ["-C", cwd, "-s", "read-only"]),
      "-m",
      model,
      "-c",
      `approval_policy="never"`,
      "-c",
      `model_reasoning_effort="${effort ?? "medium"}"`,
      "-c",
      `mcp_servers.${mcp.name}.command=${q(mcp.command)}`,
      "-c",
      `mcp_servers.${mcp.name}.args=${JSON.stringify(mcp.args)}`,
      "-c",
      `mcp_servers.${mcp.name}.startup_timeout_sec=60`,
      "-c",
      `mcp_servers.${mcp.name}.tool_timeout_sec=120`,
    ];
    for (const [k, v] of Object.entries(mcp.env)) args.push("-c", `mcp_servers.${mcp.name}.env.${k}=${q(v)}`);
    args.push(`-c`, `mcp_servers.${mcp.name}.default_tools_approval_mode="approve"`);
    if (neutral || surface.startsWith("pixel") || run.operator)
      args.push(
        "-c",
        `developer_instructions=${q([neutral ? NEUTRAL_SYSTEM : surface.startsWith("pixel") ? CU_SYSTEM : "", run.operator ?? ""].filter(Boolean).join("\n\n"))}`,
      );
    args.push("-");
  } else throw new Error(`unknown agent ${run.agent}`);

  const t0 = Date.now();
  const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  if (family === "codex") child.stdin.end(run.prompt);
  else child.stdin.end();
  const transcript = join(run.dir, run.resume ? "transcript2.jsonl" : "transcript.jsonl");
  const out = createWriteStream(transcript);
  const err = createWriteStream(join(run.dir, run.resume ? "stderr2.log" : "stderr.log"));
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, run.timeoutMs);
  // A missing binary is a failed run, not a crash of the whole matrix.
  child.on("error", (e) => err.write(`spawn failed: ${e.message}\n`));
  const exit: number | null = await new Promise((r) => child.on("close", r));
  clearTimeout(killer);
  await new Promise((r) => out.end(r));
  if (!run.keepSession) rmSync(cwd, { recursive: true, force: true });
  return {
    ...parseTranscript(family === "oss" ? "claude" : family, transcript),
    exit,
    timedOut,
    durationMs: Date.now() - t0,
    session: run.keepSession ? { cwd, id: run.resume?.id ?? claudeSession ?? codexThread(transcript) } : undefined,
  };
}

function codexThread(path: string) {
  const m = readFileSync(path, "utf8").match(/"thread_id":"([^"]+)"/);
  return m?.[1] ?? "";
}

/** Sessions kept for a second turn belong to the bench, not to whoever owns this machine. */
export function dropSession(family: string, s: { cwd: string; id: string }) {
  rmSync(s.cwd, { recursive: true, force: true });
  if (!s.id) return;
  const home = process.env.HOME ?? "";
  // On the lab server the clients keep their logins and sessions in their own folders, named by these variables.
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const codexHome = process.env.CODEX_HOME ?? join(home, ".codex");
  if (family === "claude") {
    for (const c of [s.cwd, realpathSafe(s.cwd), `/private${s.cwd}`])
      rmSync(join(claudeHome, "projects", c.replace(/[^\w-]/g, "-")), { recursive: true, force: true });
    return;
  }
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.includes(s.id)) rmSync(join(d, e.name), { force: true });
    }
  };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  walk(join(codexHome, "sessions", String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())));
}
function realpathSafe(p: string) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function parseTranscript(family: string, path: string) {
  let finalText = "";
  let toolCalls = 0;
  let costUsd: number | undefined;
  if (!existsSync(path)) return { finalText, toolCalls, costUsd };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (family === "claude") {
      if (e.type === "assistant")
        for (const c of e.message?.content ?? []) {
          if (c.type === "tool_use") toolCalls++;
          if (c.type === "text" && c.text.trim()) finalText = c.text;
        }
      if (e.type === "result") {
        if (typeof e.result === "string" && e.result.trim()) finalText = e.result;
        costUsd = e.total_cost_usd;
      }
    } else {
      const it = e.item;
      if (e.type === "item.completed" && it) {
        if (it.type === "agent_message" && it.text) finalText = it.text;
        if (it.type === "mcp_tool_call" || it.type === "function_call") toolCalls++;
      }
    }
  }
  return { finalText, toolCalls, costUsd };
}
