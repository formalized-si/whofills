// node bench/heldout/panel-survey/verify.mjs [off|human|human-nowd|robot|shots|attest-probe]...   (default: off robot human human-nowd)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Human, startSite, solveHold, scanWords, assertValidate, launchOpts, recorderStats } from "./human.mjs";

const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const shot = (n) => fileURLToPath(new URL(`./${n}.png`, import.meta.url));
const LAST = "Delivery arrived on time but the bananas were badly bruised and two items were swapped without asking.";

const failures = [];
const want = (cond, msg) => { if (!cond) { failures.push(msg); console.log("  FAILED: " + msg); } };
function report(name, site, extra = "") {
  const ev = site.events();
  const ok = ev.filter((e) => e.type === "submit_ok");
  const held = ev.filter((e) => e.type === "held").length;
  const bad = ok[0] ? assertValidate(manifest, ok[0]) : ["no submit_ok"];
  console.log(`[${name}] submit_ok=${ok.length} held=${held} form_view=${ev.filter((e) => e.type === "form_view").length} validate=${bad.length ? "FAIL " + bad.join("; ") : "ok"} ${extra}`);
  return { ok: ok.length, held, bad };
}
const radio = (name, value) => `label:has(input[name="${name}"][value="${value}"])`;

async function fast(page) {
  await page.fill("#panel_id", "QP-308415");
  await page.click(radio("age_band", "35 to 44"));
  await page.selectOption("#region", "Central Plains");
  await page.fill("#household_size", "4");
  await page.click("text=Continue");
  await page.click(radio("main_store", "Discount grocer"));
  await page.fill("#weekly_spend", "145");
  await page.click(radio("delivery_apps", "Larder Run"));
  await page.click(radio("delivery_apps", "Parcelpear"));
  await page.click(radio("delivery_frequency", "A few times a month"));
  for (const [k, v] of [["rate_price", "Very"], ["rate_freshness", "Extremely"], ["rate_speed", "Slightly"], ["rate_packaging", "Somewhat"]]) await page.check(`input[name=${k}][value=${v}]`);
  await page.click("text=Continue");
  await page.check('input[name=recommend_score][value="7"]', { force: true });
  await page.fill("#last_order", LAST);
  await page.click(radio("future_surveys", "Yes"));
}

async function offRun() {
  const site = await startSite(SERVER, "off");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(site.url + manifest.path);
  await page.waitForSelector("form.survey-form");
  for (const h of await scanWords(page, "off")) want(false, h);
  await fast(page);
  await page.waitForTimeout(250);
  await page.click("text=Send my answers");
  await page.waitForSelector("#reference");
  const ref = await page.locator("#reference").innerText();
  for (const h of await scanWords(page, "off done")) want(false, h);
  const r = report("off", site, `ref=${ref}`);
  want(r.ok === 1 && !r.bad.length && !r.held, "off: exactly one valid submit_ok");
  want(!reqs.some((u) => /whofills|__wf/.test(u)), "off: no whofills requests");
  const js = await (await fetch(site.url + "/app.js")).text();
  want(!/no AI agent|wf_attest/.test(js), "off: bundle holds no attestation text");
  want(!errors.length, "off: no page errors " + errors.join());
  await b.close();
  site.stop();
}

async function onHuman(name, hideWd) {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(hideWd));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  console.log(`[${name}] navigator.webdriver will be ${!hideWd}`);
  const h = new Human(page);
  const t0 = Date.now();
  await page.goto(site.url + manifest.path);
  await page.waitForSelector("form.survey-form");
  await page.waitForFunction(() => !!window.whofills);
  await h.think();
  await h.fill(page.locator("#panel_id"), "QP-308415");
  await h.click(page.locator(radio("age_band", "35 to 44")));
  await h.select(page.locator("#region"), "Central");
  await h.fill(page.locator("#household_size"), "4");
  await h.think();
  await h.click(page.getByRole("button", { name: "Continue" }));
  await h.think();
  await h.click(page.locator(radio("main_store", "Discount grocer")));
  await h.fill(page.locator("#weekly_spend"), "145");
  await h.click(page.locator(radio("delivery_apps", "Larder Run")));
  await h.click(page.locator(radio("delivery_apps", "Parcelpear")));
  await h.click(page.locator(radio("delivery_frequency", "A few times a month")));
  for (const [k, v] of [["rate_price", "Very"], ["rate_freshness", "Extremely"], ["rate_speed", "Slightly"], ["rate_packaging", "Somewhat"]]) await h.click(page.locator(`label:has(input[name=${k}][value=${v}])`));
  await h.think();
  await h.click(page.getByRole("button", { name: "Continue" }));
  await h.think();
  await h.click(page.locator("label.dot:has(input[value='7'])"));
  await h.fill(page.locator("#last_order"), LAST);
  await h.click(page.locator(radio("future_surveys", "Yes")));
  for (const x of await scanWords(page, name + " last page")) want(false, x);
  await h.click(page.locator('label:has(input[name="wf_attest"])'), 10);
  await h.think();
  console.log(`  recorder before submit: ${JSON.stringify(await recorderStats(page))}`);
  await h.click(page.getByRole("button", { name: "Send my answers" }));
  await page.waitForTimeout(800);
  const held = (await page.locator("#wf-canvas").count()) > 0;
  const ref = held ? "(held)" : await page.locator("#reference").innerText({ timeout: 5000 }).catch(() => "(none)");
  const r = report(name, site, `ref=${ref} seconds=${Math.round((Date.now() - t0) / 1000)}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.ok === 1 && !r.bad.length, `${name}: exactly one valid submit_ok`);
  want(r.held === 0, `${name}: human-paced run must not be held`);
  want(!errors.length, `${name}: no page errors ${errors.join()}`);
  await b.close();
  site.stop();
}

async function robotRun() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const h = new Human(page);
  await page.goto(site.url + manifest.path);
  await page.waitForSelector("form.survey-form");
  await page.waitForFunction(() => !!window.whofills);
  await fast(page);
  await page.check('input[name="wf_attest"]');
  await page.click("text=Send my answers");
  await page.waitForSelector("#wf-canvas");
  console.log("[robot] held; hold page rendered in place of the SPA");
  for (const x of await scanWords(page, "hold page")) want(false, x);
  await page.screenshot({ path: shot("shot-hold") });
  const code = await solveHold(page, h);
  await page.waitForSelector("#reference");
  const ref = await page.locator("#reference").innerText();
  const r = report("robot", site, `ref=${ref} digits=${code}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.held === 1, "robot: scripted run is held exactly once");
  want(r.ok === 1 && !r.bad.length, "robot: after the hold, exactly one valid submit_ok with arrays intact");
  want(!errors.length, `robot: no page errors ${errors.join()}`);
  await b.close();
  site.stop();
}

// What happens if you follow the docs' script tag literally (data-attest="visible") on this paged React form?
async function attestProbe() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1000, height: 900 } });
  await page.route("**/survey", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('data-protect="form.survey-form"', 'data-protect="form.survey-form" data-attest="visible"') });
  });
  await page.goto(site.url + manifest.path);
  await page.waitForSelector("form.survey-form");
  await page.waitForFunction(() => !!window.whofills);
  await page.waitForTimeout(400); // the script re-scans for new forms on a 200 ms debounce
  await page.click("#panel_id");
  await page.waitForTimeout(100);
  const where = () => page.evaluate(() => { const i = [...document.querySelectorAll('input[name="wf_attest"]')]; return { count: i.length, visibleOnFirstPage: i.some((x) => x.offsetParent), parent: i[0]?.closest("label")?.parentElement?.className }; });
  console.log("[attest-probe] after first focus on page 1 of 3:", JSON.stringify(await where()));
  await page.screenshot({ path: shot("shot-attest-probe"), fullPage: true });
  await page.fill("#panel_id", "QP-308415");
  await page.click(radio("age_band", "35 to 44"));
  await page.selectOption("#region", "Central Plains");
  await page.fill("#household_size", "4");
  await page.click("text=Continue");
  await page.click(radio("main_store", "Discount grocer"));
  await page.fill("#weekly_spend", "145");
  await page.click(radio("delivery_apps", "I don't use any"));
  for (const [k, v] of [["rate_price", "Very"], ["rate_freshness", "Extremely"], ["rate_speed", "Slightly"], ["rate_packaging", "Somewhat"]]) await page.check(`input[name=${k}][value=${v}]`);
  await page.click("text=Continue");
  await page.waitForTimeout(400);
  console.log("[attest-probe] on page 3 of 3:", JSON.stringify(await where()));
  await b.close();
  site.stop();
}

async function shots() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await page.goto(site.url + manifest.path);
  await page.waitForSelector("form.survey-form");
  await page.screenshot({ path: shot("shot-page1"), fullPage: true });
  await fast(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot("shot-page3"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: shot("shot-page3-phone"), fullPage: true });
  await b.close();
  site.stop();
}

const which = process.argv.slice(2);
const on = (k) => !which.length || which.includes(k);
if (on("off")) await offRun();
if (on("robot")) await robotRun();
if (on("human")) await onHuman("human", false);
if (on("human-nowd")) await onHuman("human-nowd", true);
if (which.includes("attest-probe")) await attestProbe();
if (which.includes("shots")) await shots();
console.log(failures.length ? `FAILURES (${failures.length}):\n- ${failures.join("\n- ")}` : "ALL CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
