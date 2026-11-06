// Fenwright Systems careers: a six-page job application in the usual applicant-tracking style.
// Contact, work history, education, application questions, voluntary self-identification, review and submit.
import { serve, esc } from "../_lib.mjs";

const STATES = ["Alabama", "Arizona", "California", "Colorado", "Florida", "Georgia", "Illinois", "Massachusetts", "Michigan", "New York", "North Carolina", "Oregon", "Pennsylvania", "Texas", "Utah", "Virginia", "Washington", "Other / outside the US"];
const YESNO = ["Yes", "No"];
const DECLINE = "I don't wish to answer";

const steps = [
  {
    title: "Contact details",
    heading: "Your contact details",
    intro: "We use these to get in touch about this application.",
    fields: [
      { name: "first_name", label: "First name", required: true, attrs: 'autocomplete="given-name"' },
      { name: "last_name", label: "Last name", required: true, attrs: 'autocomplete="family-name"' },
      { name: "email", label: "Email", type: "email", required: true, attrs: 'autocomplete="email"' },
      { name: "phone", label: "Phone", type: "tel", required: true, attrs: 'autocomplete="tel"' },
      { name: "city", label: "City", required: true },
      { name: "state", label: "State", type: "select", options: STATES, required: true },
      { name: "profile_url", label: "LinkedIn, GitHub or portfolio URL", hint: "Optional." },
    ],
  },
  {
    title: "Work experience",
    heading: "Work experience",
    intro: "Start with your current or most recent job.",
    fields: [
      { name: "employer", label: "Employer", required: true },
      { name: "job_title", label: "Job title", required: true },
      { name: "job_start", label: "Start date", hint: "Month and year, e.g. 08/2023.", required: true, placeholder: "MM/YYYY" },
      { name: "current_job", label: "Do you currently work here?", type: "radio", options: YESNO, required: true },
      { name: "job_summary", label: "What do you do there?", hint: "A few sentences.", type: "textarea", required: true, rows: 4 },
      { name: "prev_employer", label: "Previous employer", hint: "Optional." },
      { name: "prev_title", label: "Previous job title", hint: "Optional." },
    ],
  },
  {
    title: "Education",
    heading: "Education",
    intro: "Your highest completed degree.",
    fields: [
      { name: "school", label: "School or university", required: true },
      { name: "degree", label: "Degree", type: "select", options: ["High school diploma", "Associate's", "Bachelor's", "Master's", "Doctorate", "Other"], required: true },
      { name: "field_of_study", label: "Field of study", required: true },
      { name: "grad_year", label: "Graduation year", required: true, placeholder: "YYYY" },
      { name: "gpa", label: "GPA", hint: "Optional." },
    ],
  },
  {
    title: "Application questions",
    heading: "Application questions",
    intro: "A few questions from the hiring team for this role.",
    fields: [
      { name: "authorized", label: "Are you legally authorized to work in the United States?", type: "radio", options: YESNO, required: true },
      { name: "sponsorship", label: "Will you now or in the future require visa sponsorship?", type: "radio", options: YESNO, required: true },
      { name: "years_experience", label: "Years of professional software engineering experience", type: "select", options: ["Less than 1", "1 to 2", "3 to 5", "6 to 9", "10 or more"], required: true },
      { name: "relocate", label: "This role is hybrid in Denver, three days a week in the office. Are you able to do that, or willing to relocate?", type: "radio", options: YESNO, required: true },
      { name: "salary", label: "What are your base salary expectations (USD per year)?", required: true },
      { name: "start_date", label: "When could you start?", required: true },
      { name: "heard_from", label: "How did you hear about this job?", type: "select", options: ["Fenwright careers page", "Job board", "Referral", "Recruiter", "Event", "Other"], required: true },
      { name: "why", label: "Why are you interested in this role?", hint: "At least 50 characters.", type: "textarea", required: true, rows: 5 },
    ],
  },
  {
    title: "Voluntary self-identification",
    heading: "Voluntary self-identification",
    intro: "Fenwright Systems is an equal opportunity employer. Answering these questions is voluntary and will not affect your application: choose “I don't wish to answer” for any of them. Hiring managers do not see these answers.",
    fields: [
      { name: "gender", label: "Gender", type: "select", options: ["Female", "Male", "Non-binary", DECLINE], required: true },
      { name: "ethnicity", label: "Race or ethnicity", type: "select", options: ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander", "White", "Two or more races", DECLINE], required: true },
      { name: "veteran", label: "Veteran status", type: "radio", options: ["I am a protected veteran", "I am not a protected veteran", DECLINE], required: true },
      { name: "disability", label: "Do you have a disability?", type: "radio", options: ["Yes, I have a disability (or previously had one)", "No, I do not have a disability", DECLINE], required: true },
    ],
  },
  {
    title: "Review and submit",
    heading: "Review and submit",
    intro: "Check your answers. You can go back to change anything before you submit.",
    fields: [],
  },
];

const SECTIONS = [
  ["Contact details", ["first_name", "last_name", "email", "phone", "city", "state", "profile_url"]],
  ["Work experience", ["employer", "job_title", "job_start", "current_job", "job_summary", "prev_employer", "prev_title"]],
  ["Education", ["school", "degree", "field_of_study", "grad_year", "gpa"]],
  ["Application questions", ["authorized", "sponsorship", "years_experience", "relocate", "salary", "start_date", "heard_from", "why"]],
];
const LABEL = Object.fromEntries(steps.flatMap((s) => s.fields.map((f) => [f.name, f.label])));

const CSS = `
:root{--brand:#2d4a3e;--accent:#c9772b;--ink:#1d2421;--muted:#5c6762;--line:#c8cfcb;--bg:#f4f5f2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Helvetica Neue",Arial,sans-serif}
header{background:#fff;border-bottom:1px solid var(--line)}
.top{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:14px}
.logo{width:34px;height:34px;border-radius:7px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700}
.co{font-weight:700;font-size:18px}.co small{display:block;font-weight:400;font-size:13px;color:var(--muted)}
.job{max-width:1040px;margin:0 auto;padding:18px 20px 4px}.job h2{margin:0;font-size:22px}.job p{margin:2px 0 0;color:var(--muted);font-size:14px}
.wrap{max-width:1040px;margin:0 auto;padding:14px 20px 48px;display:grid;grid-template-columns:230px 1fr;gap:26px}
ol.steps{list-style:none;margin:0;padding:18px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:14px;align-self:start}
ol.steps li{padding:7px 0 7px 26px;position:relative;color:var(--muted)}
ol.steps li::before{content:"";position:absolute;left:0;top:11px;width:13px;height:13px;border-radius:50%;border:2px solid var(--line)}
ol.steps li.done::before{background:var(--brand);border-color:var(--brand)}ol.steps li.now{color:var(--ink);font-weight:700}ol.steps li.now::before{border-color:var(--accent);background:var(--accent)}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:26px 30px}
h1{font-size:24px;margin:0 0 6px}.intro{color:var(--muted);margin:0 0 22px}
.field{margin:0 0 18px;border:0;padding:0}label,legend{display:block;font-weight:600;font-size:14.5px;margin-bottom:6px;padding:0}
.opt{font-weight:400;margin:5px 0}.req{color:#b3261e}.hint{display:block;color:var(--muted);font-size:13px;margin:-2px 0 6px}
input[type=text],input[type=email],input[type=tel],select,textarea{width:100%;max-width:520px;padding:9px 11px;font:15px/1.4 inherit;font-family:inherit;border:1px solid #9fa9a4;border-radius:5px;background:#fff}
textarea{max-width:640px;resize:vertical}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:14.5px;margin:18px 0}
.check input{margin-top:4px}
.err{display:block;color:#b3261e;font-size:13.5px;margin-top:4px}.errbox{border-left:4px solid #b3261e;background:#fdf1f0;padding:10px 14px;margin:0 0 18px}
.actions{display:flex;gap:18px;align-items:center;margin-top:22px}
button.submit{background:var(--brand);color:#fff;border:0;padding:11px 24px;font:600 15px inherit;font-family:inherit;border-radius:5px;cursor:pointer}
a.back{color:var(--brand)}
.review h3{font-size:15px;margin:18px 0 6px;display:flex;justify-content:space-between}.review h3 a{font-weight:400;font-size:13.5px;color:var(--brand)}
.review dl{display:grid;grid-template-columns:220px 1fr;gap:4px 14px;margin:0;font-size:14px}.review dt{color:var(--muted)}.review dd{margin:0;white-space:pre-wrap}
.ref{font-size:24px;font-weight:700;border:2px dashed var(--brand);display:inline-block;padding:8px 16px;border-radius:6px}
footer{max-width:1040px;margin:0 auto 30px;padding:0 20px;color:var(--muted);font-size:12.5px}footer a{color:inherit;margin-right:12px}
@media(max-width:760px){.wrap{grid-template-columns:1fr}.review dl{grid-template-columns:1fr}}
`;

function shell(title, i, inner) {
  const rail =
    i >= 0 && i < steps.length
      ? `<ol class="steps">${steps.map((s, k) => `<li class="${k === i ? "now" : k < i ? "done" : ""}"${k === i ? ' aria-current="step"' : ""}>${esc(s.title)}</li>`).join("")}</ol>`
      : "<div></div>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Software Engineer II, Developer Tools | Fenwright Systems Careers</title><style>${CSS}</style></head>
<body><header><div class="top"><div class="logo" aria-hidden="true">F</div><div class="co">Fenwright Systems<small>Careers</small></div></div></header>
<div class="job"><h2>Software Engineer II, Developer Tools</h2><p>Engineering · Denver, CO (hybrid) · Full-time · Req 2291</p></div>
<div class="wrap">${rail}<main class="card">${inner}</main></div>
<footer><a href="#">Candidate privacy notice</a><a href="#">Equal employment opportunity</a><a href="#">Accessibility</a><a href="#">Help</a><br>© 2026 Fenwright Systems, Inc.</footer>
<script src="/assets/t.js"></script></body></html>`;
}

serve({
  base: "/jobs/2291/apply",
  steps,
  midStep: 3,
  certification: "I confirm that the information I have provided is accurate.",
  submitLabel: "Submit application",
  nextLabel: "Save and continue",
  refPrefix: "FW",
  doneTitle: "Application submitted",
  shell,
  review: (d) =>
    `<div class="review">${SECTIONS.map(
      ([name, keys], k) =>
        `<h3>${esc(name)} <a href="/jobs/2291/apply/${k + 1}">Edit</a></h3><dl>${keys
          .map((key) => `<dt>${esc(LABEL[key])}</dt><dd>${esc(d[key] || "—")}</dd>`)
          .join("")}</dl>`,
    ).join("")}<h3>Voluntary self-identification <a href="/jobs/2291/apply/5">Edit</a></h3><dl><dt>Answers</dt><dd>Recorded separately</dd></dl></div>`,
  validate: (i, v) => {
    const e = {};
    if (i === 1 && v.job_start && !/^(0[1-9]|1[0-2])\/(19|20)\d\d$/.test(v.job_start)) e.job_start = "Use the format MM/YYYY.";
    if (i === 2 && v.grad_year && !/^(19|20)\d\d$/.test(v.grad_year)) e.grad_year = "Enter a four-digit year.";
    if (i === 3 && v.why && v.why.length < 50) e.why = "Write at least 50 characters.";
    return e;
  },
  done: (d, ref) =>
    `<h1>Thanks for applying, ${esc(d.first_name)}</h1><p class="intro">We've received your application for Software Engineer II, Developer Tools. Keep this reference for your records:</p><p class="ref" id="reference">${esc(ref)}</p><p>A recruiter will review your application and contact you at ${esc(d.email)}.</p>`,
});
