// node bench/heldout/grant-portal/verify.mjs [off|human|human-nowd|robot|shots]...   (default: all of them)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Human, startSite, solveHold, scanWords, assertValidate, launchOpts, lastVerdict, recorderStats } from "./human.mjs";

const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const D = {
  org_name: "Brindle Lane Allotment Society", registration_no: "CH-448190", address: "14 Brindle Lane", city: "Lower Marrow", postcode: "TV4 9QR",
  contact_name: "Odile Marchetti", contact_email: "odile@brindlelaneallotments.org", contact_phone: "01632 960733",
  project_title: "Raised Beds for Every Plot",
  project_summary: "We will build twenty wheelchair-height raised beds on the Brindle Lane site so that older members and neighbours with limited mobility can keep growing their own food all year.",
  beneficiaries: "140", amount_requested: "7500", budget_breakdown: "5200 on timber and soil, 1500 on accessible paths, 800 on tools and volunteer training.",
};

async function humanRun(page, h, url) {
  await page.goto(url + manifest.path);
  await h.think();
  for (const k of ["org_name"]) await h.fill(page.locator(`[name=${k}]`), D[k]);
  await h.select(page.locator("[name=org_type]"), "Registered");
  for (const k of ["registration_no", "address", "city", "postcode", "contact_name", "contact_email", "contact_phone"]) await h.fill(page.locator(`[name=${k}]`), D[k]);
  await h.think();
  console.log(`  recorder before step 1 submit: ${JSON.stringify(await recorderStats(page))}`);
  await h.click(page.getByRole("button", { name: "Save and continue" }));
  await page.waitForLoadState();
  await page.waitForTimeout(300);
  return page.url();
}
async function humanRun2(page, h) {
  await h.think();
  await h.fill(page.locator("[name=project_title]"), D.project_title);
  await h.click(page.locator('label:has(input[value="Food growing"])'));
  await h.click(page.locator('label:has(input[value="Older people"])'));
  await h.fill(page.locator("[name=project_summary]"), D.project_summary);
  await h.date(page.locator("[name=project_start]"), "2027-03-01");
  await h.fill(page.locator("[name=beneficiaries]"), D.beneficiaries);
  await h.fill(page.locator("[name=amount_requested]"), D.amount_requested);
  await h.fill(page.locator("[name=budget_breakdown]"), D.budget_breakdown);
}

function report(name, site, extra = "") {
  const ev = site.events();
  const ok = ev.filter((e) => e.type === "submit_ok");
  const held = ev.filter((e) => e.type === "held").length;
  const bad = ok[0] ? assertValidate(manifest, ok[0]) : ["no submit_ok"];
  console.log(`[${name}] submit_ok=${ok.length} held=${held} form_view=${ev.filter((e) => e.type === "form_view").length} validate=${bad.length ? "FAIL " + bad.join("; ") : "ok"} ${extra}`);
  return { ok: ok.length, held, bad };
}

const failures = [];
const want = (cond, msg) => { if (!cond) { failures.push(msg); console.log("  FAILED: " + msg); } };

async function offRun() {
  const site = await startSite(SERVER, "off");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.goto(site.url + manifest.path);
  for (const [k, v] of Object.entries(D)) if ((await page.locator(`[name=${k}]`).count()) && !["project_title"].includes(k)) await page.fill(`[name=${k}]`, v);
  await page.selectOption("[name=org_type]", "Registered charity");
  for (const h of await scanWords(page, "off step 1")) want(false, h);
  await page.click("button[type=submit]");
  await page.waitForURL("**/apply/project");
  for (const k of ["project_title", "project_summary", "beneficiaries", "amount_requested", "budget_breakdown"]) await page.fill(`[name=${k}]`, D[k]);
  await page.check('input[value="Food growing"]');
  await page.check('input[value="Older people"]');
  await page.fill("[name=project_start]", "2027-03-01");
  await page.click("button[type=submit]");
  await page.waitForURL("**/apply/complete");
  const ref = await page.locator("#reference").innerText();
  for (const h of await scanWords(page, "off done")) want(false, h);
  const r = report("off", site, `ref=${ref}`);
  want(r.ok === 1 && !r.bad.length && !r.held, "off: exactly one valid submit_ok");
  want(!reqs.some((u) => /whofills|__wf/.test(u)), "off: no whofills requests");
  want((await (await fetch(site.url + "/whofills.js")).status) === 404, "off: /whofills.js is not served");
  await b.close();
  site.stop();
}

async function onHuman(name, hideWd) {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(hideWd));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1280, height: 860 } });
  console.log(`[${name}] navigator.webdriver will be ${!hideWd}`);
  const h = new Human(page);
  const t0 = Date.now();
  const u = await humanRun(page, h, site.url);
  if (!u.endsWith("/apply/project")) {
    want(false, `${name}: stopped at step 1, url ${u}: ${(await page.locator("main").innerText()).slice(0, 200)}`);
    report(name, site);
    await b.close();
    return site.stop();
  }
  await humanRun2(page, h);
  for (const x of await scanWords(page, name + " step 2")) want(false, x);
  await h.click(page.locator('label:has(input[name="wf_attest"])'), 10);
  await h.think();
  console.log(`  recorder before submit: ${JSON.stringify(await recorderStats(page))}`);
  await h.click(page.getByRole("button", { name: "Send application" }));
  await page.waitForLoadState();
  await page.waitForTimeout(400);
  const end = page.url();
  if (!end.endsWith("/apply/complete")) {
    console.log("  stuck at " + end.replace(site.url, ""));
    console.log("  invalid fields: " + JSON.stringify(await page.evaluate(() => [...(document.querySelector("form")?.elements ?? [])].filter((e) => e.willValidate && !e.checkValidity()).map((e) => `${e.name}=${JSON.stringify(e.value)}: ${e.validationMessage}`))));
    console.log("  all values: " + JSON.stringify(await page.evaluate(() => Object.fromEntries(new FormData(document.querySelector("form"))))).slice(0, 700));
    await page.screenshot({ path: fileURLToPath(new URL("./shot-stuck.png", import.meta.url)), fullPage: true });
  }
  const ref = end.endsWith("/apply/complete") ? await page.locator("#reference").innerText() : "(none)";
  const r = report(name, site, `ref=${ref} seconds=${Math.round((Date.now() - t0) / 1000)}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.ok === 1 && !r.bad.length, `${name}: exactly one valid submit_ok`);
  want(r.held === 0, `${name}: human-paced run must not be held`);
  await b.close();
  site.stop();
}

// Scripted fills: expected to be held. Then pass the hold and confirm answers survive the replay.
async function robotRun() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const h = new Human(page);
  await page.goto(site.url + manifest.path);
  for (const k of ["org_name", "registration_no", "address", "city", "postcode", "contact_name", "contact_email", "contact_phone"]) {
    await page.locator(`[name=${k}]`).click();
    await page.fill(`[name=${k}]`, D[k]);
  }
  await page.selectOption("[name=org_type]", "Registered charity");
  await page.click("button[type=submit]");
  await page.waitForLoadState();
  await page.waitForTimeout(300);
  const heldAtStep1 = (await page.locator("#wf-canvas").count()) > 0;
  console.log(`[robot] held at step 1: ${heldAtStep1}`);
  if (heldAtStep1) {
    for (const x of await scanWords(page, "hold page")) want(false, x);
    await page.screenshot({ path: fileURLToPath(new URL("./shot-hold.png", import.meta.url)) });
    // a wrong answer first
    await page.fill('input[name="__wf_answer"]', "00000");
    await page.click('main button[type="submit"]');
    await page.waitForLoadState();
    want((await page.locator("#wf-canvas").count()) > 0, "robot: wrong digits keep the hold page up");
    const code = await solveHold(page, h);
    await page.waitForLoadState();
    console.log(`[robot] passed the hold with ${code}, now at ${page.url()}`);
  }
  want(page.url().endsWith("/apply/project"), "robot: reaches step 2 after the hold, answers kept");
  for (const k of ["project_title", "project_summary", "beneficiaries", "amount_requested", "budget_breakdown"]) await page.fill(`[name=${k}]`, D[k]);
  await page.check('input[value="Food growing"]');
  await page.check('input[value="Older people"]');
  await page.fill("[name=project_start]", "2027-03-01");
  const box = page.locator('input[name="wf_attest"]');
  await box.check();
  await page.click("button[type=submit]");
  await page.waitForLoadState();
  await page.waitForTimeout(300);
  const r = report("robot", site, `url=${page.url().replace(site.url, "")}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.held >= 1, "robot: scripted run is held");
  want(r.ok === 1 && !r.bad.length, "robot: after the hold, exactly one valid submit_ok including both focus areas");
  await b.close();
  site.stop();
}

async function shots() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await page.goto(site.url + manifest.path);
  await page.screenshot({ path: fileURLToPath(new URL("./shot-step1.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: fileURLToPath(new URL("./shot-step1-phone.png", import.meta.url)), fullPage: true });
  await b.close();
  site.stop();
}

const which = process.argv.slice(2);
const on = (k) => !which.length || which.includes(k);
if (on("off")) await offRun();
if (on("robot")) await robotRun();
if (on("human")) await onHuman("human", false);
if (on("human-nowd")) await onHuman("human-nowd", true);
if (which.includes("shots")) await shots();
console.log(failures.length ? `FAILURES (${failures.length}):\n- ${failures.join("\n- ")}` : "ALL CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
