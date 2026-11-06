/** Gate mode adds a line at the top of the form. How much does that move the page for a visitor? */
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSite } from "../sites/server.ts";
import { scenarios } from "../sites/scenarios.ts";
import { channels, payloadText } from "../experiments/conditions.ts";

const s = scenarios.phd;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-certificate-errors"] });
for (const cond of ["none", "sdk_gate"]) {
  const site = await startSite({
    scenario: "phd",
    defense: { ...channels[cond](payloadText("policy", s), s), noCaptcha: true },
    logPath: join(mkdtempSync(join(tmpdir(), "gate-")), "l.jsonl"),
  });
  const vals: number[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      (window as any).__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await p.goto(`https://127.0.0.1:${site.port}${s.path}`, { waitUntil: "load" });
    await p.waitForTimeout(500);
    vals.push(await p.evaluate(() => (window as any).__cls as number));
    await ctx.close();
  }
  console.log(cond, "CLS", Math.max(...vals).toFixed(4));
  await site.close();
}
await browser.close();
process.exit(0);
