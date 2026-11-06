/**
 * Fig. 1: the declaration question of the screenshot round's graduate-application form, re-rendered at print
 * resolution in the two states of screenshots 13 and 15 of run L4-b claude_pixeln_sonnet__phd__declare_default_nc_na__2.
 *
 *   npx tsx paper/figs/render_fig1.ts
 *
 * The page is built by the bench's own code (bench/sites/server.ts page() and formHtml(), the `declare_default`
 * condition with `+nc`), so HTML and CSS are those the agent was served. Viewport 1280 x 800 as in the bench.
 * Writes paper/figs/fig1a.png and fig1b.png, cropped to the question with an even margin, same box in both.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { page as pageHtml, formHtml } from "../../bench/sites/server.ts";
import { scenarios } from "../../bench/sites/scenarios.ts";
import { channels } from "../../bench/experiments/conditions.ts";
import { persona } from "../../bench/sites/persona.ts";

const OUT = dirname(fileURLToPath(import.meta.url));
const SCALE = 6; // device pixels per CSS pixel
const MARGIN = 12; // CSS px around the question, on every side

const s = scenarios.phd;
const d = channels.declare_default("", s);
d.noCaptcha = true;
const html = pageHtml(s, d, s.pageTitle, formHtml(s, d), false);

const browser = await chromium.launch({ channel: "chrome" }); // the bench drives the installed Chrome
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
const p = await ctx.newPage();
await p.setContent(html, { waitUntil: "load" });

// State (a): every other field filled in, "Me, personally" still preselected.
const p0 = persona as Record<string, string>;
const values: Record<string, string> = {
  first_name: p0.firstName,
  last_name: p0.lastName,
  email: p0.email,
  phone: p0.phone,
  degree: p0.degree,
  interests: p0.interests,
  advisor: p0.advisor,
  statement: p0.statement,
};
for (const [name, v] of Object.entries(values)) if (v) await p.fill(`[name=${name}]`, v);
await p.selectOption("[name=country]", "United States");
await p.check("[name=certify]");

// Crop box: the legend and the three options, measured on their text, plus an even margin.
const fs = p.locator("fieldset:has(input[name=completed_by])");
await fs.scrollIntoViewIfNeeded();
const box = await fs.evaluate((el) => {
  const rects: DOMRect[] = [];
  for (const node of Array.from(el.querySelectorAll("legend, label"))) {
    const r = document.createRange();
    r.selectNodeContents(node);
    rects.push(r.getBoundingClientRect());
  }
  const x0 = Math.min(...rects.map((r) => r.left));
  const y0 = Math.min(...rects.map((r) => r.top));
  const x1 = Math.max(...rects.map((r) => r.right));
  const y1 = Math.max(...rects.map((r) => r.bottom));
  return { x: x0 + window.scrollX, y: y0 + window.scrollY, width: x1 - x0, height: y1 - y0 };
});
const clip = {
  x: Math.floor(box.x - MARGIN),
  y: Math.floor(box.y - MARGIN),
  width: Math.ceil(box.width + 2 * MARGIN),
  height: Math.ceil(box.height + 2 * MARGIN),
};

const checked = () => p.evaluate(() => (document.querySelector("input[name=completed_by]:checked") as HTMLInputElement).value);
if ((await checked()) !== "self") throw new Error("state (a) is not 'self'");
writeFileSync(join(OUT, "fig1a.png"), await p.screenshot({ clip, fullPage: true }));

// State (b): after the click on "An AI agent or automated tool, on my behalf".
await p.click("label:has(input[value=agent])");
if ((await checked()) !== "agent") throw new Error("state (b) is not 'agent'");
writeFileSync(join(OUT, "fig1b.png"), await p.screenshot({ clip, fullPage: true }));

await browser.close();
console.log(`fig1a.png, fig1b.png: ${clip.width} x ${clip.height} CSS px at ${SCALE}x`);
