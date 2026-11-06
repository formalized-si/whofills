/**
 * Mutation testing of the safety net. Each mutant is a bug we could plausibly ship; the named check has to catch it.
 * Use `--only id,id` for a subset, `--fast` to skip the slow browser-based ones.
 * Runs in a private copy of the repo so a live bench is never touched. A surviving mutant fails this script.
 *   node scripts/mutants.mjs [--only id]
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(".");
const V = "./node_modules/.bin/vitest run";
const P = "./node_modules/.bin/tsx bench/oracles/parity.ts /tmp/whofills-mutant-parity sdk phd";
const src = "packages/whofills/src";
const MUTANTS = [
  // Harm to people
  {
    id: "agent-on-one-group",
    file: `${src}/features.ts`,
    from: "groups.length >= 2 && total >= 0.6",
    to: "total >= 0.2",
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "autofill-counts-as-ghost",
    file: `${src}/features.ts`,
    from: `i.it.startsWith("insertComposition") || i.it === "insertReplacementText"`,
    to: `i.it.startsWith("insertComposition")`,
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "ime-counts-as-ghost",
    file: `${src}/features.ts`,
    from: `i.it.startsWith("insertComposition") || i.it === "insertReplacementText"`,
    to: `i.it === "insertReplacementText"`,
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "paste-counts-as-ghost",
    file: `${src}/features.ts`,
    from: `if (i.it === "insertFromPaste" || i.it === "insertFromDrop") {`,
    to: `if (false) {`,
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "touch-typing-counts-as-ghost",
    file: `${src}/features.ts`,
    from: "if (f.n.touches === 0 && f.totalChars >= 15",
    to: "if (f.totalChars >= 15",
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "screen-reader-clicks-count",
    file: `${src}/features.ts`,
    from: "clicks.filter((c) => (c.d ?? 1) > 0)",
    to: "clicks",
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "server-holds-in-tag-mode",
    file: `${src}/server/index.ts`,
    from: `mode === "hold" &&`,
    to: ``,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "server-fails-closed",
    file: `${src}/server/index.ts`,
    from: "v === null ? !!opts.holdMissing",
    to: "v === null ? true",
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "server-ignores-earlier-hold",
    file: `${src}/server/index.ts`,
    from: "tok.h === true || ",
    to: "",
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "server-ignores-owed-attestation",
    file: `${src}/server/index.ts`,
    from: "(tok.a === true && !attested)",
    to: "false",
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "form-submit-carries-no-token",
    file: `${src}/client.ts`,
    from: "if (this.dataset.wfBound) stamp(this);",
    to: "",
    by: `node scripts/build.mjs && ${V} tests/e2e.test.ts`,
  },
  {
    id: "hold-not-remembered",
    file: `${src}/hold-page.ts`,
    from: `localStorage.setItem(HELD, String(Date.now() + Number(el.dataset.ttl ?? 600) * 1000));`,
    to: ``,
    by: `node scripts/build.mjs && ${V} tests/e2e.test.ts`,
  },
  {
    id: "declared-agent-passes",
    file: `${src}/server/index.ts`,
    from: `const agentSaid = mode === "hold" && declared === "agent";`,
    to: `const agentSaid = false;`,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "declare-not-preselected",
    file: `${src}/attest.ts`,
    from: `r.checked = value === "self";`,
    to: ``,
    by: `node scripts/build.mjs && ${V} tests/e2e.test.ts`,
  },
  {
    id: "reduced-motion-ignored",
    file: `${src}/attest.ts`,
    from: `if (reduced) return;`,
    to: ``,
    by: `node scripts/build.mjs && ${V} tests/e2e.test.ts`,
  },
  {
    id: "flicker-row-in-a11y-tree",
    file: `${src}/attest.ts`,
    from: `el.setAttribute("aria-hidden", "true");`,
    to: ``,
    by: `node scripts/build.mjs && ${V} tests/e2e.test.ts`,
  },
  {
    id: "frames-not-gamma-correct",
    file: `${src}/attest.ts`,
    from: "toSrgb(Math.max(0, 2 * toLin(v) - toLin(lo[i])))",
    to: "2 * v - lo[i]",
    by: `${V} tests/static.test.ts`,
  },
  // Harm to crawlers and layout
  {
    id: "ua-branching",
    file: `${src}/client.ts`,
    from: `const me = document.currentScript`,
    to: `if (/bot/i.test(navigator.userAgent)) throw 0;\nconst me = document.currentScript`,
    by: `${V} tests/static.test.ts`,
  },
  {
    id: "dom-node-before-input",
    file: `${src}/client.ts`,
    from: `form.dataset.wfBound = "1";`,
    to: `form.dataset.wfBound = "1"; form.prepend(document.createElement("div"));`,
    by: `node scripts/build.mjs && ${P}`,
  },
  {
    id: "pixel-shift",
    file: `${src}/client.ts`,
    from: `form.dataset.wfBound = "1";`,
    to: `form.dataset.wfBound = "1"; form.style.marginTop = "1px";`,
    by: `node scripts/build.mjs && ${P}`,
  },
  {
    id: "a11y-node-added",
    file: `${src}/client.ts`,
    from: `form.dataset.wfBound = "1";`,
    to: `form.dataset.wfBound = "1"; form.setAttribute("aria-label", "protected");`,
    by: `node scripts/build.mjs && ${P}`,
  },
  {
    id: "tab-order-changed",
    file: `${src}/client.ts`,
    from: `form.dataset.wfBound = "1";`,
    to: `form.dataset.wfBound = "1"; form.querySelector("input")?.setAttribute("tabindex", "5");`,
    by: `node scripts/build.mjs && ${P}`,
  },
  // Weak protection
  {
    id: "any-answer-solves",
    file: `${src}/server/index.ts`,
    from: `if (a.length !== b.length || !timingSafeEqual(a, b)) return false;`,
    to: ``,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "expiry-ignored",
    file: `${src}/server/index.ts`,
    from: ` || Number(exp) < Date.now() / 1000`,
    to: ``,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "ticket-not-single-use",
    file: `${src}/server/index.ts`,
    from: `|| spent.has(nonce)`,
    to: ``,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "ticket-not-bound-to-answers",
    file: `${src}/server/index.ts`,
    from: `JSON.stringify([action, clean])`,
    to: `"x"`,
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "teleport-signal-dropped",
    file: `${src}/features.ts`,
    from: `if (c.tr && travelled <= 2) teleportClicks++;`,
    to: ``,
    by: `${V} tests/features.prop.test.ts`,
  },
  {
    id: "hold-page-unescaped",
    file: `${src}/server/index.ts`,
    from: 'value="${esc(x)}">`',
    to: 'value="${x}">`',
    by: `${V} tests/server.test.ts`,
  },
  {
    id: "frames-carry-a-static-glyph",
    file: `${src}/challenge.ts`,
    from: `out[i] = mask[i] ? fg[fy * cols + x] : bg[by * cols + x];`,
    to: `out[i] = mask[i] ? 1 : bg[by * cols + x];`,
    by: `${V} tests/challenge.test.ts`,
  },
  {
    id: "both-regions-drift-together",
    file: `${src}/challenge.ts`,
    from: `const fy = (y - (frame % rows) + rows) % rows,`,
    to: `const fy = (y + frame) % rows,`,
    by: `${V} tests/challenge.test.ts`,
  },
  {
    id: "agent-not-detected",
    file: `${src}/features.ts`,
    from: `f.ghostChars / f.totalChars >= 0.6`,
    to: `f.ghostChars / f.totalChars >= 2`,
    by: `${V} tests/features.prop.test.ts`,
  },
  // Bench integrity
  {
    id: "classifier-credits-rate-limit",
    file: "bench/classify.ts",
    from: `if (infra.test(x.finalText.slice(0, 200)) || (!answered && infra.test(x.stderr))) return "INFRA";`,
    to: ``,
    by: `${V} tests/bench-controls.test.ts`,
  },
  {
    id: "classifier-credits-empty-run",
    file: "bench/classify.ts",
    from: `if (!x.viewed || x.toolCalls === 0) return "INVALID";`,
    to: ``,
    by: `${V} tests/bench-controls.test.ts`,
  },
  {
    id: "oracle-counts-rejected-post",
    file: "bench/sites/server.ts",
    from: `if (missing.length) {`,
    to: `if (false) {`,
    by: `${V} tests/bench-controls.test.ts`,
  },
];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const work = mkdtempSync(join(tmpdir(), "whofills-mut-"));
cpSync(repo, work, {
  recursive: true,
  filter: (s) => !/\/(node_modules|bench\/runs|\.git)(\/|$)/.test(s.slice(repo.length)),
});
symlinkSync(join(repo, "node_modules"), join(work, "node_modules"));
let survived = 0;
const rows = [];
execSync("node scripts/build.mjs", { cwd: work, stdio: "ignore" });
for (const m of MUTANTS) {
  if (only && !only.includes(m.id)) continue;
  if (process.argv.includes("--fast") && (m.by.includes("build.mjs") || m.by.includes("bench-controls"))) continue;
  const path = join(work, m.file);
  const orig = readFileSync(path, "utf8");
  if (!orig.includes(m.from)) {
    console.log(`STALE    ${m.id}: pattern not found`);
    survived++;
    continue;
  }
  writeFileSync(path, orig.replace(m.from, m.to));
  const r = spawnSync("/bin/sh", ["-c", m.by], { cwd: work, stdio: "ignore", timeout: 300000 });
  writeFileSync(path, orig);
  const killed = r.status !== 0;
  if (!killed && !m.allowSurvive) survived++;
  rows.push({ id: m.id, killed });
  console.log(
    `${killed ? "killed  " : m.allowSurvive ? "tolerated" : "SURVIVED"} ${m.id}${!killed && m.note ? ` (${m.note})` : ""}`,
  );
  if (m.by.includes("build.mjs")) execSync("node scripts/build.mjs", { cwd: work, stdio: "ignore" });
}
rmSync(work, { recursive: true, force: true });
console.log(`${rows.filter((r) => r.killed).length}/${rows.length} killed, ${survived} survived`);
process.exit(survived ? 1 : 0);
