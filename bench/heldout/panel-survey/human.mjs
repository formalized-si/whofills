// Verification helpers (copied into each site's dir on purpose, so each site stands alone).
// Human: slow input through real mouse paths and key presses. Nothing here touches the page's DOM directly.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
// Box-Muller log-normal: human inter-key gaps are right-skewed
const logNormal = (median, sigma) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()));

export class Human {
  constructor(page) {
    this.page = page;
    this.x = rnd(200, 500);
    this.y = rnd(150, 350);
  }
  async moveTo(tx, ty) {
    const { x: sx, y: sy } = this;
    const dist = Math.hypot(tx - sx, ty - sy);
    const steps = Math.max(10, Math.round(rnd(14, 24) + dist / 45));
    const bend = dist * rnd(0.08, 0.25) * (Math.random() < 0.5 ? -1 : 1);
    const nx = -(ty - sy) / (dist || 1), ny = (tx - sx) / (dist || 1);
    const c1 = [sx + (tx - sx) * 0.3 + nx * bend, sy + (ty - sy) * 0.3 + ny * bend];
    const c2 = [sx + (tx - sx) * 0.7 + nx * bend * 0.6, sy + (ty - sy) * 0.7 + ny * bend * 0.6];
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const t = u * u * (3 - 2 * u); // ease in and out
      const m = 1 - t;
      const x = m ** 3 * sx + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t ** 3 * tx + rnd(-0.7, 0.7);
      const y = m ** 3 * sy + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t ** 3 * ty + rnd(-0.7, 0.7);
      await this.page.mouse.move(x, y);
      await sleep(rnd(7, 19));
    }
    await this.page.mouse.move(tx, ty);
    this.x = tx;
    this.y = ty;
  }
  async scrollInto(loc) {
    const vp = this.page.viewportSize();
    for (let i = 0; i < 60; i++) {
      const box = await loc.boundingBox();
      if (!box) throw new Error("element has no box: " + loc);
      if (box.y >= 70 && box.y + box.height <= vp.height - 50) return box;
      // Chrome changes a focused number input when the wheel turns over it, with or without any script on the page
      // (see number-wheel-probe.mjs). A person rests the pointer in the margin to scroll; so does this.
      if (i === 0) await this.moveTo(vp.width - rnd(14, 40), Math.max(30, Math.min(vp.height - 30, this.y + rnd(-60, 60))));
      const want = box.y + box.height / 2 - vp.height / 2;
      await this.page.mouse.move(this.x + rnd(-3, 3), this.y + rnd(-3, 3));
      await this.page.mouse.wheel(0, Math.max(-380, Math.min(380, want)));
      await sleep(rnd(180, 340));
    }
    return loc.boundingBox();
  }
  /** Aim somewhere inside the element, never dead centre. `at` forces a fixed px offset from the left edge. */
  aim(box, at) {
    for (let i = 0; i < 20; i++) {
      const x = at !== undefined ? box.x + at : box.x + box.width * rnd(0.18, 0.82);
      const y = box.y + box.height * rnd(0.25, 0.75);
      if (Math.hypot(x - (box.x + box.width / 2), y - (box.y + box.height / 2)) >= 3 || box.width < 10) return [x, y];
    }
    return [box.x + box.width * 0.3, box.y + box.height * 0.35];
  }
  async click(loc, at) {
    const box = await this.scrollInto(loc);
    const [x, y] = this.aim(box, at);
    await this.moveTo(x, y);
    await sleep(rnd(60, 170));
    await this.page.mouse.move(x + rnd(-0.6, 0.6), y + rnd(-0.6, 0.6)); // the hand is never perfectly still
    await sleep(rnd(30, 90));
    await this.page.mouse.down();
    await sleep(rnd(55, 130));
    await this.page.mouse.up();
    await sleep(rnd(140, 380));
  }
  async type(text) {
    for (const ch of text) {
      if (/[a-z]/.test(ch) && Math.random() < 0.012) {
        await this.page.keyboard.press("KeyQ");
        await sleep(logNormal(190, 0.3));
        await this.page.keyboard.press("Backspace");
        await sleep(logNormal(170, 0.3));
      }
      await this.page.keyboard.type(ch);
      let gap = logNormal(92, 0.42);
      if (ch === " ") gap += rnd(20, 120);
      if (Math.random() < 0.015) gap += rnd(350, 900);
      await sleep(Math.max(32, gap));
    }
    await sleep(rnd(180, 520));
  }
  async fill(loc, text) {
    await this.click(loc);
    await this.type(text);
  }
  /** Native date input: aim at the month segment on the left, then type the digits (mm dd yyyy). */
  async date(loc, iso, at = 14) {
    const [y, m, d] = iso.split("-");
    // Chrome orders the segments by the machine's locale, not Playwright's: read the value back, as a person would look at it.
    for (const order of [m + d + y, d + m + y]) {
      await this.click(loc, at);
      await this.type(order);
      if ((await loc.inputValue()) === iso) return;
    }
    throw new Error(`could not enter date ${iso}, field holds ${await loc.inputValue()}`);
  }
  /** Native select: focus it from the keyboard path and use type-ahead; no popup. */
  async select(loc, prefix) {
    const box = await this.scrollInto(loc);
    const [x, y] = this.aim(box);
    await this.moveTo(x, y);
    await sleep(rnd(120, 300));
    await loc.focus();
    await this.type(prefix);
  }
  async think(a = 400, b = 1100) {
    await sleep(rnd(a, b));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

const freePort = () =>
  new Promise((ok, no) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on("error", no);
  });

/** Start this site per the contract: node bench/heldout/<site>/server.mjs from repo root. */
export async function startSite(serverPath, whofills) {
  const port = await freePort();
  const log = join(mkdtempSync(join(tmpdir(), "heldout-")), "log.jsonl");
  const proc = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), LOG: log, WHOFILLS: whofills },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  await new Promise((ok, no) => {
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d;
      if (out.includes("ready")) ok();
    });
    proc.on("exit", (c) => no(new Error(`server exited ${c}: ${stderr}`)));
    setTimeout(() => no(new Error("no ready in 20s: " + stderr)), 20000);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stderr: () => stderr,
    events: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    stop: () => {
      proc.removeAllListeners("exit");
      proc.kill();
    },
  };
}

/** Read the five digits off the hold page, so the replay path can be exercised end to end. */
export async function solveHold(page, human) {
  const FONT = { 0: "01110100011001110101110011000101110", 1: "00100011000010000100001000010001110", 2: "01110100010000100010001000100011111", 3: "11111000100010000010000011000101110", 4: "00010001100101010010111110001000010", 5: "11111100001111000001000011000101110", 6: "00110010001000011110100011000101110", 7: "11111000010001000100010000100001000", 8: "01110100011000101110100011000101110", 9: "01110100011000101111000010001001100" };
  const { mask, cols, rows } = await page.evaluate(() => {
    const s = document.querySelector("script[data-mask]");
    return { mask: s.dataset.mask, cols: +s.dataset.cols, rows: +s.dataset.rows };
  });
  const bytes = Buffer.from(mask, "base64");
  const on = (x, y) => (bytes[(y * cols + x) >> 3] >> ((y * cols + x) & 7)) & 1;
  const scale = Math.floor(Math.min(cols / 31, rows / 9));
  const ox = Math.floor((cols - 29 * scale) / 2), oy = Math.floor((rows - 7 * scale) / 2);
  let code = "";
  for (let i = 0; i < 5; i++) {
    let bits = "";
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) bits += on(ox + (i * 6 + x) * scale, oy + y * scale);
    code += Object.keys(FONT).find((k) => FONT[k] === bits) ?? "?";
  }
  await human.fill(page.locator('input[name="__wf_answer"]'), code);
  await human.click(page.locator('main button[type="submit"]'));
  return code;
}

const FORBIDDEN = /test|bench|mock|demo|sample|fake/i;
/** The words must not appear on the page. Library field/attribute names (wf_attest, data-attest) are not rendered and are excluded. */
export async function scanWords(page, label) {
  const text = await page.evaluate(() => `${document.title}\n${document.body.innerText}`);
  const source = (await page.content()).replace(/wf_attest|data-attest(?:-text)?/g, "").replace(/data-mask="[^"]*"|name="__wf_ticket" value="[^"]*"/g, "");
  const hits = [];
  for (const [where, s] of [["text", text], ["source", source]]) {
    const m = s.match(new RegExp(`.{0,30}(${FORBIDDEN.source}).{0,30}`, "i"));
    if (m) hits.push(`${label}/${where}: …${m[0]}…`);
  }
  return hits;
}

export function assertValidate(manifest, event) {
  const bad = [];
  for (const [k, want] of Object.entries(manifest.validate)) {
    if (!String(event.fields[k] ?? "").includes(want)) bad.push(`${k}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(event.fields[k])}`);
  }
  return bad;
}

export const launchOpts = (hideWebdriver) =>
  hideWebdriver
    ? { channel: "chrome", headless: true, ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"] }
    : { channel: "chrome", headless: true };

/** Print the last verdict line from the server's stderr. */
export const lastVerdict = (site) => (site.stderr().match(/whofills .*/g) ?? []).at(-1) ?? "(no verdict logged)";

/** Recorder counters just before submit (window.whofills.features() is in the built script, though the docs do not mention it). */
export const recorderStats = (page) =>
  page.evaluate(() => {
    const f = window.whofills?.features?.();
    return f ? { ...f.n, durationS: Math.round(f.durationS), keyGapMs: f.keyGapMs, keyGapCv: f.keyGapCv && +f.keyGapCv.toFixed(2), centreClicks: f.centreClicks, teleportClicks: f.teleportClicks, ghostChars: f.ghostChars, totalChars: f.totalChars } : null;
  });
