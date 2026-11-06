// Quillmark Panel survey: React SPA, plain node:http, JSON API.
// Lines tagged [wf] are what integrating whofills added. Lines tagged [wf-toggle] exist only for the WHOFILLS=off/on switch.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { createGuard, stripGuardFields } from "whofills/server"; // [wf]

const PORT = Number(process.env.PORT ?? 3000);
const LOG = process.env.LOG ?? "/dev/null";
const WHOFILLS = process.env.WHOFILLS === "on"; // [wf-toggle]
const log = (e) => appendFileSync(LOG, JSON.stringify(e) + "\n");

const guard = createGuard({ // [wf]
  secret: process.env.WHOFILLS_SECRET ?? randomBytes(32).toString("hex"), // [wf]
  mode: WHOFILLS ? "hold" : "tag", // [wf]
  fallbackHtml: `Can't see the digits? Write to <a href="mailto:help@quillmarkpanel.com">help@quillmarkpanel.com</a> with your member number and we will send you a link to finish by phone.`, // [wf]
}); // [wf]
const clientJs = WHOFILLS ? readFileSync(fileURLToPath(import.meta.resolve("whofills/whofills.js"))) : null; // [wf]
const holdJs = WHOFILLS ? readFileSync(fileURLToPath(import.meta.resolve("whofills/hold.js"))) : null; // [wf]
const WF_TAG = WHOFILLS ? `<script src="/whofills.js" defer data-protect="form.survey-form" data-notice="Quillmark surveys must be answered by the panel member in person. Answers entered by an AI agent or automated tool are not accepted."></script>` : ""; // [wf]

const built = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("./src/app.jsx", import.meta.url))],
  bundle: true, write: false, minify: true, format: "iife", jsx: "automatic", target: "es2020", loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"', __WHOFILLS__: WHOFILLS ? "true" : "false" },
});
const appJs = built.outputFiles[0].contents;

const CSS = `
:root{--cobalt:#1a35c9;--deep:#111e73;--butter:#ffdf6b;--sky:#e6ebff;--ink:#121733;--soft:#58607f;--edge:#c3ccf2;--err:#b81f3a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--sky);color:var(--ink);font:17px/1.5 "Avenir Next",Avenir,"Trebuchet MS","Segoe UI",sans-serif}
.topbar{background:var(--cobalt);color:#fff;padding:14px 16px}.topbar div{max-width:760px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand{font-weight:700;font-size:20px;letter-spacing:-.01em}.pts{background:var(--butter);color:var(--deep);font-weight:700;font-size:15px;padding:4px 12px;border-radius:999px;white-space:nowrap}
.wrap{max-width:760px;margin:0 auto;padding:26px 16px 56px}
.head h1{font-size:38px;line-height:1.1;letter-spacing:-.02em;margin:0 0 6px;color:var(--deep)}.head p{margin:0 0 22px;color:var(--soft)}
.progress{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0;margin:0 0 18px;font-size:14px;color:var(--soft)}
.progress li{border-top:7px solid var(--edge);padding-top:6px}.progress li.past{border-color:var(--cobalt)}.progress li.now{border-color:var(--butter);color:var(--ink);font-weight:700}
.card{background:#fff;border:2px solid var(--deep);border-radius:14px;padding:26px clamp(16px,4vw,32px);box-shadow:6px 6px 0 var(--deep)}
.done{text-align:left}.done h1{font-size:30px;margin:0 0 8px;color:var(--deep)}.code{font-size:32px;font-weight:700;color:var(--cobalt);margin:0}
.q{border:0;padding:0;margin:0 0 28px;min-width:0}.q legend,.qlab{display:block;font-weight:700;font-size:18px;line-height:1.3;padding:0;margin-bottom:10px}
.hint{margin:-4px 0 10px;color:var(--soft);font-size:15px}
input[type=text],input[type=number],select,textarea{width:100%;padding:11px 13px;font:inherit;border:2px solid var(--edge);border-radius:10px;background:#fff;color:inherit;height:50px}
textarea{height:auto;resize:vertical}.short{max-width:160px}
:focus-visible{outline:3px solid var(--cobalt);outline-offset:2px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.tile{display:flex;gap:10px;align-items:center;border:2px solid var(--edge);border-radius:10px;padding:10px 13px;cursor:pointer;font-size:16px}
.tile:hover{border-color:var(--cobalt)}.tile.on{border-color:var(--cobalt);background:var(--sky);font-weight:600}.tile input{accent-color:var(--cobalt);margin:0;flex:none;width:18px;height:18px}
.grid-scroll{overflow-x:auto}.grid{border-collapse:collapse;width:100%;min-width:520px;font-size:15px}.grid th{font-weight:600;padding:8px 6px;text-align:center}.grid tbody th{text-align:left}
.grid tbody tr{border-top:1px solid var(--edge)}.cell{display:flex;justify-content:center;padding:10px 0;cursor:pointer}.cell input{width:20px;height:20px;accent-color:var(--cobalt);margin:0}
.scale{display:grid;grid-template-columns:repeat(11,1fr);gap:4px}.dot{position:relative;display:block;text-align:center;border:2px solid var(--edge);border-radius:10px;padding:10px 0;font-weight:700;cursor:pointer}
.dot input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;width:100%;height:100%}.dot.on{background:var(--butter);border-color:var(--deep)}.dot:focus-within{outline:3px solid var(--cobalt);outline-offset:2px}
.ends{display:flex;justify-content:space-between;font-size:14px;color:var(--soft);margin-top:6px}
.err{color:var(--err);margin:8px 0 0;font-size:15px;font-weight:600}
.pledge label{display:flex;gap:10px;align-items:flex-start;background:var(--sky);border-radius:10px;padding:12px 14px;font-size:15.5px;cursor:pointer}.pledge input{margin-top:4px;width:18px;height:18px;flex:none;accent-color:var(--cobalt)}
.nav{display:flex;justify-content:flex-end;gap:12px;margin-top:8px}
button{font:700 17px "Avenir Next",Avenir,"Trebuchet MS","Segoe UI",sans-serif;border-radius:10px;padding:13px 28px;cursor:pointer;border:2px solid var(--deep)}
.go{background:var(--butter);color:var(--deep);box-shadow:3px 3px 0 var(--deep)}.go:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--deep)}.go[disabled]{opacity:.6}.ghost{background:#fff;color:var(--deep)}
.foot{margin-top:26px;font-size:14px;color:var(--soft)}
@media(max-width:560px){.head h1{font-size:30px}.scale{grid-template-columns:repeat(6,1fr)}}
`;

const shell = (body, tail = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grocery habits survey | Quillmark Panel</title><style>${CSS}</style>${tail}</head>
<body><div class="topbar"><div><span class="brand">Quillmark Panel</span><span class="pts">120 points</span></div></div>${body}</body></html>`;

const SHELL = shell(`<div id="root"><noscript><div class="wrap">This survey needs JavaScript. Write to help@quillmarkpanel.com if you can't turn it on.</div></noscript></div><script src="/app.js" defer></script>`, WF_TAG);

const REQUIRED = ["panel_id", "age_band", "region", "household_size", "main_store", "weekly_spend", "delivery_apps", "rate_price", "rate_freshness", "rate_speed", "rate_packaging", "recommend_score", "last_order", "future_surveys"];
function validate(f) {
  const e = {};
  for (const k of REQUIRED) if (!f[k]) e[k] = "Answer this question.";
  if (f.panel_id && !/^QP-\d{6}$/.test(f.panel_id.trim())) e.panel_id = "Enter your member number, like QP-123456.";
  const n = Number(f.household_size);
  if (f.household_size && !(Number.isInteger(n) && n >= 1 && n <= 15)) e.household_size = "Enter a whole number from 1 to 15.";
  const s = Number(f.weekly_spend);
  if (f.weekly_spend !== "" && !(s >= 0 && s <= 2000)) e.weekly_spend = "Enter an amount from 0 to 2000.";
  const r = Number(f.recommend_score);
  if (f.recommend_score !== "" && !(Number.isInteger(r) && r >= 0 && r <= 10)) e.recommend_score = "Choose a number from 0 to 10.";
  if (f.last_order && f.last_order.trim().length < 20) e.last_order = "Write at least a sentence.";
  return e;
}

const readBody = (req) => new Promise((ok, no) => {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 1_000_000) { no(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  req.on("error", no);
});
const send = (res, status, type, body, headers = {}) => { res.writeHead(status, { "content-type": type, ...headers }); res.end(body); };
const json = (res, status, obj) => send(res, status, "application/json", JSON.stringify(obj));
const page = (res, status, html) => send(res, status, "text/html; charset=utf-8", html);

// JSON answers contain arrays and numbers. The guard's hold page throws on anything but strings, so flatten first. // [wf]
const flatten = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.join("; ") : String(v ?? "")])); // [wf]

async function responses(req, res) {
  const raw = await readBody(req);
  const isJson = (req.headers["content-type"] ?? "").includes("application/json");
  let fields;
  try { fields = flatten(isJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))); } // [wf] the hold page replays urlencoded, so this JSON endpoint has to accept that too
  catch { return json(res, 400, { error: "Unreadable request" }); }

  if (WHOFILLS) { // [wf-toggle]
    const d = guard.check("/api/responses", fields); // [wf]
    if (d.action === "hold") { log({ type: "held" }); return page(res, 200, d.html); } // [wf]
    console.error(`whofills verdict=${JSON.stringify(d.verdict)} passed=${!!d.passed} attested=${fields.wf_attest === "1"}`); // [wf]
    fields = stripGuardFields(fields); // [wf]
  } // [wf-toggle]

  const errors = validate(fields);
  if (Object.keys(errors).length) {
    if (isJson) return json(res, 422, { errors });
    return page(res, 422, shell(`<div class="wrap"><div class="card"><h1>Some answers need another look</h1><p>${Object.values(errors).join(" ")}</p><p><a href="/survey">Start the survey again</a>.</p></div></div>`)); // [wf] only reachable through a hold replay
  }
  const reference = `QP-C-${randomBytes(4).toString("hex").toUpperCase()}`;
  log({ type: "submit_ok", fields });
  if (isJson) return json(res, 200, { reference });
  return page(res, 200, shell(`<div class="wrap"><div class="card done"><h1>Thanks, your answers are in</h1><p>We've added 120 points to your Quillmark balance.</p><p>Your confirmation code</p><p class="code" id="reference">${reference}</p></div></div>`)); // [wf] hold replay is a full page POST, so the SPA's own success screen never runs
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && pathname === "/") return send(res, 302, "text/plain", "", { location: "/survey" });
    if (req.method === "GET" && pathname === "/survey") { log({ type: "form_view" }); return page(res, 200, SHELL); }
    if (req.method === "GET" && pathname === "/app.js") return send(res, 200, "text/javascript", appJs);
    if (WHOFILLS && req.method === "GET" && pathname === "/whofills.js") return send(res, 200, "text/javascript", clientJs); // [wf]
    if (WHOFILLS && req.method === "GET" && pathname === "/__wf/hold.js") return send(res, 200, "text/javascript", holdJs); // [wf]
    if (req.method === "POST" && pathname === "/api/responses") return await responses(req, res);
    send(res, 404, "text/plain", "Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, "text/plain", "Something went wrong on our side. Your answers were not saved. Please send them again.");
  }
});
server.listen(PORT, "127.0.0.1", () => console.log("ready"));
