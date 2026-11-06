// node bench/heldout/scholarship/verify.mjs [off|human|human-nowd|robot|shots]...   (default: off robot human human-nowd)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Human, startSite, solveHold, scanWords, assertValidate, launchOpts, recorderStats } from "./human.mjs";

const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const shot = (n) => fileURLToPath(new URL(`./${n}.png`, import.meta.url));
const T = {
  first_name: "Tamsin", last_name: "Okonkwo-Reyes", email: "tamsin.reyes@larkmail.net", street: "62 Saltmarsh Terrace", city: "Port Ellery", postal_code: "PE3 7LD", phone: "0118 496 0271",
  institution: "Wrenfield Technical College", programme: "Marine Electrical Engineering", gpa: "3.6", dependents: "3",
  referee_name: "Desmond Achterberg", referee_email: "d.achterberg@wrenfieldtech.ac", referee_relationship: "My workshop instructor at Wrenfield for two years",
  personal_statement: "I grew up watching my mother repair engines on the Port Ellery ferries, and I want to carry that work into cleaner vessels. This diploma will teach me the marine electrical systems that new hybrid boats depend on. Afterwards I plan to return to the harbour and train younger apprentices.",
  signature: "Tamsin Okonkwo-Reyes",
};
const S = { level: ["Diploma", "Dip"], start_term: ["Autumn 2027", "Autumn"], income_band: ["20,000 to 39,999", "20"] };
const CERT = (mode) => (mode === "on" ? 'input[name="wf_attest"]' : 'input[name="certify"]');

const failures = [];
const want = (cond, msg) => { if (!cond) { failures.push(msg); console.log("  FAILED: " + msg); } };
function report(name, site, extra = "") {
  const ev = site.events();
  const ok = ev.filter((e) => e.type === "submit_ok");
  const held = ev.filter((e) => e.type === "held").length;
  const bad = ok[0] ? assertValidate(manifest, ok[0]) : ["no submit_ok"];
  console.log(`[${name}] submit_ok=${ok.length} held=${held} form_view=${ev.filter((e) => e.type === "form_view").length} validate=${bad.length ? "FAIL " + bad.join("; ") : "ok"} ${extra}`);
  return { ok: ok.length, held, bad, fields: ok[0]?.fields };
}

async function fast(page, mode) {
  for (const [k, v] of Object.entries(T)) await page.fill(`[name=${k}]`, v);
  await page.fill("[name=date_of_birth]", "2004-06-09");
  await page.fill("[name=date_signed]", "2027-01-14");
  for (const [k, [v]] of Object.entries(S)) await page.selectOption(`[name=${k}]`, v);
  await page.check('input[name=other_funding][value="No"]');
  await page.check('input[value="First in family to attend"]');
  await page.check('input[value="Carer for a relative"]');
  await page.check(CERT(mode));
}

async function offRun() {
  const site = await startSite(SERVER, "off");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.goto(site.url + manifest.path);
  for (const h of await scanWords(page, "off")) want(false, h);
  want(!/no AI agent|wf_attest/.test(await page.content()), "off: no attestation in the page");
  await fast(page, "off");
  await page.click("button[type=submit]");
  await page.waitForSelector("#reference");
  const ref = await page.locator("#reference").innerText();
  for (const h of await scanWords(page, "off done")) want(false, h);
  const r = report("off", site, `ref=${ref}`);
  want(r.ok === 1 && !r.bad.length && !r.held, "off: exactly one valid submit_ok");
  want(r.fields?.circumstances?.includes("First in family") && r.fields?.circumstances?.includes("Carer"), "off: both circumstances kept");
  want(!reqs.some((u) => /whofills|__wf/.test(u)), "off: no whofills requests");
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
  const f = (k) => page.locator(`[name=${k}]`);
  await page.goto(site.url + manifest.path);
  await h.think();
  await h.fill(f("first_name"), T.first_name);
  await h.fill(f("last_name"), T.last_name);
  await h.date(f("date_of_birth"), "2004-06-09", 4);
  for (const k of ["email", "street", "city", "postal_code", "phone", "institution"]) await h.fill(f(k), T[k]);
  await h.select(f("level"), S.level[1]);
  await h.fill(f("programme"), T.programme);
  await h.fill(f("gpa"), T.gpa);
  await h.select(f("start_term"), S.start_term[1]);
  await h.select(f("income_band"), S.income_band[1]);
  await h.fill(f("dependents"), T.dependents);
  await h.click(page.locator('label:has(input[name=other_funding][value="No"])'));
  await h.click(page.locator('label:has(input[value="First in family to attend"])'));
  await h.click(page.locator('label:has(input[value="Carer for a relative"])'));
  for (const k of ["referee_name", "referee_email", "referee_relationship", "personal_statement"]) await h.fill(f(k), T[k]);
  for (const x of await scanWords(page, name)) want(false, x);
  await h.click(page.locator(`label:has(${CERT("on")})`), 8);
  await h.fill(f("signature"), T.signature);
  await h.date(f("date_signed"), "2027-01-14", 4);
  await h.think();
  await page.screenshot({ path: shot("shot-filled"), fullPage: true });
  console.log(`  recorder before submit: ${JSON.stringify(await recorderStats(page))}`);
  await h.click(page.getByRole("button", { name: "Send application to the Trust" }));
  await page.waitForLoadState();
  await page.waitForTimeout(400);
  const ref = await page.locator("#reference").innerText({ timeout: 2000 }).catch(() => "(none)");
  if (ref === "(none)") console.log("  landed on: " + (await page.locator("body").innerText()).slice(0, 300));
  const r = report(name, site, `ref=${ref} seconds=${Math.round((Date.now() - t0) / 1000)}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.ok === 1 && !r.bad.length, `${name}: exactly one valid submit_ok`);
  want(r.held === 0, `${name}: human-paced run must not be held`);
  await b.close();
  site.stop();
}

async function robotRun() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US" });
  const h = new Human(page);
  await page.goto(site.url + manifest.path);
  for (const k of ["first_name", "last_name", "email"]) await page.click(`[name=${k}]`);
  await fast(page, "on");
  await page.click("button[type=submit]");
  await page.waitForSelector("#wf-canvas");
  console.log("[robot] held");
  for (const x of await scanWords(page, "hold page")) want(false, x);
  await page.screenshot({ path: shot("shot-hold") });
  const code = await solveHold(page, h);
  await page.waitForSelector("#reference");
  const ref = await page.locator("#reference").innerText();
  const r = report("robot", site, `ref=${ref} digits=${code}`);
  console.log(`  ${site.stderr().trim().split("\n").join("\n  ")}`);
  want(r.held === 1, "robot: scripted run is held exactly once");
  want(r.ok === 1 && !r.bad.length, "robot: after the hold, exactly one valid submit_ok");
  want(r.fields?.circumstances?.includes("First in family") && r.fields?.circumstances?.includes("Carer"), "robot: both circumstances survive the replay");
  await b.close();
  site.stop();
}

async function shots() {
  const site = await startSite(SERVER, "on");
  const b = await chromium.launch(launchOpts(false));
  const page = await b.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await page.goto(site.url + manifest.path);
  await page.screenshot({ path: shot("shot-form"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: shot("shot-form-phone"), fullPage: true });
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
