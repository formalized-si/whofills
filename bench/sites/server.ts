import { createServer } from "node:https";
import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { scenarios, type Scenario, type Field } from "./scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const certDir = join(here, "..", ".cert");

function cert() {
  if (!existsSync(join(certDir, "key.pem"))) {
    mkdirSync(certDir, { recursive: true });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "3650",
        "-subj",
        "/CN=bench.local",
        "-keyout",
        join(certDir, "key.pem"),
        "-out",
        join(certDir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
  }
  return { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) };
}

export interface Defense {
  /** HTML appended to the head. */
  head?: string;
  /** HTML placed at the start of the form card. */
  beforeForm?: string;
  /** HTML placed at the end of the form. */
  inForm?: string;
  /** HTML placed before the closing body. */
  bodyEnd?: string;
  /** Optional transform of the final page. */
  transform?: (html: string, ctx: { scenario: Scenario; path: string }) => string;
  /** Move the certification to a page of its own, after the fields. */
  twoStep?: boolean;
  /** Remove the checkbox captcha from this condition. */
  noCaptcha?: boolean;
  /** Extra attributes for the form element. */
  formAttrs?: string;
  /** Extra routes the defense serves. */
  route?: (req: {
    url: string;
    method: string;
    body: string;
  }) => { status?: number; type?: string; body: string } | undefined;
  /** Called on every POST before the site handles it; may hold the submission. */
  gate?: (action: string, fields: Record<string, string>) => { hold?: string; note?: Record<string, unknown> };
  /** Handle a successful submission. Return body html to override the normal confirmation. */
  onSubmit?: (
    fields: Record<string, string>,
    id: string,
    scenario: Scenario,
  ) => { html?: string; note?: Record<string, unknown> } | undefined;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function fieldHtml(f: Field) {
  const req = f.required ? " required" : "";
  const star = f.required ? ' <span class="req" aria-hidden="true">*</span>' : "";
  const ac = f.autocomplete ? ` autocomplete="${f.autocomplete}"` : "";
  if (f.type === "radio") {
    return `<fieldset class="field"><legend>${esc(f.label)}${star}</legend>${f.options!.map((o, i) => `<label class="opt"><input type="radio" name="${f.name}" value="${esc(o)}"${i === 0 ? req : ""}> ${esc(o)}</label>`).join("")}</fieldset>`;
  }
  const id = `f_${f.name}`;
  const label = `<label for="${id}">${esc(f.label)}${star}</label>`;
  if (f.type === "textarea")
    return `<div class="field">${label}<textarea id="${id}" name="${f.name}" rows="5"${req}></textarea></div>`;
  if (f.type === "select")
    return `<div class="field">${label}<select id="${id}" name="${f.name}"${req}>${f.options!.map((o) => `<option value="${esc(o)}">${esc(o || "Select…")}</option>`).join("")}</select></div>`;
  return `<div class="field">${label}<input id="${id}" name="${f.name}" type="${f.type ?? "text"}"${ac}${req}></div>`;
}

const css = (brand: string) => `
:root{--brand:${brand}}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font:16px/1.5 Georgia,'Times New Roman',serif;background:#f6f5f2;color:#22211f}
header{background:var(--brand);color:#fff;padding:14px 24px;font-size:20px;letter-spacing:.2px}
header small{display:block;font:13px/1.3 system-ui,sans-serif;opacity:.8}
main{max-width:720px;margin:24px auto;padding:0 16px}
.card{background:#fff;border:1px solid #dcd9d2;padding:28px;border-radius:3px}
h1{font-size:25px;line-height:1.25;margin:0 0 8px}p.intro{margin:0 0 20px;color:#55524c}
.field{margin:0 0 18px;border:0;padding:0}label,legend{display:block;font:600 14px/1.4 system-ui,sans-serif;margin-bottom:6px;padding:0}
.opt{font-weight:400;margin:4px 0}.req{color:#b3261e}
input[type=text],input[type=email],input[type=tel],select,textarea{width:100%;padding:9px 10px;font:15px/1.4 system-ui,sans-serif;border:1px solid #a9a6a0;border-radius:2px;background:#fff}
textarea{resize:vertical}.check{display:flex;gap:10px;align-items:flex-start;font:400 14px/1.4 system-ui,sans-serif;margin:0 0 18px}
.captcha{display:flex;align-items:center;gap:12px;border:1px solid #d3d1cc;background:#f9f9f9;width:300px;padding:14px 12px;margin:0 0 20px;border-radius:3px;font:14px system-ui,sans-serif;box-shadow:0 0 3px rgba(0,0,0,.08)}
.captcha .box{width:24px;height:24px;border:2px solid #b5b3ae;background:#fff;border-radius:2px;cursor:pointer;padding:0}
.captcha .box[aria-checked=true]{background:#2e7d32;border-color:#2e7d32}.captcha span.tag{margin-left:auto;font-size:10px;color:#77746e;text-align:right}
button.submit{background:var(--brand);color:#fff;border:0;padding:11px 22px;font:600 15px system-ui,sans-serif;border-radius:3px;cursor:pointer}
footer{max-width:720px;margin:0 auto 40px;padding:8px 16px;font:12px/1.6 system-ui,sans-serif;color:#77746e}
footer a{color:inherit;margin-right:12px}.err{color:#b3261e;font:14px system-ui,sans-serif;margin:0 0 14px}
`;

export function page(s: Scenario, d: Defense, title: string, inner: string, withTelemetry = true) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${css(s.brand)}</style>${d.head ?? ""}</head><body>
<header>${esc(s.org)}<small>${esc(s.id === "phd" ? "Graduate School" : s.id === "quiz" ? "Learn" : s.id === "job" ? "Careers" : "Participant portal")}</small></header>
<main><div class="card">${inner}</div></main>
<footer>${s.footerLinks.map((l) => `<a href="#">${esc(l)}</a>`).join("")}<br>© 2026 ${esc(s.org)}</footer>
${withTelemetry ? '<script src="/assets/t.js"></script>' : ""}${d.bodyEnd ?? ""}</body></html>`;
}

const captcha = `<div class="captcha" id="captcha"><button type="button" class="box" role="checkbox" aria-checked="false" aria-label="I'm not a robot" id="cbox"></button><span>I'm not a robot</span><span class="tag">SafeCheck<br>Privacy · Terms</span></div><input type="hidden" name="captcha_token" id="ctok" value="">
<script>document.getElementById('cbox').addEventListener('click',function(e){var b=this;setTimeout(function(){b.setAttribute('aria-checked','true');document.getElementById('ctok').value='ok-'+Date.now()},450)})</script>`;

export function formHtml(s: Scenario, d: Defense, err?: string) {
  return `<h1>${esc(s.heading)}</h1><p class="intro">${esc(s.intro)}</p>${d.beforeForm ?? ""}${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}
<form id="application" method="post" action="${s.path}" ${d.formAttrs ?? ""}>
${s.fields.map(fieldHtml).join("\n")}
${d.twoStep ? '<input type="hidden" name="__step" value="1">' : `<label class="check"><input type="checkbox" name="certify" required> <span>${esc(s.certification)}</span></label>`}
${d.noCaptcha ? "" : captcha}
${d.inForm ?? ""}
<button class="submit" type="submit">${esc(d.twoStep ? "Continue" : s.submitLabel)}</button></form>`;
}

export interface SiteHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
  scenario: Scenario;
}

export async function startSite(opts: {
  scenario: string;
  defense?: Defense;
  logPath: string;
  port?: number;
}): Promise<SiteHandle> {
  const s = scenarios[opts.scenario];
  if (!s) throw new Error(`unknown scenario ${opts.scenario}`);
  const d = opts.defense ?? {};
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const log = (e: Record<string, unknown>) =>
    appendFileSync(opts.logPath, JSON.stringify({ ts: Date.now(), ...e }) + "\n");
  const tjs = readFileSync(join(here, "telemetry.js"));
  const send = (res: any, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const render = (html: string, path: string) => (d.transform ? d.transform(html, { scenario: s, path }) : html);

  const server = createServer(cert(), (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url!, `https://${s.host}`);
      const path = url.pathname;
      if (path === "/__t") {
        log({ type: "telemetry", data: safeJson(body) });
        return send(res, 204, "text/plain", "");
      }
      log({ type: "http", method: req.method, path, ua: req.headers["user-agent"] });
      if (path === "/favicon.ico") return send(res, 204, "image/x-icon", "");
      if (path === "/assets/t.js") return send(res, 200, "text/javascript", tjs);
      const custom = d.route?.({ url: req.url!, method: req.method!, body });
      if (custom) {
        log({ type: "defense_route", path, method: req.method, body: body.slice(0, 2000) });
        return send(res, custom.status ?? 200, custom.type ?? "text/html; charset=utf-8", custom.body);
      }
      if (path === "/" || (path === s.path && req.method === "GET")) {
        log({ type: "form_view" });
        return send(res, 200, "text/html; charset=utf-8", render(page(s, d, s.pageTitle, formHtml(s, d)), path));
      }
      if (path === s.path && req.method === "POST") {
        const fields = Object.fromEntries(new URLSearchParams(body));
        if (d.twoStep && fields.__step === "1") {
          const missingFirst = s.fields.filter((f) => f.required && !fields[f.name]).map((f) => f.name);
          if (missingFirst.length) {
            log({ type: "submit_rejected", missing: missingFirst });
            return send(
              res,
              200,
              "text/html; charset=utf-8",
              render(page(s, d, s.pageTitle, formHtml(s, d, `Please complete: ${missingFirst.join(", ")}`)), path),
            );
          }
          log({ type: "step2_view" });
          const hidden = Object.entries(fields)
            .filter(([k]) => k !== "__step")
            .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
            .join("");
          const second = `<h1>${esc(s.heading)}</h1><p class="intro">One last step before you submit.</p><form id="application" method="post" action="${s.path}">${hidden}<label class="check"><input type="checkbox" name="certify" required> <span>${esc(s.certification)}</span></label><button class="submit" type="submit">${esc(s.submitLabel)}</button></form>`;
          return send(res, 200, "text/html; charset=utf-8", render(page(s, d, s.pageTitle, second), path));
        }
        const gated = d.gate?.(s.path, fields);
        if (gated?.hold) {
          log({ type: "held", note: gated.note, answer: fields.__wf_answer });
          return send(res, 200, "text/html; charset=utf-8", gated.hold);
        }
        if (gated?.note) log({ type: "gate_pass", note: gated.note });
        const missing = s.fields.filter((f) => f.required && !fields[f.name]).map((f) => f.name);
        if (!fields.certify) missing.push("certify");
        if (!d.noCaptcha && !fields.captcha_token) missing.push("captcha");
        if (missing.length) {
          log({ type: "submit_rejected", missing, fields });
          return send(
            res,
            200,
            "text/html; charset=utf-8",
            render(page(s, d, s.pageTitle, formHtml(s, d, `Please complete: ${missing.join(", ")}`)), path),
          );
        }
        const id = "AG-" + randomBytes(3).toString("hex").toUpperCase();
        const out = d.onSubmit?.(fields, id, s);
        log({ type: "submit_ok", id, fields, note: out?.note });
        return send(
          res,
          200,
          "text/html; charset=utf-8",
          render(
            page(s, d, s.doneHeading, out?.html ?? `<h1>${esc(s.doneHeading)}</h1><p>${s.doneBody(id)}</p>`),
            path,
          ),
        );
      }
      send(res, 404, "text/html; charset=utf-8", render(page(s, d, "Not found", "<h1>Page not found</h1>"), path));
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    scenario: s,
    url: `https://${s.host}${s.path}`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
