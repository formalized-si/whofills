/**
 * Oracle for "a person and a crawler cannot tell the SDK is there".
 * Compares the unprotected page with the protected page in real Chrome. Each check is a claim we publish,
 * so a failed check is a failed release, not a warning.
 *   tsx bench/oracles/parity.ts <outdir> [condition] [scenarios...]
 */
import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startSite } from "../sites/server.ts";
import { scenarios } from "../sites/scenarios.ts";
import { channels, payloadText } from "../experiments/conditions.ts";

const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BINGBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/141.0.0.0 Safari/537.36";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const out = resolve(process.argv[2] ?? "bench/runs/parity");
mkdirSync(out, { recursive: true });
const cond = process.argv[3] ?? "sdk";
const list = process.argv.slice(4).length ? process.argv.slice(4) : Object.keys(scenarios);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 16);

async function observe(browser: Browser, url: string, ua?: string) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    userAgent: ua,
    deviceScaleFactor: 1,
  });
  const p = await ctx.newPage();
  const consoleMsgs: string[] = [];
  p.on("console", (m) => consoleMsgs.push(m.text()));
  await p.addInitScript(() => {
    (window as any).__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(400);
  const snap = async (pg: Page) => ({
    html: await pg.evaluate(() => {
      const c = document.documentElement.cloneNode(true) as HTMLElement;
      c.querySelectorAll("script").forEach((s) => s.remove());
      c.querySelector("form")?.removeAttribute("data-wf-protect");
      c.querySelector("form")?.removeAttribute("data-wf-bound");
      return c.outerHTML;
    }),
    text: await pg.evaluate(() => document.body.innerText),
    title: await pg.title(),
    aria: await pg.locator("body").ariaSnapshot(),
    links: await pg.evaluate(() => [...document.links].map((a) => a.href)),
    boxes: await pg.evaluate(() =>
      [...document.querySelectorAll("h1,label,input,select,textarea,button")].map((e) => {
        const r = e.getBoundingClientRect();
        return [e.tagName, r.x, r.y, r.width, r.height].join();
      }),
    ),
    png: await pg.screenshot({ fullPage: true, animations: "disabled", caret: "hide" }),
  });
  const before = await snap(p);
  const metrics0 = (await cdp.send("Performance.getMetrics")).metrics;
  // Tab order
  const order: string[] = [];
  for (let i = 0; i < 16; i++) {
    await p.keyboard.press("Tab");
    order.push(
      await p.evaluate(
        () => (document.activeElement as HTMLInputElement)?.name || document.activeElement?.tagName || "",
      ),
    );
  }
  // After interaction: click and type in the first text field.
  const first = p.locator("input[type=text],input[type=email]").first();
  await first.click({ position: { x: 21, y: 13 } });
  await p.keyboard.type("Ada", { delay: 80 });
  await p.waitForTimeout(150);
  const after = await snap(p);
  const cls = await p.evaluate(() => (window as any).__cls as number);
  const metrics1 = (await cdp.send("Performance.getMetrics")).metrics;
  const m = (ms: typeof metrics1, k: string) => ms.find((x) => x.name === k)?.value ?? 0;
  const res = {
    before,
    after,
    order,
    cls,
    consoleMsgs,
    scriptS: m(metrics0, "ScriptDuration"),
    taskS: m(metrics1, "TaskDuration"),
  };
  await ctx.close();
  return res;
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-certificate-errors"] });
const rows: any[] = [];
let fail = 0;
for (const id of list) {
  const s = scenarios[id];
  const [ch, p = "policy"] = cond.split("/");
  const base = await startSite({ scenario: id, defense: { formAttrs: "" }, logPath: join(out, `${id}-base.jsonl`) });
  const prot = await startSite({
    scenario: id,
    defense: channels[ch](payloadText(p as any, s), s),
    logPath: join(out, `${id}-prot.jsonl`),
  });
  // Raw responses must not depend on who is asking: no cloaking, by construction and by test.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const raw = await Promise.all(
    [GOOGLEBOT, BINGBOT, CHROME].map(async (ua) =>
      (await fetch(`https://127.0.0.1:${prot.port}${s.path}`, { headers: { "user-agent": ua } })).text(),
    ),
  );
  const rawSame = raw.every((r) => r === raw[0]);
  rows.push({ scenario: id, who: "all", check: "raw-html-same-for-every-ua", pass: rawSame });
  if (!rawSame) {
    fail++;
    console.log(`FAIL ${id} raw-html-same-for-every-ua`);
  }
  for (const [who, ua] of [
    ["person", undefined],
    ["googlebot", GOOGLEBOT],
    ["bingbot", BINGBOT],
  ] as const) {
    // A/A control: the unprotected page against itself. Whatever differs here is rendering noise, not the SDK.
    const A = await observe(browser, `https://127.0.0.1:${base.port}${s.path}`, ua);
    const A2 = await observe(browser, `https://127.0.0.1:${base.port}${s.path}`, ua);
    let B = await observe(browser, `https://127.0.0.1:${prot.port}${s.path}`, ua);
    const aaNoise = sha(A.after.png) !== sha(A2.after.png);
    rows.push({ scenario: id, who, check: "aa-control-noise", value: aaNoise });
    // Interaction timing makes the focus ring repaint differently under load, so a pixel mismatch gets retried.
    // It only passes on an exact match with the baseline; a real change never does, so this cannot hide one.
    const same = () =>
      (sha(A.after.png) === sha(B.after.png) || sha(A2.after.png) === sha(B.after.png)) &&
      (sha(A.before.png) === sha(B.before.png) || sha(A2.before.png) === sha(B.before.png));
    for (let tries = 0; tries < 4 && !same(); tries++)
      B = await observe(browser, `https://127.0.0.1:${prot.port}${s.path}`, ua);
    const norm = (h: string) =>
      h
        .replace(/\s+/g, " ")
        .replace(/127\.0\.0\.1:\d+/g, "H")
        .replace(/ data-wf-[a-z]+="[^"]*"/g, "");
    const checks: Record<string, boolean> = {
      "rendered-html": norm(A.before.html) === norm(B.before.html),
      "visible-text": A.before.text === B.before.text,
      title: A.before.title === B.before.title,
      links:
        JSON.stringify(A.before.links.map((l) => l.replace(/\d+/g, ""))) ===
        JSON.stringify(B.before.links.map((l) => l.replace(/\d+/g, ""))),
      "aria-before": A.before.aria === B.before.aria,
      "aria-after-interaction": A.after.aria === B.after.aria,
      "pixels-before": sha(A.before.png) === sha(B.before.png) || sha(A2.before.png) === sha(B.before.png),
      "pixels-after-interaction": sha(A.after.png) === sha(B.after.png) || sha(A2.after.png) === sha(B.after.png),
      "layout-boxes": JSON.stringify(A.after.boxes) === JSON.stringify(B.after.boxes),
      "tab-order": A.order.join() === B.order.join(),
      "cls-unchanged": Math.abs(A.cls - B.cls) < 1e-4,
    };
    for (const [k, v] of Object.entries(checks)) {
      rows.push({ scenario: id, who, check: k, pass: v });
      if (!v) {
        fail++;
        console.log(`FAIL ${id} ${who} ${k}`);
      }
    }
    if (!checks["pixels-before"] || !checks["pixels-after-interaction"]) {
      writeFileSync(join(out, `${id}-${who}-a.png`), A.after.png);
      writeFileSync(join(out, `${id}-${who}-b.png`), B.after.png);
    }
    if (!checks["aria-after-interaction"]) {
      writeFileSync(join(out, `${id}-${who}-a.aria`), A.after.aria);
      writeFileSync(join(out, `${id}-${who}-b.aria`), B.after.aria);
    }
    rows.push({
      scenario: id,
      who,
      check: "script-cost-ms",
      value: Math.round((B.scriptS - A.scriptS) * 1000 * 10) / 10,
    });
  }
  await base.close();
  await prot.close();
}
await browser.close();
writeFileSync(join(out, "parity.json"), JSON.stringify(rows, null, 1));
const checked = rows.filter((r) => "pass" in r);
console.log(
  `${cond}: ${checked.filter((r) => r.pass).length}/${checked.length} parity checks pass; script cost ms: ${rows
    .filter((r) => r.check === "script-cost-ms")
    .map((r) => r.value)
    .join(", ")}`,
);
process.exit(fail ? 1 : 0);
