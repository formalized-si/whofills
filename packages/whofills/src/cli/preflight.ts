import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserEndpoint, Cdp } from "./cdp.ts";
import { isLocal } from "./safety.ts";
import { inPage, probeExpression, sleep, within, type PageSample } from "./observe.ts";
import type { FormField } from "./task.ts";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

export const findChrome = (env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync) =>
  env.CHROME_BIN && exists(env.CHROME_BIN) ? env.CHROME_BIN : CHROME_PATHS.find(exists);

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/* Runs in the page. Reads the form's shape. Current values are not read. */
function readForm() {
  const skip = ["hidden", "submit", "button", "reset", "image"];
  const forms = [...document.forms];
  const usable = (f: HTMLFormElement) =>
    [...f.elements].filter((el) => {
      const c = el as HTMLInputElement;
      if (c.tagName === "BUTTON" || c.tagName === "FIELDSET" || c.tagName === "OUTPUT") return false;
      return (
        !c.name?.startsWith("__wf") && c.name !== "wf_attest" && !skip.includes(c.type) && c.getClientRects().length > 0
      );
    }) as HTMLInputElement[];
  const form =
    forms.find((f) => f.dataset.wfBound && usable(f).length) ??
    forms.sort((a, b) => usable(b).length - usable(a).length)[0];
  if (!form) return [];
  const labelOf = (el: HTMLInputElement) =>
    (el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.placeholder || "").trim().replace(/\s*\*$/, "");
  const seen = new Set<string>();
  return usable(form).flatMap((el, i) => {
    // Radio buttons and checkbox groups share a name and count once. React inputs often have no name at all.
    const key = el.name || el.id || `field-${i}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const type = el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : el.type;
    const options =
      el.tagName === "SELECT"
        ? [...(el as unknown as HTMLSelectElement).options]
            .filter((o) => o.value && !o.disabled)
            .map((o) => o.text.trim())
        : [];
    return [{ name: el.name || el.id || "", label: labelOf(el), type, required: el.required, options }];
  });
}

export interface Preflight {
  status: number | null;
  /** In memory only: may carry a query string. */
  finalUrl: string;
  fields: FormField[];
  sample: PageSample;
}

/** One ordinary page load in a throwaway browser, with nothing filled in, before any agent is started. */
export async function preflight(chrome: string, url: URL, success: string): Promise<Preflight> {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "whofills-preflight-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      ...(isLocal(url.hostname) ? ["--ignore-certificate-errors"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise<void>((r) => child.once("close", () => r()));
  try {
    let endpoint: string | null = null;
    for (let i = 0; i < 100 && !endpoint; i++) {
      endpoint = await browserEndpoint(port);
      if (!endpoint) await sleep(150);
    }
    if (!endpoint) throw new Error("Chrome did not start.");
    const cdp = await Cdp.connect(endpoint);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    let status: number | null = null;
    cdp.on("Network.responseReceived", (p) => {
      if (p.type === "Document") status = p.response.status;
    });
    const loaded = new Promise<void>((r) => cdp.on("Page.loadEventFired", () => r()));
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url: url.href }, sessionId);
    await within(loaded, 30000);
    await sleep(800); // deferred scripts and late rendering
    const evaluate = async (expression: string) =>
      (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, silent: true }, sessionId)).result.value;
    const sample: PageSample = await evaluate(probeExpression(success));
    const fields: FormField[] = await evaluate(inPage(readForm));
    const finalUrl = sample.url;
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();
    return { status, finalUrl, fields, sample };
  } finally {
    child.kill();
    await within(exited, 3000);
    removeQuietly(profile);
  }
}

/** Chrome's helper processes can still be writing to the profile after the browser exits (seen on Linux), so a failed
 * cleanup of this temporary directory must not fail the command; the system clears its temp directory. */
export function removeQuietly(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // left for the system to clear
  }
}
