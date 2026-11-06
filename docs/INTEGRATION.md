# Integrating whofills

Two steps: one script tag in the page, one call on the server. Each step works without the other. Start in tag mode,
read your numbers, then turn on holds.

## 1. Add the script

Serve `whofills.js` from your own origin and add it to pages with a form you want to protect.

```html
<script src="/whofills.js" defer data-protect="form.application" data-attest="declare"></script>
```

| Attribute | Values | Default | Effect |
|---|---|---|---|
| `data-protect` | CSS selector | `form[data-wf-protect]` | Which forms to protect |
| `data-attest` | `declare`, `gate`, `check`, `visible`, `ambient`, or leave out | off | Adds the question or the attestation checkbox. See below |
| `data-attest-text` | your wording | built-in, by page `lang` | The clause. It has to stay true for people and false for agents |
| `data-attest-ask` | present or absent | absent | With `gate`, adds one small line asking agents not to fill in the form. It made no measurable difference in our runs |
| `data-notice` | text | none | A short factual notice for agents, kept out of the accessibility tree |

With `declare` the form gets the question "Who is filling in this form?" with "Me, personally" already chosen, so a person
has nothing to do. Frontier agents change the answer to "An AI agent or automated tool". It is there from the start,
because an agent that read the form before it appeared would never see it. In hold mode the server gives the form back
with a plain explanation when the answer is "agent"; read the answer as `req.whofills.declared` (`self`, `other` or `agent`).
This needs the server call: without it, the answer is only recorded.

With `gate` the checkbox is there from the start, the same for everyone including crawlers, and the rest of the form is locked until it is ticked. With JavaScript off or the script blocked, the form is not locked. The line shifted the page by a CLS of about 0.014 in our test, well inside the 0.1 Google counts as good; render the label in your own HTML to avoid even that. The other modes add nothing until the first input in a protected form.

### Which one?

Use `declare` if you can add the server call: it costs a person nothing, and in our runs 36 of 36 frontier agents answered
honestly and got the form back. Use `gate` if you cannot: it needs no server, and agents stop before entering anything.

| | `gate` | `check` | `visible` | `ambient` |
|---|---|---|---|---|
| What a person sees | One compact checkbox first: "I'm filling this in myself, not an AI agent". Fields unlock when ticked | The same line, at the end, after the first input | A checkbox with the full clause | A checkbox saying "I confirm that my answers are accurate" on a light row |
| Where an agent stops | Before entering anything | After filling in the form | After filling in the form | After filling in the form |
| Holds up as a signed statement | Short, but on record | Short, but on record | Yes | No: treat it as a signal, because a sighted person is not shown the clause |
| Use it when | Almost always: this is the default | The page must stay identical until someone types | Your legal team wants the full wording | The form must look unchanged |

If your form already has a certification, add the clause to your own markup instead:

```html
<label><input type="checkbox" name="wf_attest" value="1" required>
  I filled in this form myself, and no AI agent or automated tool entered these answers on my behalf.
  Assistive technology is fine.</label>
```

Keep the clause about who entered the answers. A clause that forbids spell-check or dictation would be false for honest people.

## 2. Check on the server

The script posts one extra field, `__wf`, with aggregate behaviour numbers. No keystrokes, no coordinates.

**Express** (`app.use(express.urlencoded({ extended: false }))` first):

```js
import { createGuard } from "whofills/server";
const guard = createGuard({ secret: process.env.WHOFILLS_SECRET, mode: "tag" });

app.post("/apply", guard.express(), (req, res) => {
  // req.whofills.verdict is { verdict: "human" | "unsure" | "agent", score, signals }, or null if the script did not run
  // req.body has the guard's own fields removed
  saveApplication(req.body, req.whofills);
  res.redirect("/thanks");
});
```

**Next.js route handler, Cloudflare Workers, Deno, Bun:**

```js
const result = await guard.fetch(request);
if ("response" in result) return result.response; // held: this is the step-up page
await saveApplication(result.fields, result.verdict);
```

**Any other backend:** `guard.check(path, fieldsObject)` returns `{ action: "pass", verdict }` or `{ action: "hold", html }`.

**No backend change at all:** put the [Cloudflare Worker](../examples/cloudflare-worker/worker.js) in front of the site.

Serve `hold.js` at `/__wf/hold.js`, or pass `holdScript` to `createGuard`.

**Forms that submit with `fetch` (typical in React and Vue):** the hidden field is added on the native `submit` event, so it
only travels in `FormData(form)` built after that event. If you build your own JSON body, add it yourself, and let the
library show the step-up page when the server answers 428:

```js
const res = await fetch("/apply", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...values, __wf: window.whofills?.token() }) });
if (await window.whofills?.handle(res)) return; // held: the step-up page is now on screen
```

The step-up page re-posts as an ordinary urlencoded form, so that route has to accept urlencoded as well as JSON.
`guard.fetch` and `guard.check` take both.

**Multi-step forms:** put the attestation on the last step by rendering it yourself (`HumanAttestation` in React, or the
HTML above) and leave `data-attest` off. `data-attest` adds its checkbox to whatever step is showing at the first input.

**Recording the attestation:** the guard strips `wf_attest` from the fields. Read it from the decision: `req.whofills.attested`
on Express, `result.attested` from `guard.fetch` and `guard.check`. It stays correct after a solved step-up.

**Options worth knowing:** `holdMissing: true` also holds submissions with no token. Off by default, because a person with
JavaScript off or the script blocked has no token either. Turn it on if your form needs JavaScript anyway, as a single-page
app does, or if `fallbackHtml` leads somewhere that works. While it is off, a raw POST skips the sensor.
`createGuard` throws at start-up without a secret of at least 16 characters.

## 3. Roll out

| Week | Setting | Do |
|---|---|---|
| 1 | `mode: "tag"` | Store the verdict next to each submission. Nothing changes for anyone |
| 2 | Same | Read the share of `agent` verdicts with `whofills summarize decisions.jsonl` ([example](../examples/tag-report/server.mjs)), and look through a sample by hand |
| 3 | `mode: "hold"` | Agents get the step-up page. Keep the fallback contact staffed |

## What a person sees if they are held by mistake

One page: "This step has to be completed by a person", moving digits, a text box. Their answers are kept. There is
a fallback for people who cannot use it. Set `fallbackHtml` to a route that really works, such as a support address or an
emailed link. **Never run holds without one**: this is a WCAG 3.3.8 and ADA matter, not just good manners.

A form with a file upload cannot be replayed from the hold page, so it is never held: it passes with the verdict and
`unheld: true`. If that matters, put the attestation and the hold on a step before the upload.

## Limits you should know

- Client-side numbers can be forged by someone targeting you. This stops agents people use day to day, not a dedicated attacker.
- Cheap open-weight models tick the attestation. They are what the notice and the behavioural layer are for.
- An explicit instruction from the user gets through on some models. See [RESULTS](RESULTS.md) for current numbers.
