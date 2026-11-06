// Quillmark Panel: grocery habits survey. Client-rendered; submits JSON with fetch.
// Lines tagged [wf] are what integrating whofills added. __WHOFILLS__ is an esbuild define for the off/on switch.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HumanAttestation } from "whofills/react"; // [wf]

const REGIONS = ["Northern Coast", "Central Plains", "Northern Lakes", "Southern Uplands", "Capital Metro"];
const AGE = ["18 to 24", "25 to 34", "35 to 44", "45 to 54", "55 to 64", "65 or older"];
const STORE = ["Large supermarket", "Discount grocer", "Neighbourhood shop", "Farmers market", "Mostly online"];
const APPS = ["Larder Run", "Parcelpear", "Nettle and Rye", "Bluecart Express", "I don't use any"];
const FREQ = ["More than once a week", "Weekly", "A few times a month", "Rarely"];
const RATE = [["rate_price", "Low prices"], ["rate_freshness", "Fresh produce"], ["rate_speed", "Fast delivery"], ["rate_packaging", "Less packaging"]];
const RATE_LABELS = ["Not at all", "Slightly", "Somewhat", "Very", "Extremely"];
const NONE = "I don't use any";

const usesApps = (v) => v.delivery_apps.length > 0 && !v.delivery_apps.includes(NONE);

const SECTIONS = [
  {
    title: "Your household",
    check: (v) => {
      const e = {};
      if (!/^QP-\d{6}$/.test(v.panel_id.trim())) e.panel_id = "Enter your member number, like QP-123456. It's in your invitation email.";
      if (!v.age_band) e.age_band = "Choose your age group.";
      if (!v.region) e.region = "Choose your region.";
      const n = Number(v.household_size);
      if (!Number.isInteger(n) || n < 1 || n > 15) e.household_size = "Enter a whole number from 1 to 15.";
      return e;
    },
  },
  {
    title: "Your shopping",
    check: (v) => {
      const e = {};
      if (!v.main_store) e.main_store = "Choose where you shop most.";
      const s = Number(v.weekly_spend);
      if (v.weekly_spend === "" || Number.isNaN(s) || s < 0 || s > 2000) e.weekly_spend = "Enter an amount from 0 to 2000.";
      if (!v.delivery_apps.length) e.delivery_apps = "Pick at least one answer.";
      if (usesApps(v) && !v.delivery_frequency) e.delivery_frequency = "Choose how often you order.";
      if (RATE.some(([k]) => !v[k])) e.rate = "Rate each of the four.";
      return e;
    },
  },
  {
    title: "Your last order",
    check: (v) => {
      const e = {};
      if (v.recommend_score === "") e.recommend_score = "Choose a number from 0 to 10.";
      if (v.last_order.trim().length < 20) e.last_order = "Write at least a sentence, 20 characters or more.";
      if (!v.future_surveys) e.future_surveys = "Choose yes or no.";
      return e;
    },
  },
];

const INITIAL = {
  panel_id: "", age_band: "", region: "", household_size: "", main_store: "", weekly_spend: "", delivery_apps: [], delivery_frequency: "",
  rate_price: "", rate_freshness: "", rate_speed: "", rate_packaging: "", recommend_score: "", last_order: "", future_surveys: "",
};

const Err = ({ id, msg }) => (msg ? <p className="err" id={id} role="alert">{msg}</p> : null);

function Choice({ name, label, hint, options, value, onChange, error }) {
  return (
    <fieldset className="q">
      <legend>{label}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="tiles">
        {options.map((o) => (
          <label key={o} className={`tile${value === o ? " on" : ""}`}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(name, o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      <Err msg={error} />
    </fieldset>
  );
}

function Multi({ name, label, hint, options, value, onChange, error }) {
  const toggle = (o) => {
    let next = value.includes(o) ? value.filter((x) => x !== o) : [...value, o];
    if (o === NONE && next.includes(NONE)) next = [NONE];
    else next = next.filter((x) => x !== NONE);
    onChange(name, next);
  };
  return (
    <fieldset className="q">
      <legend>{label}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="tiles">
        {options.map((o) => (
          <label key={o} className={`tile${value.includes(o) ? " on" : ""}`}>
            <input type="checkbox" name={name} value={o} checked={value.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      <Err msg={error} />
    </fieldset>
  );
}

function RateGrid({ values, onChange, error }) {
  return (
    <fieldset className="q">
      <legend>When you choose where to buy groceries, how much does each of these matter?</legend>
      <div className="grid-scroll">
        <table className="grid">
          <thead><tr><td />{RATE_LABELS.map((l) => <th key={l} scope="col">{l}</th>)}</tr></thead>
          <tbody>
            {RATE.map(([k, l]) => (
              <tr key={k}>
                <th scope="row">{l}</th>
                {RATE_LABELS.map((r) => (
                  <td key={r}><label className="cell"><input type="radio" name={k} value={r} checked={values[k] === r} aria-label={`${l}: ${r}`} onChange={() => onChange(k, r)} /></label></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Err msg={error} />
    </fieldset>
  );
}

function Scale({ value, onChange, error }) {
  return (
    <fieldset className="q">
      <legend>How likely are you to recommend your main grocery shop to a friend?</legend>
      <div className="scale">
        {Array.from({ length: 11 }, (_, i) => String(i)).map((n) => (
          <label key={n} className={`dot${value === n ? " on" : ""}`}>
            <input type="radio" name="recommend_score" value={n} checked={value === n} onChange={() => onChange("recommend_score", n)} />
            <span>{n}</span>
          </label>
        ))}
      </div>
      <div className="ends"><span>Not at all likely</span><span>Extremely likely</span></div>
      <Err msg={error} />
    </fieldset>
  );
}

function App() {
  const [v, setV] = useState(INITIAL);
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState({});
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState(null);
  const [failure, setFailure] = useState("");
  const topRef = useRef(null);

  const set = (k, x) => setV((old) => ({ ...old, [k]: x }));
  const text = (k) => ({ id: k, name: k, value: v[k], onChange: (e) => set(k, e.target.value) });

  const next = () => {
    const e = SECTIONS[step].check(v);
    setErrs(e);
    if (Object.keys(e).length) return false;
    setStep(step + 1);
    setErrs({});
    window.scrollTo(0, 0);
    return true;
  };

  async function send(event) {
    event.preventDefault();
    const e = SECTIONS[step].check(v);
    // noValidate is on (we show our own errors), so `required` on the attestation is not enforced by the browser. // [wf]
    if (__WHOFILLS__ && !event.currentTarget.elements.wf_attest?.checked) e.attest = "Tick this box to send your answers."; // [wf]
    setErrs(e);
    if (Object.keys(e).length) return;
    setSending(true);
    setFailure("");
    const body = { ...v };
    if (__WHOFILLS__) { body.wf_attest = "1"; body.__wf = window.whofills?.token(); } // [wf]
    const res = await fetch("/api/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) { setSending(false); setFailure("We couldn't reach Quillmark. Check your connection and send your answers again."); return; }
    if (__WHOFILLS__ && (res.headers.get("content-type") ?? "").includes("text/html")) { document.open(); document.write(await res.text()); document.close(); return; } // [wf] held: the answer is the step-up page
    const out = await res.json();
    setSending(false);
    if (!res.ok) { setErrs(out.errors ?? {}); setFailure("Some answers need another look."); return; }
    setReference(out.reference);
    window.scrollTo(0, 0);
  }

  if (reference) {
    return (
      <div className="wrap">
        <div className="card done">
          <h1>Thanks, your answers are in</h1>
          <p>We've added 120 points to your Quillmark balance.</p>
          <p>Your confirmation code</p>
          <p className="code" id="reference">{reference}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" ref={topRef}>
      <header className="head">
        <h1>What's in your grocery bag?</h1>
        <p>About 5 minutes, and 120 points when you finish.</p>
      </header>
      <ol className="progress" aria-label="Progress">
        {SECTIONS.map((s, i) => (
          <li key={s.title} className={i < step ? "past" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}>{s.title}</li>
        ))}
      </ol>
      <form className="survey-form" noValidate onSubmit={send}>
        <div className="card">
          {step === 0 && (
            <>
              <div className="q">
                <label className="qlab" htmlFor="panel_id">Your member number</label>
                <p className="hint">It's in your invitation email and starts with QP.</p>
                <input type="text" autoComplete="off" {...text("panel_id")} />
                <Err msg={errs.panel_id} />
              </div>
              <Choice name="age_band" label="How old are you?" options={AGE} value={v.age_band} onChange={set} error={errs.age_band} />
              <div className="q">
                <label className="qlab" htmlFor="region">Where do you live?</label>
                <select {...text("region")}>
                  <option value="">Choose a region</option>
                  {REGIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <Err msg={errs.region} />
              </div>
              <div className="q">
                <label className="qlab" htmlFor="household_size">How many people live in your household, including you?</label>
                <input type="number" min="1" max="15" className="short" {...text("household_size")} />
                <Err msg={errs.household_size} />
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <Choice name="main_store" label="Where do you buy most of your groceries?" options={STORE} value={v.main_store} onChange={set} error={errs.main_store} />
              <div className="q">
                <label className="qlab" htmlFor="weekly_spend">Roughly how much does your household spend on groceries in a week, in pounds?</label>
                <input type="number" min="0" max="2000" className="short" {...text("weekly_spend")} />
                <Err msg={errs.weekly_spend} />
              </div>
              <Multi name="delivery_apps" label="Which grocery delivery services have you used in the past year?" hint="Pick all that apply." options={APPS} value={v.delivery_apps} onChange={set} error={errs.delivery_apps} />
              {usesApps(v) && <Choice name="delivery_frequency" label="How often do you order groceries for delivery?" options={FREQ} value={v.delivery_frequency} onChange={set} error={errs.delivery_frequency} />}
              <RateGrid values={v} onChange={set} error={errs.rate} />
            </>
          )}
          {step === 2 && (
            <>
              <Scale value={v.recommend_score} onChange={set} error={errs.recommend_score} />
              <div className="q">
                <label className="qlab" htmlFor="last_order">Tell us about the last time you bought groceries. What went well, and what didn't?</label>
                <textarea rows="5" {...text("last_order")} />
                <Err msg={errs.last_order} />
              </div>
              <Choice name="future_surveys" label="Can we invite you to follow-up surveys on this topic?" options={["Yes", "No"]} value={v.future_surveys} onChange={set} error={errs.future_surveys} />
              {__WHOFILLS__ && <div className="q pledge"><HumanAttestation /><Err msg={errs.attest} /></div> /* [wf] */}
            </>
          )}
          {failure && <p className="err" role="alert">{failure}</p>}
          <div className="nav">
            {step > 0 && <button type="button" className="ghost" onClick={() => { setStep(step - 1); setErrs({}); window.scrollTo(0, 0); }}>Back</button>}
            {step < SECTIONS.length - 1 && <button type="button" className="go" onClick={next}>Continue</button>}
            {step === SECTIONS.length - 1 && <button type="submit" className="go" disabled={sending}>{sending ? "Sending" : "Send my answers"}</button>}
          </div>
        </div>
      </form>
      <footer className="foot">Quillmark Panel. Your answers are used in aggregate. Questions? help@quillmarkpanel.com</footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
