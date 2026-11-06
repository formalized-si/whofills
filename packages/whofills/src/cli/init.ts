import { randomBytes } from "node:crypto";

export type Framework = "next" | "express" | "fetch" | "other";

export interface Detected {
  framework: Framework;
  /** The name to show the user. */
  name: string;
  hasWhofills: boolean;
  publicDir: string | null;
  /** package.json says "type": "module", so server code uses import and not require. */
  esm: boolean;
}

/** Most specific first: a Next.js app can also list express. */
const FRAMEWORKS: [string, Framework, string][] = [
  ["next", "next", "Next.js"],
  ["@remix-run/node", "fetch", "Remix"],
  ["@sveltejs/kit", "fetch", "SvelteKit"],
  ["astro", "fetch", "Astro"],
  ["nuxt", "fetch", "Nuxt"],
  ["hono", "fetch", "Hono"],
  ["express", "express", "Express"],
];

export function detectFramework(pkg: unknown, exists: (dir: string) => boolean = () => false): Detected {
  const p = (pkg ?? {}) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    type?: string;
  };
  const deps = { ...p.devDependencies, ...p.dependencies };
  const hit = FRAMEWORKS.find(([dep]) => dep in deps);
  const publicDir = ["public", "static"].find(exists) ?? null;
  return {
    framework: hit?.[1] ?? "other",
    name: hit?.[2] ?? "no framework detected",
    hasWhofills: "whofills" in deps,
    publicDir,
    esm: p.type === "module",
  };
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const jsString = (s: string) => JSON.stringify(s);

/** `gate` is the default everywhere: the one line in this file that decides what a new site gets. */
export const DEFAULT_ATTEST = "gate";

export function pageSnippet(framework: Framework, selector: string) {
  if (framework === "next")
    return `import { Whofills } from "whofills/react";

// Anywhere on the page with your form:
<Whofills protect=${jsString(selector)} attest="${DEFAULT_ATTEST}" />`;
  return `<script src="/whofills.js" defer data-protect="${attr(selector)}" data-attest="${DEFAULT_ATTEST}"></script>`;
}

export function serverSnippet(framework: Framework, esm = true) {
  const guard = `const guard = createGuard({ secret: process.env.WHOFILLS_SECRET, mode: "tag" });`;
  if (framework === "express")
    return `${
      esm
        ? `import { createRequire } from "node:module";
import { createGuard } from "whofills/server";
const require = createRequire(import.meta.url);`
        : `const { createGuard } = require("whofills/server");`
    }

${guard}
app.get("/whofills.js", (req, res) => res.sendFile(require.resolve("whofills/whofills.js")));
app.get("/__wf/hold.js", (req, res) => res.sendFile(require.resolve("whofills/hold.js")));
app.use(express.urlencoded({ extended: false }));

// Add guard.express() to the route your form posts to. Change only that line of your route.
app.post("/apply", guard.express(), (req, res) => {
  // req.whofills holds the verdict. req.body has the guard's own fields removed.
  res.redirect("/thanks");
});`;
  if (framework === "next")
    return `// app/apply/route.ts: the route your form posts to
import { createGuard } from "whofills/server";

${guard.replace("WHOFILLS_SECRET,", "WHOFILLS_SECRET!,")}

export async function POST(request: Request) {
  const result = await guard.fetch(request);
  if ("response" in result) return result.response;
  // result.fields has your form's fields. result.verdict holds the verdict.
  return Response.redirect(new URL("/thanks", request.url), 303);
}`;
  if (framework === "fetch")
    return `import { createGuard } from "whofills/server";

${guard}

// In the handler your form posts to:
const result = await guard.fetch(request);
if ("response" in result) return result.response;
// result.fields has your form's fields. result.verdict holds the verdict.`;
  return `import { createGuard } from "whofills/server";

${guard}

// In the handler your form posts to, with the parsed form fields:
const decision = guard.check("/apply", fields);
if (decision.action === "hold") return sendHtml(decision.html);
// decision.verdict holds the verdict. Save it next to the submission.`;
}

export const newSecret = () => randomBytes(32).toString("base64url");

/** Files a site without a Node server has to serve itself. Express serves them from the package instead. */
export const needsCopy = (d: Detected) => d.framework !== "express";

export const copyCommand = (publicDir: string) =>
  `mkdir -p ${publicDir}/__wf && cp node_modules/whofills/dist/whofills.js ${publicDir}/ && cp node_modules/whofills/dist/hold.js ${publicDir}/__wf/`;

export function renderInit(d: Detected, selector: string, secret: string) {
  const dir = d.publicDir ?? "public";
  const steps: string[] = [`Detected: ${d.name}`, ""];
  if (!d.hasWhofills) steps.push("Install:", "", "  npm i whofills", "");
  steps.push("1. Add this to the page with your form:", "", indent(pageSnippet(d.framework, selector)), "");
  steps.push("2. Add this to your server:", "", indent(serverSnippet(d.framework, d.esm)), "");
  steps.push(
    "Set this secret on your server. It was generated now and saved nowhere:",
    "",
    `  WHOFILLS_SECRET=${secret}`,
    "",
  );
  if (needsCopy(d)) steps.push("Serve the script from your own origin:", "", `  ${copyCommand(dir)}`, "");
  steps.push(
    '"tag" mode changes nothing for anyone: it only records verdicts. Read them with `whofills summarize` before you switch to "hold".',
    "",
    "Then see what agents do on your form:",
    "",
    '  npx whofills test https://your-site/your-form --success "text shown after submitting"',
  );
  return steps.join("\n");
}

const indent = (s: string) =>
  s
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
