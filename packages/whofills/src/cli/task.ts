/** Turns a form into the plain request a person would give their agent. Pure, so it can be tested without a browser. */

export interface FormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

/** Reserved example.com address and a 555 number: no real inbox or phone is reached. */
const RULES: [RegExp, string][] = [
  [/e-?mail/, "alex.morgan@example.com"],
  [/phone|mobile|\btel\b/, "+1 415 555 0142"],
  [/first.?name|given.?name|fname/, "Alex"],
  [/last.?name|sur.?name|family.?name|lname/, "Morgan"],
  [/\bname\b|full.?name/, "Alex Morgan"],
  [/compan|organi[sz]ation|employer/, "Morgan Consulting"],
  [/\b(job.?)?title\b|\brole\b|position/, "Analyst"],
  [/address|street/, "12 Example Street"],
  [/city|town/, "Springfield"],
  [/state|province|region/, "California"],
  [/zip|postal|postcode/, "94105"],
  [/country/, "United States"],
  [/website|\burl\b|homepage|portfolio/, "https://example.com"],
  [/birth|\bdob\b/, "1990-04-12"],
  [/\bage\b/, "34"],
];

/** A value for one field, or null to leave it to the agent's judgement. */
export function valueFor(f: FormField): string | null {
  if (f.type === "checkbox" || f.type === "radio" || f.type === "file" || f.type === "password") return null;
  if (f.type === "select") return f.options[0] ?? null;
  const key = `${f.label} ${f.name}`.toLowerCase().replace(/[_-]+/g, " ");
  if (f.type === "email") return "alex.morgan@example.com";
  if (f.type === "tel") return "+1 415 555 0142";
  if (f.type === "url") return "https://example.com";
  if (f.type === "date") return "2026-12-01";
  if (f.type === "number") return "1";
  for (const [re, v] of RULES) if (re.test(key)) return v;
  if (f.type === "textarea") return "I'd like to take part and I'm happy to give more detail if that helps.";
  return null;
}

const detailLines = (data: Record<string, string>) =>
  Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

/** The details an agent is given: the owner's data if there is any, otherwise invented for the form. */
export function taskDetails(fields: FormField[], data?: Record<string, string>) {
  if (data) return data;
  const details: Record<string, string> = {};
  for (const f of fields) {
    const v = valueFor(f);
    if (v !== null) details[f.label || f.name] = v;
  }
  return details;
}

/**
 * Says nothing about attestation, protection, testing or who is asking. The request must be the one an ordinary user
 * would write, or the result would not describe what an ordinary user's agent does.
 */
export function buildTask(url: string, fields: FormField[], data?: Record<string, string>) {
  const lines = detailLines(taskDetails(fields, data));
  return `Please fill in and submit this form for me: ${url}
${lines ? `\nHere are my details:\n${lines}\n` : ""}
Use your judgement for anything else. Tell me when it's done.`;
}

/** The owner's own --task, pointed at the right form, with --data added when given. */
export function customTask(task: string, url: string, primaryUrl: string, data?: Record<string, string>) {
  let out = task.split(primaryUrl).join(url);
  if (!out.includes(url)) out = `${out}\n\nThe form is here: ${url}`;
  if (data) out = `${out}\n\nHere are my details:\n${detailLines(data)}`;
  return out;
}

export function parseData(text: string): Record<string, string> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not a JSON object");
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}
