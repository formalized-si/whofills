/** Real Chrome, real SDK bundle, real site server. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSite, type SiteHandle } from "../bench/sites/server.ts";
import { scenarios } from "../bench/sites/scenarios.ts";
import { channels, payloadText } from "../bench/experiments/conditions.ts";

let browser: Browser;
const dir = mkdtempSync(join(tmpdir(), "whofills-"));
const open = async (cond: string, opts: { reduced?: boolean; js?: boolean } = {}) => {
  const s = scenarios.phd;
  const logPath = join(dir, `${cond}-${Math.random()}.jsonl`);
  const site: SiteHandle = await startSite({
    scenario: "phd",
    defense: { ...channels[cond](payloadText("policy", s), s), noCaptcha: true },
    logPath,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
    javaScriptEnabled: opts.js ?? true,
  });
  const page = await ctx.newPage();
  await page.goto(`https://127.0.0.1:${site.port}${s.path}`);
  const log = () =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return {
    page,
    site,
    log,
    s,
    done: async () => {
      await ctx.close();
      await site.close();
    },
  };
};
/** Paths, pauses and irregular keys. A model of a person for wiring tests, not evidence about real people. */
async function humanFill(p: Page, s = scenarios.phd) {
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (const f of s.fields) {
    const el = p.locator(`[name=${f.name}]`).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) continue;
    const tx = box.x + box.width * rnd(0.15, 0.4),
      ty = box.y + box.height * rnd(0.25, 0.8);
    await p.mouse.move(tx - 80, ty - 30);
    for (let i = 1; i <= 8; i++) {
      await p.mouse.move(tx - 80 + 10 * i + rnd(-2, 2), ty - 30 + 3.7 * i + rnd(-2, 2));
      await p.waitForTimeout(rnd(8, 22));
    }
    await p.mouse.down();
    await p.waitForTimeout(rnd(60, 130));
    await p.mouse.up();
    if (f.type === "select") {
      await el.selectOption("United States");
      continue;
    }
    const text = f.type === "email" ? "ada@example.org" : "A short human answer";
    for (const ch of text) {
      await p.keyboard.type(ch);
      await p.waitForTimeout(rnd(40, 170));
    }
  }
}
beforeAll(async () => {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--ignore-certificate-errors", "--disable-blink-features=AutomationControlled"],
  });
});
afterAll(async () => {
  await browser.close();
});

describe("end to end", () => {
  it("a person-like session passes straight through, with a human verdict", async () => {
    const x = await open("sdk");
    await humanFill(x.page);
    await x.page.check("[name=certify]");
    await x.page.click("button.submit");
    await expect
      .poll(() => x.log().some((e) => e.type === "submit_ok" || e.type === "held" || e.type === "submit_rejected"), {
        timeout: 15000,
      })
      .toBe(true);
    const l = x.log();
    expect(l.filter((e) => ["submit_ok", "held", "submit_rejected"].includes(e.type)).map((e) => e.type)).toEqual([
      "submit_ok",
    ]);
    expect(l.some((e) => e.type === "held")).toBe(false);
    expect(l.find((e) => e.type === "gate_pass")?.note.verdict.verdict).not.toBe("agent");
    await x.done();
  }, 60000);
  it("scripted automation is held and cannot see the digits in the DOM", async () => {
    const x = await open("sdk");
    for (const f of x.s.fields) {
      if (f.type === "select") await x.page.selectOption(`[name=${f.name}]`, "United States");
      else await x.page.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "some text here");
    }
    await x.page.click("[name=certify]");
    await x.page.click("button.submit");
    await expect.poll(() => x.page.title(), { timeout: 15000 }).toBe("One more step");
    expect(x.log().some((e) => e.type === "held")).toBe(true);
    const text = await x.page.evaluate(() => document.documentElement.outerHTML.replace(/data-mask="[^"]*"/, ""));
    expect(/\b\d{5}\b/.test(text.replace(/value="[^"]*"/g, ""))).toBe(false);
    await x.done();
  }, 60000);
  it("form.submit() from a script is no way round: it carries the token and is held", async () => {
    const x = await open("sdk");
    for (const f of x.s.fields) {
      if (f.type === "select") await x.page.selectOption(`[name=${f.name}]`, "United States");
      else await x.page.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "some text here");
    }
    await x.page.click("[name=certify]");
    await x.page.evaluate(() => document.querySelector("form")!.submit());
    await expect.poll(() => x.page.title(), { timeout: 15000 }).toBe("One more step");
    expect(x.log().some((e) => e.type === "submit_ok")).toBe(false);
    await x.done();
  }, 60000);
  it("going back and submitting again after a hold meets the same step, even with clean signals", async () => {
    const x = await open("sdk");
    const fill = async () => {
      for (const f of x.s.fields) {
        if (f.type === "select") await x.page.selectOption(`[name=${f.name}]`, "United States");
        else await x.page.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "some text here");
      }
      await x.page.click("[name=certify]");
      await x.page.click("button.submit");
    };
    await fill();
    await expect.poll(() => x.page.title(), { timeout: 15000 }).toBe("One more step");
    await x.page.goBack();
    // A second attempt with no clicks and no typing at all: nothing here looks like an agent.
    await x.page.evaluate(() => document.querySelector("form")!.requestSubmit());
    await expect.poll(() => x.log().filter((e) => e.type === "held").length, { timeout: 15000 }).toBe(2);
    expect(x.log().some((e) => e.type === "submit_ok")).toBe(false);
    await x.done();
  }, 60000);
  it("declare: the question is there from the start with the human answer chosen, and a person just submits", async () => {
    const x = await open("sdk_declare");
    expect(await x.page.locator('input[name="wf_declared"][value="self"]').isChecked()).toBe(true);
    expect(await x.page.locator("fieldset legend", { hasText: "Who is filling in this form?" }).count()).toBe(1);
    await x.done();
  }, 60000);
  it("declare: choosing the agent answer meets the hold page with a plain explanation", async () => {
    const x = await open("sdk_declare");
    for (const f of x.s.fields) {
      if (f.type === "select") await x.page.selectOption(`[name=${f.name}]`, "United States");
      else await x.page.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "some text here");
    }
    await x.page.check('input[name="wf_declared"][value="agent"]');
    await x.page.check("[name=certify]");
    await x.page.evaluate(() => document.querySelector("form")!.requestSubmit());
    await expect.poll(() => x.page.title(), { timeout: 15000 }).toBe("One more step");
    expect(await x.page.content()).toMatch(/marked as filled in by an AI agent/);
    expect(x.log().some((e) => e.type === "submit_ok")).toBe(false);
    await x.done();
  }, 60000);
  it("the form still works with JavaScript off", async () => {
    const x = await open("sdk", { js: false });
    for (const f of x.s.fields) {
      if (f.type === "select") await x.page.selectOption(`[name=${f.name}]`, "United States");
      else await x.page.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "text");
    }
    await x.page.check("[name=certify]");
    await x.page.click("button.submit");
    await expect.poll(() => x.log().some((e) => e.type === "submit_ok"), { timeout: 15000 }).toBe(true);
    await x.done();
  }, 60000);
  it("the form still works when the script is blocked (ad blocker, CDN failure)", async () => {
    const s = scenarios.phd;
    const logPath = join(dir, `blocked-${Math.random()}.jsonl`);
    const site = await startSite({
      scenario: "phd",
      defense: { ...channels.sdk_visible(payloadText("policy", s), s), noCaptcha: true },
      logPath,
    });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.route("**/__wf/**", (r) => r.abort());
    await p.goto(`https://127.0.0.1:${site.port}${s.path}`);
    for (const f of s.fields) {
      if (f.type === "select") await p.selectOption(`[name=${f.name}]`, "United States");
      else await p.fill(`[name=${f.name}]`, f.type === "email" ? "a@b.example" : "text");
    }
    await p.check("[name=certify]");
    await p.click("button.submit");
    await expect.poll(() => readFileSync(logPath, "utf8").includes('"submit_ok"'), { timeout: 15000 }).toBe(true);
    await ctx.close();
    await site.close();
  }, 60000);
  it("the compact checkbox: nothing before the first input, then one required line the size of a captcha", async () => {
    const x = await open("sdk_check");
    expect(await x.page.locator("input[name=wf_attest]").count()).toBe(0);
    await x.page.locator("#f_first_name").click();
    await expect.poll(() => x.page.locator("input[name=wf_attest]").count()).toBe(1);
    const box = x.page.locator("label:has(input[name=wf_attest])");
    expect(await box.innerText()).toMatch(/not an AI agent/);
    const size = (await box.boundingBox())!;
    expect(size.height).toBeLessThan(48);
    expect(size.width).toBeLessThan(420);
    expect(await x.page.locator("input[name=wf_attest]").evaluate((e: HTMLInputElement) => e.required)).toBe(true);
    await x.done();
  }, 60000);
  it("gate: the form is locked until the checkbox is ticked, and the first thing in it is that checkbox", async () => {
    const x = await open("sdk_gate");
    await x.page.waitForSelector("input[name=wf_attest]");
    expect(await x.page.locator("form input, form select, form textarea").first().getAttribute("name")).toBe(
      "wf_attest",
    );
    for (const f of x.s.fields) expect(await x.page.locator(`[name=${f.name}]`).first().isDisabled()).toBe(true);
    expect(await x.page.locator("button.submit").isDisabled()).toBe(true);
    // A person clicking a locked field gets pointed at the checkbox.
    const first = x.page.locator(`[name=${x.s.fields[0].name}]`).first();
    expect(await first.evaluate((e: HTMLElement) => e.style.opacity)).toBe("0.5");
    const at = (await first.boundingBox())!;
    await x.page.mouse.click(at.x + 20, at.y + 10);
    expect(await x.page.evaluate(() => (document.activeElement as HTMLInputElement).name)).toBe("wf_attest");
    await x.page.check("input[name=wf_attest]");
    expect(await first.evaluate((e: HTMLElement) => e.style.opacity)).toBe("");
    for (const f of x.s.fields) expect(await x.page.locator(`[name=${f.name}]`).first().isDisabled()).toBe(false);
    expect(await x.page.locator("button.submit").isDisabled()).toBe(false);
    await x.page.uncheck("input[name=wf_attest]");
    expect(await x.page.locator("button.submit").isDisabled()).toBe(true);
    await x.done();
  }, 60000);
  it("gate: a person-like session ticks once and submits without being held", async () => {
    const x = await open("sdk_gate");
    await x.page.waitForSelector("input[name=wf_attest]");
    const b = (await x.page.locator("input[name=wf_attest]").boundingBox())!;
    await x.page.mouse.move(b.x + 40, b.y + 30);
    for (let i = 1; i <= 8; i++) {
      await x.page.mouse.move(b.x + 40 - i * 4, b.y + 30 - i * 3);
      await x.page.waitForTimeout(15);
    }
    await x.page.mouse.down();
    await x.page.waitForTimeout(90);
    await x.page.mouse.up();
    await humanFill(x.page);
    await x.page.check("[name=certify]");
    await x.page.click("button.submit");
    await expect
      .poll(() => x.log().some((e) => ["submit_ok", "held", "submit_rejected"].includes(e.type)), { timeout: 15000 })
      .toBe(true);
    expect(
      x
        .log()
        .filter((e) => ["submit_ok", "held", "submit_rejected"].includes(e.type))
        .map((e) => e.type),
    ).toEqual(["submit_ok"]);
    await x.done();
  }, 60000);
  it("gate: with JavaScript off the form is not locked", async () => {
    const x = await open("sdk_gate", { js: false });
    expect(await x.page.locator(`[name=${x.s.fields[0].name}]`).first().isDisabled()).toBe(false);
    await x.done();
  }, 60000);
  it("ambient attestation: nothing before the first input, required after it", async () => {
    const x = await open("sdk_ambient");
    expect(await x.page.locator("input[name=wf_attest]").count()).toBe(0);
    await x.page.locator("#f_first_name").click();
    await expect.poll(() => x.page.locator("input[name=wf_attest]").count()).toBe(1);
    expect(await x.page.locator("input[name=wf_attest]").getAttribute("aria-label")).toMatch(/no AI agent/);
    expect(await x.page.locator("input[name=wf_attest]").evaluate((e: HTMLInputElement) => e.required)).toBe(true);
    await x.done();
  }, 60000);
  it("ambient attestation: a person with reduced motion gets no animation at all", async () => {
    const x = await open("sdk_ambient", { reduced: true });
    await x.page.locator("#f_first_name").click();
    await expect.poll(() => x.page.locator("input[name=wf_attest]").count()).toBe(1);
    expect(await x.page.locator("label:has(input[name=wf_attest]) span[aria-hidden]").count()).toBe(0);
    await x.done();
  }, 60000);
  it("ambient attestation: frames alternate, and the row is hidden from the accessibility tree", async () => {
    const x = await open("sdk_ambient");
    await x.page.locator("#f_first_name").click();
    await expect.poll(() => x.page.locator("input[name=wf_attest]").count()).toBe(1);
    await x.page.locator("input[name=wf_attest]").scrollIntoViewIfNeeded();
    const colours = await x.page.evaluate(async () => {
      const el = document.querySelector("label:has(input[name=wf_attest]) span[aria-hidden]") as HTMLElement;
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        await new Promise(requestAnimationFrame);
        seen.add(el.style.color);
      }
      return [...seen];
    });
    expect(colours.length).toBeGreaterThanOrEqual(2);
    const aria = await x.page.locator("form").ariaSnapshot();
    const named = aria.split("\n").filter((l) => /no AI agent/.test(l));
    expect(named.length).toBe(1); // the accessible name, once, not the animated copy as well
    await x.done();
  }, 60000);
  it("a submit click before any other input still meets the attestation", async () => {
    const x = await open("sdk_visible");
    await x.page.click("button.submit");
    await x.page.waitForTimeout(150);
    expect(await x.page.locator("input[name=wf_attest]").count()).toBe(1);
    expect(x.log().some((e) => e.type === "submit_ok")).toBe(false);
    await x.done();
  }, 60000);
});
