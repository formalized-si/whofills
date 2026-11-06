// Tallowbrook Community Foundation: small grants application, two server-rendered steps.
// Lines tagged [wf] are what integrating whofills added. Lines tagged [wf-toggle] exist only for the WHOFILLS=off/on switch.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { createGuard } from "whofills/server"; // [wf]

const PORT = Number(process.env.PORT ?? 3000);
const LOG = process.env.LOG ?? "/dev/null";
const WHOFILLS = process.env.WHOFILLS === "on"; // [wf-toggle]
const log = (e) => appendFileSync(LOG, JSON.stringify(e) + "\n");
const CONTACT = "grants@tallowbrookfoundation.org";

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
// Workaround: the guard's hold page throws on non-string values, and repeated checkboxes parse to arrays. See INTEGRATION-REPORT.md. // [wf]
app.use((req, _res, next) => { for (const [k, v] of Object.entries(req.body ?? {})) if (Array.isArray(v)) req.body[k] = v.join("; "); next(); }); // [wf]

let guardMiddleware = null; // [wf-toggle]
if (WHOFILLS) { // [wf-toggle]
  const guard = createGuard({ // [wf]
    secret: process.env.WHOFILLS_SECRET ?? randomBytes(32).toString("hex"), // [wf]
    mode: "hold", // [wf]
    fallbackHtml: `Can't see the digits? Email <a href="mailto:${CONTACT}">${CONTACT}</a> or call 01632 960418 and we will finish your application with you.`, // [wf]
  }); // [wf]
  guardMiddleware = guard.express(); // [wf]
  app.use("/whofills.js", express.static(fileURLToPath(import.meta.resolve("whofills/whofills.js")))); // [wf]
  app.use("/__wf/hold.js", express.static(fileURLToPath(import.meta.resolve("whofills/hold.js")))); // [wf]
} // [wf-toggle]
const NOTICE = "Tallowbrook grant applications must be entered by a person from the applying organisation. Answers entered by an AI agent or automated tool are not accepted."; // [wf]
const wfScript = (attest) => WHOFILLS ? `<script src="/whofills.js" defer data-protect="form.grant-step" data-notice="${NOTICE}"${attest ? ' data-attest="visible"' : ""}></script>` : ""; // [wf]

// The guard has no onHold hook: it answers the request itself and simply never calls next(). Also, it strips wf_attest, so read it first. // [wf]
function protect(req, res, next) { // [wf]
  if (!guardMiddleware || req.session.personPassed) return next(); // [wf] do not make a person solve the digits twice in one application
  if (req.body.wf_attest === "1") req.session.attested = true; // [wf]
  let held = true; // [wf]
  guardMiddleware(req, res, (err) => { // [wf]
    held = false; // [wf]
    if (req.whofills?.passed) req.session.personPassed = true; // [wf]
    console.error(`whofills ${req.path} verdict=${JSON.stringify(req.whofills?.verdict)} passed=${req.whofills?.passed} attested=${!!req.session.attested}`); // [wf]
    next(err); // [wf]
  }); // [wf]
  if (held) log({ type: "held" }); // [wf]
} // [wf]

// Sessions: in memory, cookie holds an opaque id.
const sessions = new Map();
app.use((req, res, next) => {
  const sid = /(?:^|;\s*)tcf_sid=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
  let s = sid && sessions.get(sid);
  if (!s) {
    const id = randomBytes(18).toString("base64url");
    s = { csrf: randomBytes(18).toString("base64url"), step1: null, step2: null };
    sessions.set(id, s);
    res.setHeader("Set-Cookie", `tcf_sid=${id}; HttpOnly; SameSite=Lax; Path=/`);
  }
  req.session = s;
  next();
});
const csrf = (req, res, next) => (req.body._csrf === req.session.csrf ? next() : res.status(403).type("html").send(shell("Session expired", 0, `<h1>Your session has expired</h1><p><a href="/apply">Start your application again</a>.</p>`)));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
:root{--rail:#0f3d44;--rail-ink:#d7ece8;--brook:#6fc3bd;--page:#f2f6f5;--ink:#1c2b2e;--muted:#566a6d;--line:#b9c9c8;--sun:#e7a71c;--err:#a4261d}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:17px/1.55 "Gill Sans","Gill Sans MT","Trebuchet MS",Calibri,sans-serif}
.frame{display:grid;grid-template-columns:300px 1fr;min-height:100vh}
.rail{background:var(--rail);color:var(--rail-ink);padding:36px 30px;position:relative}
.org{font:600 24px/1.2 "Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;color:#fff;margin:0 0 6px}
.round{margin:0 0 40px;font-size:15px}
.brook{position:relative;list-style:none;margin:0;padding:0}
.brook svg{position:absolute;left:0;top:10px;width:30px;height:calc(100% - 20px)}
.brook li{position:relative;padding:0 0 74px 44px;font-size:16px;color:#a9cfca}
.brook li:last-child{padding-bottom:0}
.brook li::before{content:"";position:absolute;left:7px;top:5px;width:16px;height:16px;border-radius:50%;background:var(--rail);border:2px solid var(--brook)}
.brook li.now{color:#fff;font-weight:600}.brook li.now::before{background:var(--sun);border-color:var(--sun)}
.brook li.done::before{background:var(--brook)}
.help{margin-top:56px;font-size:14px;color:#a9cfca}.help a{color:#fff}
main{padding:44px clamp(16px,6vw,84px) 72px;max-width:860px}
h1{font:600 34px/1.15 "Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;margin:0 0 10px}
.lede{margin:0 0 30px;max-width:60ch;color:var(--muted)}
fieldset{border:0;padding:0;margin:0 0 30px}
legend{font:600 21px/1.3 "Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;padding:0;margin-bottom:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
.f{margin:0 0 18px}.f label,.lab{display:block;font-weight:600;font-size:15.5px;margin-bottom:5px}
.hint{display:block;font-weight:400;color:var(--muted);font-size:14px;margin-bottom:5px}
input[type=text],input[type=email],input[type=tel],input[type=number],input[type=date],select,textarea{width:100%;padding:10px 12px;font:inherit;background:#fff;color:inherit;border:1.5px solid var(--line);border-radius:7px}
input[type=text],input[type=email],input[type=tel],input[type=number],input[type=date],select{height:48px}
textarea{min-height:120px;resize:vertical}
:focus-visible{outline:3px solid var(--sun);outline-offset:1px}
.checks{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px}
.checks label{display:flex;gap:9px;align-items:flex-start;font-weight:400}.checks input{margin-top:6px}
.err{color:var(--err);font-size:14.5px;display:block;margin-top:4px}
.errbox{border-left:5px solid var(--err);background:#fff;padding:12px 16px;margin:0 0 24px}
.actions{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:8px}
button{background:var(--rail);color:#fff;border:0;border-radius:7px;padding:13px 26px;font:600 17px "Gill Sans","Gill Sans MT","Trebuchet MS",Calibri,sans-serif;cursor:pointer}
button:hover{background:#17555e}
.ref{display:inline-block;font:600 28px/1.2 "Iowan Old Style",Palatino,Georgia,serif;background:#fff;border:2px solid var(--brook);border-radius:7px;padding:12px 20px;margin:10px 0 18px}
@media(max-width:820px){.frame{grid-template-columns:1fr}.rail{padding:22px 16px}.round{margin-bottom:14px}.brook{display:flex;gap:14px}.brook svg,.help{display:none}.brook li{padding:0 0 0 24px;font-size:14px}.brook li::before{left:0}.row,.checks{grid-template-columns:1fr}main{padding:26px 16px 56px}}
@media(prefers-reduced-motion:no-preference){.brook li.now::before{transition:background .2s}}
`;

function shell(title, step, body, tail = "") {
  const stages = ["Your organisation", "Your project", "Your reference"];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Tallowbrook Community Foundation</title><style>${CSS}</style></head>
<body><div class="frame"><aside class="rail"><p class="org">Tallowbrook Community Foundation</p><p class="round">Small grants, spring 2027 round</p>
<ol class="brook"><svg viewBox="0 0 30 200" preserveAspectRatio="none" aria-hidden="true"><path d="M15 0C4 30 26 60 15 100S4 170 15 200" fill="none" stroke="#6fc3bd" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
${stages.map((s, i) => `<li class="${i + 1 === step ? "now" : i + 1 < step ? "done" : ""}"${i + 1 === step ? ' aria-current="step"' : ""}>${s}</li>`).join("")}</ol>
<p class="help">Stuck? Write to <a href="mailto:${CONTACT}">${CONTACT}</a> or call 01632 960418, weekdays 9 to 4.</p></aside>
<main>${body}</main></div>${tail}</body></html>`;
}

const field = (name, label, val, errs, { type = "text", hint = "", attrs = "" } = {}) => `<div class="f"><label for="${name}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ""}
<input id="${name}" name="${name}" type="${type}" value="${esc(val[name])}" ${attrs}>${errs[name] ? `<span class="err" role="alert">${esc(errs[name])}</span>` : ""}</div>`;

const ORG_TYPES = ["Registered charity", "Community interest company", "Unincorporated community group", "Parish or town council", "School or nursery"];
const FOCUS = ["Food growing", "Nature and rivers", "Arts and heritage", "Older people", "Young people", "Skills and jobs"];

function step1Page(req, val = req.session.step1 ?? {}, errs = {}) {
  const errBox = Object.keys(errs).length ? `<div class="errbox" role="alert">Fix the highlighted answers to continue.</div>` : "";
  return shell("Your organisation", 1, `<h1>Tell us about your organisation</h1>
<p class="lede">Grants of &pound;500 to &pound;15,000 for groups working in the Tallow valley. Page one of two, then you receive a reference.</p>${errBox}
<form class="grant-step" method="post" action="/apply/organisation"><input type="hidden" name="_csrf" value="${req.session.csrf}">
<fieldset><legend>Organisation</legend>
${field("org_name", "Organisation name", val, errs, { attrs: "required" })}
<div class="row"><div class="f"><label for="org_type">Type of organisation</label><select id="org_type" name="org_type" required><option value="">Choose one</option>${ORG_TYPES.map((o) => `<option${val.org_type === o ? " selected" : ""}>${o}</option>`).join("")}</select>${errs.org_type ? `<span class="err" role="alert">${esc(errs.org_type)}</span>` : ""}</div>
${field("registration_no", "Registration number", val, errs, { hint: "", attrs: 'required pattern="[A-Za-z0-9\\-]{5,14}" title="Letters, digits and hyphens, 5 to 14 characters"' })}</div>
${field("address", "Street address", val, errs, { attrs: "required" })}
<div class="row">${field("city", "Town or village", val, errs, { attrs: "required" })}${field("postcode", "Postcode", val, errs, { attrs: "required" })}</div></fieldset>
<fieldset><legend>Main contact</legend>
${field("contact_name", "Full name", val, errs, { attrs: 'required autocomplete="name"' })}
<div class="row">${field("contact_email", "Email", val, errs, { type: "email", attrs: 'required autocomplete="email"' })}${field("contact_phone", "Phone", val, errs, { type: "tel", attrs: 'required autocomplete="tel"' })}</div></fieldset>
<div class="actions"><button type="submit">Save and continue</button></div></form>`, wfScript(false)); // [wf] (argument)
}

function step2Page(req, val = req.session.step2 ?? {}, errs = {}) {
  const chosen = String(val.focus_areas ?? "").split("; ");
  const errBox = Object.keys(errs).length ? `<div class="errbox" role="alert">Fix the highlighted answers to send your application.</div>` : "";
  return shell("Your project", 2, `<h1>Tell us about your project</h1>
<p class="lede">Our panel reads every application and replies within eight weeks.</p>${errBox}
<form class="grant-step" method="post" action="/apply/project"><input type="hidden" name="_csrf" value="${req.session.csrf}">
<fieldset><legend>The project</legend>
${field("project_title", "Project title", val, errs, { attrs: 'required maxlength="90"' })}
<div class="f"><span class="lab" id="focus-lab">Which areas does it fall under?</span><span class="hint">Pick all that apply.</span><div class="checks" role="group" aria-labelledby="focus-lab">${FOCUS.map((o) => `<label><input type="checkbox" name="focus_areas" value="${o}"${chosen.includes(o) ? " checked" : ""}> ${o}</label>`).join("")}</div>${errs.focus_areas ? `<span class="err" role="alert">${esc(errs.focus_areas)}</span>` : ""}</div>
<div class="f"><label for="project_summary">What will you do, and who will benefit?</label><span class="hint">At least 80 characters.</span><textarea id="project_summary" name="project_summary" required minlength="80" maxlength="1500">${esc(val.project_summary)}</textarea>${errs.project_summary ? `<span class="err" role="alert">${esc(errs.project_summary)}</span>` : ""}</div>
<div class="row">${field("project_start", "Start date", val, errs, { type: "date", attrs: 'required min="2027-01-01" max="2028-12-31"' })}${field("beneficiaries", "People who will benefit", val, errs, { type: "number", attrs: 'required min="1" max="100000"' })}</div></fieldset>
<fieldset><legend>The money</legend>
${field("amount_requested", "Amount requested, in pounds", val, errs, { type: "number", hint: "Between 500 and 15000.", attrs: 'required min="500" max="15000" step="1"' })}
<div class="f"><label for="budget_breakdown">How will you spend it?</label><span class="hint">A line or two is enough.</span><textarea id="budget_breakdown" name="budget_breakdown" required minlength="20" maxlength="800" style="min-height:80px">${esc(val.budget_breakdown)}</textarea>${errs.budget_breakdown ? `<span class="err" role="alert">${esc(errs.budget_breakdown)}</span>` : ""}</div></fieldset>
<div class="actions"><button type="submit">Send application</button><a href="/apply">Back to your organisation</a></div></form>`, wfScript(true)); // [wf] (argument)
}

const STEP1 = ["org_name", "org_type", "registration_no", "address", "city", "postcode", "contact_name", "contact_email", "contact_phone"];
const STEP2 = ["project_title", "focus_areas", "project_summary", "project_start", "beneficiaries", "amount_requested", "budget_breakdown"];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, String(body[k] ?? "").trim()]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate1(v) {
  const e = {};
  for (const k of STEP1) if (!v[k]) e[k] = "Enter this answer.";
  if (v.org_type && !ORG_TYPES.includes(v.org_type)) e.org_type = "Choose one of the listed types.";
  if (v.registration_no && !/^[A-Za-z0-9-]{5,14}$/.test(v.registration_no)) e.registration_no = "Use letters, digits and hyphens, 5 to 14 characters.";
  if (v.contact_email && !EMAIL.test(v.contact_email)) e.contact_email = "Enter an email address like name@yourgroup.org.";
  if (v.contact_phone && !/^[+\d()\s-]{7,20}$/.test(v.contact_phone)) e.contact_phone = "Enter a phone number with at least 7 digits.";
  return e;
}
function validate2(v) {
  const e = {};
  for (const k of STEP2) if (!v[k]) e[k] = "Enter this answer.";
  if (!v.focus_areas) e.focus_areas = "Pick at least one area.";
  if (v.project_summary && v.project_summary.length < 80) e.project_summary = "Write at least 80 characters.";
  if (v.budget_breakdown && v.budget_breakdown.length < 20) e.budget_breakdown = "Write at least 20 characters.";
  const amount = Number(v.amount_requested);
  if (v.amount_requested && !(Number.isInteger(amount) && amount >= 500 && amount <= 15000)) e.amount_requested = "Enter a whole number between 500 and 15000.";
  if (v.beneficiaries && !(Number(v.beneficiaries) >= 1)) e.beneficiaries = "Enter how many people will benefit.";
  if (v.project_start && !(/^\d{4}-\d{2}-\d{2}$/.test(v.project_start) && v.project_start >= "2027-01-01" && v.project_start <= "2028-12-31")) e.project_start = "Choose a start date in 2027 or 2028.";
  return e;
}

app.get("/", (_req, res) => res.redirect("/apply"));
app.get("/apply", (req, res) => {
  log({ type: "form_view" });
  res.type("html").send(step1Page(req));
});
app.post("/apply/organisation", protect, csrf, (req, res) => { // [wf] (argument; before csrf, so a held POST never consumes anything)
  const v = pick(req.body, STEP1);
  const errs = validate1(v);
  if (Object.keys(errs).length) return res.status(422).type("html").send(step1Page(req, v, errs));
  req.session.step1 = v;
  res.redirect(303, "/apply/project");
});
app.get("/apply/project", (req, res) => {
  if (!req.session.step1) return res.redirect("/apply");
  log({ type: "form_view" });
  res.type("html").send(step2Page(req));
});
app.post("/apply/project", protect, csrf, (req, res) => { // [wf] (argument; before csrf, so a held POST never consumes anything)
  if (!req.session.step1) return res.redirect(303, "/apply");
  const v = pick(req.body, STEP2);
  const errs = validate2(v);
  if (Object.keys(errs).length) return res.status(422).type("html").send(step2Page(req, v, errs));
  req.session.step2 = v;
  req.session.reference = `TCF-27-${String(10000 + randomBytes(3).readUIntBE(0, 3) % 90000)}`;
  log({ type: "submit_ok", fields: { ...req.session.step1, ...v } });
  res.redirect(303, "/apply/complete");
});
app.get("/apply/complete", (req, res) => {
  if (!req.session.reference) return res.redirect("/apply");
  res.type("html").send(shell("Application received", 3, `<h1>We have your application</h1>
<p class="lede">Keep this reference and quote it if you contact us. We will reply to ${esc(req.session.step1.contact_email)} within eight weeks.</p>
<div class="ref" id="reference">${esc(req.session.reference)}</div>`));
});

app.listen(PORT, "127.0.0.1", () => console.log("ready"));
