import { REFUSE } from "./wording.ts";

/**
 * Hosts nobody can claim to own a form on: big public sites, and shared form or hiring hosts where one tenant cannot
 * vouch for the platform. Subdomains count. --i-own-this-form does not override this. It catches obvious mistakes and
 * proves nothing about ownership.
 */
export const PUBLIC_HOSTS = [
  // Big public sites
  "google.com",
  "gmail.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "whatsapp.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "tiktok.com",
  "reddit.com",
  "github.com",
  "gitlab.com",
  "microsoft.com",
  "office.com",
  "live.com",
  "outlook.com",
  "apple.com",
  "amazon.com",
  "ebay.com",
  "paypal.com",
  "stripe.com",
  "wikipedia.org",
  "yahoo.com",
  "yandex.ru",
  "vk.com",
  "openai.com",
  "chatgpt.com",
  "anthropic.com",
  "claude.ai",
  "cloudflare.com",
  // Shared form and survey hosts
  "forms.gle",
  "typeform.com",
  "jotform.com",
  "surveymonkey.com",
  "qualtrics.com",
  "wufoo.com",
  "formstack.com",
  "hubspot.com",
  "hsforms.com",
  "tally.so",
  "airtable.com",
  "cognitoforms.com",
  "formsite.com",
  "alchemer.com",
  "prolific.com",
  "mturk.com",
  "cloudresearch.com",
  // Shared hiring hosts
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "indeed.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "taleo.net",
];
/** Whole public-sector suffixes. */
const PUBLIC_SUFFIXES = [/\.gov$/, /\.mil$/, /\.gov\.[a-z]{2}$/, /\.gouv\.[a-z]{2}$/, /\.gc\.ca$/, /\.europa\.eu$/];

export function publicHostEntry(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.+$/, "");
  for (const e of PUBLIC_HOSTS) if (h === e || h.endsWith(`.${e}`)) return e;
  for (const s of PUBLIC_SUFFIXES) {
    const m = h.match(s);
    if (m) return m[0].slice(1);
  }
  return null;
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; error: string };

export function checkTarget(raw: string | undefined): TargetCheck {
  if (!raw) return { ok: false, error: REFUSE.noUrl };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: REFUSE.badUrl(raw) };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: REFUSE.badUrl(raw) };
  if (url.username || url.password) return { ok: false, error: REFUSE.credentials };
  const entry = publicHostEntry(url.hostname);
  if (entry) return { ok: false, error: REFUSE.publicHost(url.hostname, entry) };
  return { ok: true, url };
}

export const isLocal = (hostname: string) =>
  hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\./.test(hostname);

/** What may be stored of a URL. A query string can carry the values someone typed, so it never leaves memory. */
export const cleanUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
};

/** Remove what an agent typed or was given from anything it says, before showing it. Best effort, so it is never stored. */
export function redact(text: string, values: Iterable<string>, max = 160) {
  let out = text;
  const list = [...new Set(values)].filter((v) => v.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const v of list) out = out.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[removed]");
  out = out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[removed]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}
