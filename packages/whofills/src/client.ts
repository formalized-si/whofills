import { extract, score, type Features } from "./features.ts";
import { startSensor } from "./sensor.ts";
import { placeNotice } from "./notice.ts";
import { declareForm, ensureAttestation, gateForm, type AttestMode } from "./attest.ts";

export interface ClientConfig {
  /** Forms to protect. */
  selector: string;
  /** Agent-facing notice; empty means no notice is placed. */
  notice: string;
  /** Channels for the notice. */
  channels: string[];
  /** Insert the attestation checkbox into every protected form. */
  attest?: AttestMode;
  /** Your own wording for the attestation. */
  attestText?: string;
  /** With `gate`: add one small line asking agents not to fill in the form. */
  attestAsk?: boolean;
}

export interface Token {
  v: 1;
  f: Features;
  wd: boolean;
  /** Held earlier and not solved yet. */
  h?: boolean;
  /** This form was set up with the attestation. */
  a?: boolean;
  /** This form was set up with the question about who is filling it in. */
  d?: boolean;
}

function heldBefore() {
  try {
    return Number(localStorage.getItem("__wf_held")) > Date.now();
  } catch {
    return false;
  }
}

const b64url = (s: string) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function init(cfg: ClientConfig) {
  const sensor = startSensor();
  const makeToken = (): Token => ({
    v: 1,
    f: extract(sensor.events()),
    wd: !!navigator.webdriver,
    ...(heldBefore() ? { h: true } : {}),
    ...(cfg.attest === "declare" ? { d: true } : cfg.attest ? { a: true } : {}),
  });
  const stamp = (form: HTMLFormElement) => {
    let input = form.querySelector<HTMLInputElement>('input[name="__wf"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "__wf";
      form.append(input);
    }
    input.value = b64url(JSON.stringify(makeToken()));
  };
  // form.submit() fires no submit event and skips `required`. Agents reach for it when a click seems to do nothing,
  // and sites use it too, so it is not a signal in itself: it just has to carry the token like any other submission.
  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    if (this.dataset.wfBound) stamp(this);
    nativeSubmit.call(this);
  };
  const attach = (form: HTMLFormElement) => {
    if (form.dataset.wfBound) return;
    form.dataset.wfBound = "1";
    if (cfg.attest === "gate") gateForm(form, { text: cfg.attestText, ask: cfg.attestAsk });
    if (cfg.attest === "declare") declareForm(form);
    const ticks = !!cfg.attest && cfg.attest !== "gate" && cfg.attest !== "declare";
    // Nothing is added to the DOM before the first interaction, so a crawler renders the page unchanged.
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      if (cfg.notice) placeNotice(form, cfg.notice, cfg.channels);
      // Inserted on the first input: a crawler never gets here, and CLS does not count a shift right after user input.
      if (ticks) ensureAttestation(form, cfg.attest!, cfg.attestText);
    };
    form.addEventListener("focusin", arm, { once: true, capture: true, passive: true });
    form.addEventListener("pointerdown", arm, { once: true, capture: true, passive: true });
    // A submit with no earlier interaction (Enter key, a script) still has to meet the attestation.
    form.addEventListener(
      "click",
      (e) => {
        const t = e.target as HTMLElement;
        if (!armed && t.closest?.('button,input[type="submit"]')) {
          arm();
          if (ticks) e.preventDefault();
        }
      },
      true,
    );
    form.addEventListener(
      "submit",
      () => {
        stamp(form);
      },
      true,
    );
  };
  const scan = () => document.querySelectorAll<HTMLFormElement>(cfg.selector).forEach(attach);
  const start = () => {
    scan();
    // Single-page apps render their forms later.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        scan();
      }, 200);
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  /** For forms that submit with fetch: send this as the `__wf` field. */
  const token = () => b64url(JSON.stringify(makeToken()));
  /** For forms that submit with fetch: pass the response here. It shows the step-up page if the submission was held. */
  const handle = async (res: Response) => {
    if (res.status !== 428) return false;
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { whofills?: string; html?: string } | null;
    if (body?.whofills !== "hold" || !body.html) return false;
    document.open();
    document.write(body.html);
    document.close();
    return true;
  };
  return {
    token,
    handle,
    features: () => extract(sensor.events()),
    score: () => score(extract(sensor.events()), { webdriver: !!navigator.webdriver }),
  };
}

const me = document.currentScript as HTMLScriptElement | null;
if (me) {
  (window as unknown as { whofills: unknown }).whofills = init({
    selector: me.dataset.protect ?? "form[data-wf-protect]",
    notice: me.dataset.notice ?? "",
    channels: (me.dataset.channels ?? "console,dom").split(",").filter(Boolean),
    attest: ["gate", "check", "visible", "ambient", "declare"].includes(me.dataset.attest ?? "")
      ? (me.dataset.attest as AttestMode)
      : undefined,
    attestText: me.dataset.attestText,
    attestAsk: me.dataset.attestAsk !== undefined,
  });
}
