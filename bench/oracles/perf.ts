/** What does the SDK cost a visitor? Main-thread time per second, input latency and long tasks, against the same page without it. */
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSite } from "../sites/server.ts";
import { scenarios } from "../sites/scenarios.ts";
import { channels, payloadText } from "../experiments/conditions.ts";

const dir = mkdtempSync(join(tmpdir(), "whofills-perf-"));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-certificate-errors"] });
const s = scenarios.phd;
async function measure(cond: string, rowVisible: boolean) {
  const site = await startSite({
    scenario: "phd",
    defense: { ...channels[cond](payloadText("policy", s), s), noCaptcha: true },
    logPath: join(dir, `${cond}.jsonl`),
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    (window as any).__lt = 0;
    (window as any).__ev = [];
    new PerformanceObserver((l) => {
      (window as any).__lt += l.getEntries().length;
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) (window as any).__ev.push(e.processingEnd - e.processingStart);
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as any);
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  await p.goto(`https://127.0.0.1:${site.port}${s.path}`, { waitUntil: "load" });
  await p.locator("#f_first_name").click();
  await p.keyboard.type("Ada Lovelace", { delay: 40 });
  if (rowVisible) {
    const a = p.locator("input[name=wf_attest]");
    if (await a.count()) await a.scrollIntoViewIfNeeded();
  }
  await p.waitForTimeout(300);
  const task = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")!.value;
  const t0 = await task();
  await p.waitForTimeout(3000);
  const t1 = await task();
  const r = await p.evaluate(() => ({
    lt: (window as any).__lt as number,
    ev: Math.max(0, ...((window as any).__ev as number[])),
  }));
  await ctx.close();
  await site.close();
  return {
    mainThreadPct: Math.round(((t1 - t0) / 3) * 1000) / 10,
    longTasks: r.lt,
    maxHandlerMs: Math.round(r.ev * 10) / 10,
  };
}
for (const [cond, vis] of [
  ["none", false],
  ["sdk", false],
  ["sdk_visible", false],
  ["sdk_ambient", false],
  ["sdk_ambient", true],
] as const)
  console.log(cond, vis ? "(row on screen)" : "", JSON.stringify(await measure(cond, vis)));
await browser.close();
process.exit(0);
