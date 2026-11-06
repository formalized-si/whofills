import { createElement as h, useEffect, type ReactNode } from "react";
import { CLAUSES, FIELD, type AttestMode } from "./attest.ts";

/** Loads the sensor once. Put it anywhere on a page with a protected form. `attest` is the same as `data-attest`. */
export function Whofills({
  src = "/whofills.js",
  protect = "form[data-wf-protect]",
  attest,
}: {
  src?: string;
  protect?: string;
  attest?: AttestMode;
}) {
  useEffect(() => {
    if (document.querySelector("script[data-whofills]")) return;
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.dataset.whofills = "";
    s.dataset.protect = protect;
    if (attest) s.dataset.attest = attest;
    document.head.append(s);
  }, [src, protect, attest]);
  return null;
}

/** The required attestation checkbox, rendered by your framework so that it is in the server HTML. */
export function HumanAttestation({
  children,
  lang = "en",
  className,
}: {
  children?: ReactNode;
  lang?: string;
  className?: string;
}) {
  return h(
    "label",
    { className },
    h("input", { type: "checkbox", name: FIELD, value: "1", required: true }),
    " ",
    children ?? CLAUSES[lang] ?? CLAUSES.en,
  );
}
