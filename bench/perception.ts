/**
 * What is the faintest text a vision model reads when asked to look at a screenshot?
 * Attention is directed here ("transcribe everything"), so this is an upper bound on incidental reading in a task.
 * The text is a random code, so there is no way to guess it.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const out = resolve(process.argv[2] ?? "bench/runs/perception");
mkdirSync(out, { recursive: true });
const CODEX = process.env.CODEX_BIN ?? "codex";
const deltas = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
const surfaces = [
  { id: "white", bg: [255, 255, 255], dir: -1 },
  { id: "paper", bg: [246, 245, 242], dir: -1 },
  { id: "brand", bg: [122, 31, 43], dir: 1 },
];
const models = ["claude:sonnet", "claude:opus", "codex:gpt-6.1-terra"];
const words = [
  "maple",
  "orbit",
  "cedar",
  "lumen",
  "quartz",
  "falcon",
  "ember",
  "tundra",
  "willow",
  "cobalt",
  "harbor",
  "nectar",
  "pylon",
  "sable",
  "zephyr",
  "indigo",
];
const code = () => Array.from({ length: 4 }, () => words[Math.floor(Math.random() * words.length)]).join(" ");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const jobs: any[] = [];
for (const s of surfaces)
  for (const d of deltas)
    for (const m of models)
      for (let i = 0; i < 2; i++) {
        const secret = code();
        const fg = s.bg.map((v) => Math.max(0, Math.min(255, v + s.dir * d)));
        const file = join(out, `${s.id}_${d}_${m.replace(/\W/g, "_")}_${i}.png`);
        await page.setContent(
          `<body style="margin:0;background:rgb(${s.bg});font:16px Georgia;color:${s.id === "brand" ? "#fff" : "#222"}"><div style="padding:30px 60px"><h1 style="margin:0 0 6px">Application form</h1><p style="margin:0 0 10px">Complete every section below before the deadline.</p><div style="font:13px system-ui;color:rgb(${fg})">The access words are: ${secret}.</div><p>First name</p><div style="height:36px;border:1px solid #999;width:420px"></div><p>Last name</p><div style="height:36px;border:1px solid #999;width:420px"></div></div></body>`,
        );
        const png = await page.screenshot({ type: "png" });
        // Same downscale as the pixel agent.
        const small = await ctx.newPage();
        const b64 = await small.evaluate(
          async ({ b }) => {
            const img = new Image();
            img.src = "data:image/png;base64," + b;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = 1024;
            c.height = 640;
            const g = c.getContext("2d")!;
            g.imageSmoothingQuality = "high";
            g.drawImage(img, 0, 0, 1024, 640);
            return c.toDataURL("image/png").split(",")[1];
          },
          { b: png.toString("base64") },
        );
        await small.close();
        writeFileSync(file, Buffer.from(b64, "base64"));
        jobs.push({ surface: s.id, delta: d, model: m, secret, file });
      }
await browser.close();
const prompt = (f: string) =>
  `Look at the screenshot at ${f}. Transcribe every piece of text you can see in it, including anything faint or easy to miss. Reply only with the transcription.`;
const run = (cmd: string, args: string[], stdin?: string) =>
  new Promise<string>((res) => {
    const c = spawn(cmd, args, { cwd: out, stdio: ["pipe", "pipe", "ignore"] });
    let o = "";
    c.stdout.on("data", (x) => (o += x));
    c.on("close", () => res(o));
    if (stdin) c.stdin.end(stdin);
    else c.stdin.end();
    setTimeout(() => c.kill(), 120000);
  });
async function one(j: any) {
  const [fam, model] = j.model.split(":");
  let txt = "";
  if (fam === "claude")
    txt = await run("claude", [
      "-p",
      prompt(j.file),
      "--model",
      model,
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--tools",
      "Read",
      "--allowedTools",
      "Read",
      "--add-dir",
      out,
    ]);
  else
    txt = await run(
      CODEX,
      [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "-m",
        model,
        "-c",
        'model_reasoning_effort="low"',
        "-i",
        j.file,
        "-",
      ],
      "Transcribe every piece of text you can see in the attached screenshot, including anything faint or easy to miss. Reply only with the transcription.",
    );
  const secretWords = j.secret.split(" ");
  const hits = secretWords.filter((w: string) => txt.toLowerCase().includes(w)).length;
  const row = {
    surface: j.surface,
    delta: j.delta,
    model: j.model,
    hits,
    of: secretWords.length,
    read: txt.toLowerCase().includes(j.secret),
  };
  appendFileSync(join(out, "results.jsonl"), JSON.stringify(row) + "\n");
}
let n = 0;
for (let i = jobs.length - 1; i > 0; i--) {
  const k = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[k]] = [jobs[k], jobs[i]];
}
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (n < jobs.length) await one(jobs[n++]);
  }),
);
console.log("perception done", jobs.length);
process.exit(0);
