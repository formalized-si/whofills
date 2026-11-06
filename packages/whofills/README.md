# whofills

A form defence against AI agents, and a command that shows you whether real agents complete your form.

It adds one checkbox at the top of your form that a person can tick truthfully and an agent can't. The rest of the form stays locked until it is ticked.

It only works on agents that won't make a false statement. Some models tick it, and an agent told to get through may tick it too. Find out what happens on your own form:

```sh
npx whofills test https://your-site/apply --success "Application received"
```

## Add it to your form

```sh
npm i whofills
npx whofills init
```

`init` reads your `package.json` and prints two snippets for your framework. It writes nothing unless you say yes. The page snippet looks like this:

```html
<script src="/whofills.js" defer data-protect="form" data-attest="gate"></script>
```

The server snippet records a verdict next to each submission:

```js
import { createGuard } from "whofills/server";
const guard = createGuard({ secret: process.env.WHOFILLS_SECRET, mode: "tag" });

app.post("/apply", guard.express(), (req, res) => {
  save(req.body, req.whofills); // verdict: human, unsure or agent
  res.redirect("/thanks");
});
```

Each works without the other. `tag` mode changes nothing for anyone. If JavaScript is off or the script is blocked, the form works as before.

| Import | What it is |
|---|---|
| `whofills/whofills.js` | The browser script. Serve it from your own origin |
| `whofills/hold.js` | The step-up page script, for `hold` mode. Serve it at `/__wf/hold.js` |
| `whofills/server` | `createGuard`, with adapters for Express, `fetch` handlers and any other backend |
| `whofills/react` | `Whofills` and `HumanAttestation` |

[The integration guide](https://github.com/formalized-si/whofills/blob/main/docs/INTEGRATION.md) covers the other modes, forms that submit with `fetch`, and multi-step forms.

## Test your form

```sh
npx whofills test https://your-site/apply \
  --success "Application received" \
  --compare https://staging.your-site/apply-without-protection
```

It runs whichever agent CLIs you have (`claude`, `codex`) with Playwright MCP against the URL. Each run starts in an empty temporary directory with no special prompt. It needs Node 22 and Chrome.

**This submits real forms.** Use it only on forms you own. It asks you to confirm, or you can pass `--i-own-this-form`. It refuses big public sites and shared form hosts, with or without the flag. If your form lives on one, test a copy on your own domain. Every run can create a real submission and costs you agent usage.

The output looks like this. These numbers show the format and are not a result:

```
Agent   Form     Completed  Stopped  Unclear  No result  Stopped at
claude  with     0/3        3        0        0          at the attestation checkbox, with the form locked, before entering anything
claude  without  3/3        0        0        0

Verdict: without protection 3 of 3 runs completed the form. With protection, 0 of 3.
```

| Option | Meaning |
|---|---|
| `--success <text>` | Required. Text on the page, or part of its URL, that shows the form went through |
| `--i-own-this-form` | Skip the confirmation |
| `--agents <list>` | `claude`, `codex`, `claude:sonnet`, `codex:<model>:<effort>`. Default: every CLI found |
| `--runs <n>` | Runs per agent and form. Default 3, at most 20 |
| `--compare <url>` | The same form without protection |
| `--task <text>` | What to tell the agent. Default: a plain request built from the form |
| `--data <file>` | JSON object of label to value, given to the agent as its details |
| `--timeout <seconds>` | Per run. Default 240 |
| `--parallel <n>` | Runs at once, about 1 GB each. Default 1 |
| `--out <file>` | The JSON report. Default `whofills-report.json` |

`CLAUDE_BIN`, `CODEX_BIN` and `CHROME_BIN` override where each program is found. Exit code: 0 if at least one run decided, 2 if refused, 3 if no run decided.

### How to read it

| Outcome | Meaning |
|---|---|
| **Completed** | The success text or URL appeared in the agent's browser |
| **Stopped** | The agent finished without it. "Stopped at" says where it was |
| **Unclear** | Something was submitted or the page changed, but the success signal never appeared. Check `--success`. Not counted |
| **No result** | Rate limit, crash, time-out, or the agent never opened the form. Not counted, because it says nothing about your form |

The outcome comes from the browser and not from what the agent says. "Stopped at" says where the agent was when it stopped. It doesn't prove why. The terminal shows the agent's own words, which usually do.

### What it keeps

The report holds outcomes only: counts, stages, request method, path and status. It doesn't hold field values, query strings, request bodies or anything the agent said. Transcripts are read in memory and dropped, and the agent's working directory is deleted after each run. The agent's words in the terminal have typed values, addresses and phone numbers removed on a best-effort basis, and they are never written to the report.

Your own server does receive what the agents submit. Delete those test submissions afterwards.

### What it doesn't show

- Only the agents on your machine, through Playwright MCP. Claude in Chrome, ChatGPT Atlas, Comet and Gemini may behave differently.
- A few runs on one day. Models change, and a small sample can miss what an agent does some of the time.
- A plain request. A user who orders their agent through may get a different result: try it with `--task`.
- Forms in an iframe are not read, and page text inside one is not checked for `--success`.
- It doesn't check that you own the host. The refusal list catches obvious mistakes, nothing more.

## Read your numbers

In `tag` mode, store each decision and summarize the file. Store the decision only, not the form's fields:

```js
appendFileSync("decisions.jsonl", JSON.stringify(req.whofills) + "\n");
```

```sh
npx whofills summarize decisions.jsonl
```

This prints the share of `agent`, `unsure` and `human` verdicts, how many ticked the attestation, and the signals seen. Add `--json` for machine-readable output, or read from stdin with `-`.

These are the detector's verdicts, not facts. Its false positive rate on real people is unknown. Look through a sample by hand before you switch to `hold`, and never run holds without a fallback that really works: see the [integration guide](https://github.com/formalized-si/whofills/blob/main/docs/INTEGRATION.md).

## Limits

- A person's checkbox click may have a cost in form completion. It hasn't been measured on real people.
- Client-side signals can be forged. A tool built against this library gets through.
- This doesn't establish identity. Where identity matters, use identity verification.

Published numbers and method are in [RESULTS](https://github.com/formalized-si/whofills/blob/main/docs/RESULTS.md).

## License

MIT
