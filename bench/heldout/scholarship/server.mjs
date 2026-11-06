// The Halloran-Pike Scholarship Trust: one long static form, plain node:http, urlencoded POST.
// Lines tagged [wf] are what integrating whofills added. Lines tagged [wf-toggle] exist only for the WHOFILLS=off/on switch.
// On a real site, the three .replace() calls below would be direct edits to apply.html.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createGuard, stripGuardFields } from "whofills/server"; // [wf]

const PORT = Number(process.env.PORT ?? 3000);
const LOG = process.env.LOG ?? "/dev/null";
const WHOFILLS = process.env.WHOFILLS === "on"; // [wf-toggle]
const log = (e) => appendFileSync(LOG, JSON.stringify(e) + "\n");
const pub = (f) => new URL(`./public/${f}`, import.meta.url);

let FORM = readFileSync(pub("apply.html"), "utf8");
const CSS = readFileSync(pub("form.css"));
let guard = null; // [wf-toggle]
let clientJs = null, holdJs = null; // [wf-toggle]
if (WHOFILLS) { // [wf-toggle]
  guard = createGuard({ // [wf]
    secret: process.env.WHOFILLS_SECRET ?? randomBytes(32).toString("hex"), // [wf]
    mode: "hold", // [wf]
    fallbackHtml: `Can't see the digits? Email <a href="mailto:awards@halloranpiketrust.org">awards@halloranpiketrust.org</a> and the awards office will complete this step with you.`, // [wf]
  }); // [wf]
  clientJs = readFileSync(fileURLToPath(import.meta.resolve("whofills/whofills.js"))); // [wf]
  holdJs = readFileSync(fileURLToPath(import.meta.resolve("whofills/hold.js"))); // [wf]
  FORM = FORM.replace("<!--whofills:script-->", `<script src="/whofills.js" defer data-protect="form.scholarship-form" data-notice="Applications to the Trust must be entered by the applicant in person. Answers entered by an AI agent or automated tool are not accepted."></script>`) // [wf]
    .replace('name="certify" value="yes"', 'name="wf_attest" value="1"') // [wf] the docs' field name, on the form's existing certification checkbox
    .replace("<!--whofills:clause-->", " I filled in this form myself, and no AI agent or automated tool entered these answers on my behalf. Assistive technology is fine."); // [wf]
} // [wf-toggle]

const REQUIRED = ["first_name", "last_name", "date_of_birth", "email", "street", "city", "postal_code", "phone", "institution", "level", "programme", "gpa", "start_term", "income_band", "dependents", "other_funding", "referee_name", "referee_email", "referee_relationship", "personal_statement", "signature", "date_signed"];
const LABELS = { first_name: "Given name", last_name: "Family name", date_of_birth: "Date of birth", email: "Email address", street: "Street address", city: "Town or city", postal_code: "Postal code", phone: "Telephone", institution: "School or college", level: "Level of study", programme: "Programme or trade", gpa: "Grade average", start_term: "First term", income_band: "Household income", dependents: "People who depend on this income", other_funding: "Other funding", referee_name: "Referee's name", referee_email: "Referee's email", referee_relationship: "How the referee knows you", personal_statement: "Personal statement", signature: "Signature", date_signed: "Date" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(f) {
  const e = [];
  for (const k of REQUIRED) if (!f[k]?.trim()) e.push(`${LABELS[k]} is missing.`);
  if (f.email && !EMAIL.test(f.email)) e.push("Enter a valid email address in section 1.");
  if (f.referee_email && !EMAIL.test(f.referee_email)) e.push("Enter a valid email address for your referee.");
  if (f.date_of_birth && !(DATE.test(f.date_of_birth) && f.date_of_birth >= "1960-01-01" && f.date_of_birth <= "2011-12-31")) e.push("Check your date of birth.");
  if (f.gpa && !(/^[0-4](\.\d{1,2})?$/.test(f.gpa) && Number(f.gpa) <= 4)) e.push("Enter your grade average on a 4.0 scale, like 3.4.");
  if (f.dependents && !(Number(f.dependents) >= 1)) e.push("Enter how many people depend on this income, including you.");
  if (f.other_funding === "Yes" && !f.other_funding_details?.trim()) e.push("Say who is funding you and how much.");
  if (f.personal_statement && f.personal_statement.trim().split(/\s+/).length < 40) e.push("Write at least 40 words in your personal statement.");
  if (f.signature && f.first_name && f.last_name && !f.signature.toLowerCase().includes(f.last_name.trim().toLowerCase())) e.push("Sign with your own full name in section 6.");
  // Our existing rule: no certification, no application. The checkbox has moved to the guard's field name when protected.
  const certified = WHOFILLS ? f.wf_attest === "1" : f.certify === "yes"; // [wf]
  if (!certified) e.push("Tick the certification in section 6.");
  return e;
}

const readBody = (req) => new Promise((ok, no) => {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 500_000) { no(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  req.on("error", no);
});
// Repeated names (the circumstances checkboxes) become one "a; b" string. Object.fromEntries would keep the last one only, and the guard's hold page needs strings.
function parseForm(raw) {
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = k in out ? `${out[k]}; ${v}` : v;
  return out;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | The Halloran-Pike Scholarship Trust</title><link rel="stylesheet" href="/form.css"></head>
<body><div class="sheet"><header class="masthead"><div><p class="trust">The Halloran-Pike Scholarship Trust</p><h1>${title}</h1></div><p class="formno">Form<br><strong>HP-2</strong></p></header>${body}<footer class="colophon">The Halloran-Pike Scholarship Trust, 9 Candlewick Row, Port Ellery. awards@halloranpiketrust.org</footer></div></body></html>`;
const send = (res, status, type, body, headers = {}) => { res.writeHead(status, { "content-type": type, ...headers }); res.end(body); };
const html = (res, status, body) => send(res, status, "text/html; charset=utf-8", body);

async function apply(req, res) {
  const raw = parseForm(await readBody(req));
  if (WHOFILLS) { // [wf-toggle]
    const d = guard.check("/apply", raw); // [wf]
    if (d.action === "hold") { log({ type: "held" }); return html(res, 200, d.html); } // [wf]
    console.error(`whofills verdict=${JSON.stringify(d.verdict)} passed=${!!d.passed} attested=${raw.wf_attest === "1"}`); // [wf]
  } // [wf-toggle]
  const errors = validate(raw);
  if (errors.length) {
    return html(res, 422, page("Your application needs correcting", `<p>We have not accepted your application yet. Go back and fix these answers. What you typed is still in the form.</p><ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul><p><a href="/apply" onclick="history.back();return false">Back to the form</a></p>`));
  }
  const fields = WHOFILLS ? stripGuardFields(raw) : raw; // [wf]
  delete fields.certify;
  const number = `HP2-2027-${String(100000 + randomBytes(4).readUInt32BE(0) % 900000)}`;
  log({ type: "submit_ok", fields });
  return html(res, 200, page("Application received", `<p>Thank you, ${esc(fields.first_name)}. The Trust has your application. Quote this application number if you write to us.</p><p class="number" id="reference">${number}</p><p>We will write to ${esc(fields.email)} after the awards panel meets in April 2027.</p>`));
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && pathname === "/") return send(res, 302, "text/plain", "", { location: "/apply" });
    if (req.method === "GET" && pathname === "/apply") { log({ type: "form_view" }); return html(res, 200, FORM); }
    if (req.method === "GET" && pathname === "/form.css") return send(res, 200, "text/css", CSS);
    if (WHOFILLS && req.method === "GET" && pathname === "/whofills.js") return send(res, 200, "text/javascript", clientJs); // [wf]
    if (WHOFILLS && req.method === "GET" && pathname === "/__wf/hold.js") return send(res, 200, "text/javascript", holdJs); // [wf]
    if (req.method === "POST" && pathname === "/apply") return await apply(req, res);
    send(res, 404, "text/plain", "Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, "text/plain", "Something went wrong on our side. Your application was not saved. Go back and send it again.");
  }
}).listen(PORT, "127.0.0.1", () => console.log("ready"));
