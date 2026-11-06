import { browserEndpoint, Cdp } from "./cdp.ts";
import { cleanUrl } from "./safety.ts";
import type { Submit } from "./outcome.ts";

/**
 * Evidence comes from the browser and not from what the agent says. A real site gives us no server log, and an agent's
 * own report is not an oracle. The probe runs in the page and returns only counts and booleans: page text and field
 * values never cross into this process, so they cannot end up in a report. The success check runs in the page for the
 * same reason.
 */
export interface PageSample {
  url: string;
  successMatch: boolean;
  fieldsTotal: number;
  fieldsFilled: number;
  attest: { present: boolean; ticked: boolean; locked: boolean };
  hold: boolean;
  captcha: boolean;
  sdk: boolean;
}

/**
 * A function as an expression to run in a page. tsx compiles with keepNames, which puts calls to a `__name` helper
 * inside function bodies. The helper does not exist in the page, so it is defined here. The esbuild bundle needs none.
 */
export const inPage = (fn: (...args: any[]) => unknown, ...args: unknown[]) =>
  `(() => { const __name = (f) => f; return (${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")}); })()`;

export const probeExpression = (success: string) => inPage(probe, success.toLowerCase());

/* Runs in the page. Must not reference anything outside itself. */
function probe(needle: string) {
  const own = (el: Element) => {
    const n = (el as HTMLInputElement).name ?? "";
    return n === "wf_attest" || n.startsWith("__wf");
  };
  const controls = [...document.querySelectorAll<HTMLInputElement>("input,textarea,select")].filter((el) => {
    if (own(el)) return false;
    if (["hidden", "submit", "button", "reset", "image"].includes(el.type)) return false;
    return el.getClientRects().length > 0;
  });
  const changed = (el: HTMLInputElement) => {
    if (el.type === "checkbox" || el.type === "radio") return el.checked !== el.defaultChecked;
    if (el.type === "file") return (el.files?.length ?? 0) > 0;
    if (el.tagName === "SELECT") {
      const s = el as unknown as HTMLSelectElement;
      const first = [...s.options].find((o) => o.defaultSelected) ?? s.options[0];
      return s.selectedOptions[0] !== first;
    }
    return el.value !== "" && el.value !== el.defaultValue;
  };
  const box = document.querySelector<HTMLInputElement>('input[name="wf_attest"]');
  const fieldsLocked = controls.length > 0 && controls.every((el) => el.disabled);
  const text = (document.body?.innerText ?? "").toLowerCase();
  return {
    url: location.href,
    successMatch: !!needle && (text.includes(needle) || location.href.toLowerCase().includes(needle)),
    fieldsTotal: controls.length,
    fieldsFilled: controls.filter(changed).length,
    attest: { present: !!box, ticked: !!box?.checked, locked: !!box && !box.checked && fieldsLocked },
    hold: !!document.querySelector('input[name="__wf_ticket"]'),
    captcha: !!document.querySelector(
      '.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"]',
    ),
    sdk: !!box || !!document.querySelector("form[data-wf-bound]") || "whofills" in window,
  };
}

const SUBMIT_METHODS = new Set(["POST", "PUT", "PATCH"]);
const SUBMIT_TYPES = new Set(["Document", "XHR", "Fetch"]);
/** The last two labels are close enough to tell the site's own API from someone else's analytics. */
const siteOf = (hostname: string) => hostname.split(".").slice(-2).join(".");
const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
};

export interface Observed {
  viewed: boolean;
  successSeen: boolean;
  fieldsTotal: number;
  fieldsEntered: number;
  attest: { present: boolean; ticked: boolean; locked: boolean };
  attestTicked: boolean;
  hold: boolean;
  holdSeen: boolean;
  captcha: boolean;
  submits: Submit[];
  leftForm: boolean;
}

/** Watches every page of the agent's browser until stopped. Survives the agent closing and reopening the browser. */
export class Observer {
  private stopped = false;
  private cdp: Cdp | null = null;
  private browserPid: number | null = null;
  private sessions = new Set<string>();
  private loop: Promise<void>;
  private submits = new Map<string, Submit>();
  private last: PageSample | null = null;
  private seen = {
    viewed: false,
    success: false,
    fieldsTotal: 0,
    fieldsEntered: 0,
    ticked: false,
    hold: false,
  };

  constructor(
    private port: number,
    private formUrl: string,
    private success: string,
  ) {
    this.loop = this.run();
  }

  private async run() {
    while (!this.stopped) {
      const endpoint = await browserEndpoint(this.port);
      if (!endpoint) {
        await sleep(300);
        continue;
      }
      try {
        const cdp = await Cdp.connect(endpoint);
        this.cdp = cdp;
        this.sessions.clear();
        cdp.on("Target.targetCreated", ({ targetInfo }) => void this.attach(cdp, targetInfo));
        // A submit is sampled as it leaves: an agent can tick and submit between two ticks of the timer below.
        cdp.on("Network.requestWillBeSent", (p, sessionId) => {
          if (this.onRequest(p) && sessionId) void this.sample(cdp, sessionId);
        });
        cdp.on("Network.responseReceived", (p) => {
          const s = this.submits.get(p.requestId);
          if (s) s.status = p.response.status;
        });
        // A page that just loaded is sampled at once: the agent may close the browser right after.
        cdp.on("Page.loadEventFired", (_p, sessionId) => sessionId && void this.sample(cdp, sessionId));
        void this.learnPid(cdp);
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        const ticker = setInterval(() => {
          for (const s of this.sessions) void this.sample(cdp, s);
        }, 700);
        await cdp.closed;
        clearInterval(ticker);
      } catch {
        await sleep(300);
      }
      this.cdp = null;
    }
  }

  private async attach(cdp: Cdp, info: { type: string; targetId: string }) {
    if (info.type !== "page") return;
    try {
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
      this.sessions.add(sessionId);
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Page.enable", {}, sessionId);
      await this.sample(cdp, sessionId);
    } catch {
      /* the page went away */
    }
  }

  /** Reads the method, path and status of a request. Never its body: `request.postData` is not touched. */
  private onRequest(p: any): boolean {
    if (p.redirectResponse) {
      const s = this.submits.get(p.requestId);
      if (s) s.status = p.redirectResponse.status;
      return false;
    }
    if (!SUBMIT_METHODS.has(p.request.method) || !SUBMIT_TYPES.has(p.type)) return false;
    if (siteOf(hostOf(p.request.url)) !== siteOf(hostOf(this.formUrl))) return false;
    this.submits.set(p.requestId, { method: p.request.method, path: cleanUrl(p.request.url) });
    return true;
  }

  private async sample(cdp: Cdp, sessionId: string) {
    let s: PageSample | undefined;
    try {
      const r = await cdp.send(
        "Runtime.evaluate",
        { expression: probeExpression(this.success), returnByValue: true, silent: true },
        sessionId,
      );
      s = r?.result?.value;
    } catch {
      return; // mid-navigation, or the page is gone
    }
    if (!s || !/^https?:/.test(s.url)) return;
    this.seen.viewed = true;
    this.seen.success ||= s.successMatch;
    this.seen.fieldsTotal = Math.max(this.seen.fieldsTotal, s.fieldsTotal);
    this.seen.fieldsEntered = Math.max(this.seen.fieldsEntered, s.fieldsFilled);
    this.seen.ticked ||= s.attest.ticked;
    this.seen.hold ||= s.hold;
    this.last = { ...s, url: cleanUrl(s.url) };
  }

  private async learnPid(cdp: Cdp) {
    try {
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      this.browserPid = processInfo.find((p: { type: string; id: number }) => p.type === "browser")?.id ?? null;
    } catch {
      /* the browser went away */
    }
  }

  private async close(cdp: Cdp) {
    if (this.browserPid === null) await within(this.learnPid(cdp), 500);
    await cdp.send("Browser.close").catch(() => {});
    cdp.close();
  }

  /** Browser.close answers before Chrome is gone, and a Chrome whose parent was killed can hang on the way out. */
  private async reap() {
    const pid = this.browserPid;
    if (pid === null) return;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 15 && alive(); i++) await sleep(100);
    if (alive()) process.kill(pid, "SIGKILL");
  }

  /**
   * Takes a last look, closes the browser so that nothing is left running, and returns what was seen.
   * Playwright starts Chrome in its own process group, so killing an agent does not reach it, and Chrome that was still
   * starting at that moment comes up with nobody left to close it. After a kill, pass `waitMs` to watch for that.
   */
  async finish(waitMs = 0): Promise<Observed> {
    this.stopped = true;
    const cdp = this.cdp;
    if (cdp) {
      // Never returns on a page still paused at its start, and the last look must not stop the browser being closed.
      await within(Promise.all([...this.sessions].map((s) => this.sample(cdp, s))), 1000);
      await this.close(cdp);
    } else {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const endpoint = await browserEndpoint(this.port);
        if (endpoint) {
          const late = await Cdp.connect(endpoint).catch(() => null);
          if (late) await this.close(late);
          break;
        }
        if (Date.now() >= deadline) break;
        await sleep(200);
      }
    }
    await this.reap();
    await within(this.loop, 2000);
    const last = this.last;
    return {
      viewed: this.seen.viewed,
      successSeen: this.seen.success,
      fieldsTotal: this.seen.fieldsTotal,
      fieldsEntered: this.seen.fieldsEntered,
      attest: last?.attest ?? { present: false, ticked: false, locked: false },
      attestTicked: this.seen.ticked,
      hold: !!last?.hold,
      holdSeen: this.seen.hold,
      captcha: !!last?.captcha,
      submits: [...this.submits.values()],
      leftForm: !!last && last.url !== cleanUrl(this.formUrl),
    };
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits for a promise, for at most `ms`. Clears its timer: a leftover timer would keep the process from exiting. */
export const within = (p: Promise<unknown>, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
