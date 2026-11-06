/** Agent-facing notices. A notice states a fact about the site; it never instructs anything but stopping. */
const CLIP =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0";

export function placeNotice(form: HTMLFormElement, text: string, channels: string[]) {
  if (channels.includes("console")) console.warn(text);
  if (channels.includes("dom")) {
    // aria-hidden keeps this out of the accessibility tree: screen-reader users never hear it.
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-nosnippet", "");
    el.style.cssText = CLIP;
    el.textContent = text;
    form.prepend(el);
  }
  if (channels.includes("a11y")) {
    // Heard by screen-reader users too, so this one is off by default and must be chosen deliberately.
    form.setAttribute("aria-description", text);
  }
}
