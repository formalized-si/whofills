> **Status.** Written against an early build, from the docs alone. All of the library bugs listed here have since been fixed: field types on the hold path, missing secret, JSON and multipart handling, repeated fields, the readable digit mask, ticket reuse, and the recording of the attestation. The docs gaps were filled too. Kept as written, since it is what the integration was like.

# whofills integration report

Feedback from building three sites using only `docs/INTEGRATION.md`, `examples/` and `packages/whofills/dist/`.

**Bottom line:** the plain-form path is as easy as promised. The docs' "two steps" hold for one urlencoded form with no repeated fields. Everything else in these three sites needed code the docs don't mention, and the worst bugs only appear on the hold path, so a developer's normal testing won't find them. No synthetic human-paced run was held.

## What was and wasn't verified

Verification stopped early at the coordinator's request because of time and memory. The table separates what ran on the final driver from what didn't.

| Run | grant-portal | panel-survey | scholarship |
|---|---|---|---|
| `off`, scripted | Pass | Pass | Pass |
| `robot`: held, passes hold, replay logged | Pass | Pass | Pass |
| `human-nowd` (webdriver false) | **Pass on fixed driver**: not held, valid `submit_ok`, verdict `human`, score 0, 89 s | Old driver only: not held, `submit_ok` arrived, verdict `human`, **one field wrong** | Old driver only: not held, `submit_ok` arrived, verdict `human`, **one field wrong** |
| `human` (webdriver true) | Old driver only: step 1 not held, verdict `unsure`, **no `submit_ok`** | Old driver only: not held, `submit_ok` arrived, verdict `unsure`, **one field wrong** | Old driver only: not held, `submit_ok` arrived, verdict `unsure`, **one field wrong** |

What the failures mean:

- **Wrong fields were caused by my driver, not the library.**
  - Panel: `household_size` was typed as 4 and arrived as 1. The driver scrolled with the pointer over the focused number input. Chrome changes the value with or without any script on the page (`number-wheel-probe.mjs`: 40 became 37 with no script, with whofills, and with a bare wheel listener).
  - Scholarship: `date_of_birth` arrived as `2004-09-06`. This Chrome orders date segments dd.mm whatever Playwright's locale says, and the driver typed mm/dd.
- **Both driver bugs are fixed, but the fix was only re-run on `grant-portal` `human-nowd`.** The other human-paced runs were not repeated, so a fully valid human-paced submission is confirmed on one site only. On the other two, "not held and arrives in `LOG`" is confirmed, but the full `validate` set is not.
- **The grant-portal old-driver failure has no established cause.** The final POST never reached the server in either old-driver run, and those runs had no diagnostics. The same flow passed once the driver was fixed, which suggests a driver problem but doesn't prove it. `grant-portal` `human` (webdriver true) never completed end to end.
- **Later edits:** `robot` and `off` on grant-portal, and `robot` on panel-survey, ran before small later edits (a CSS height, a CSS class rename, comments). Those runs were not repeated.

Limits of this evidence:

- **No real person used these sites.** "Human-paced" means synthetic Bezier mouse paths and log-normal key gaps. This shows the sites aren't held under that driver. It says nothing about false positives on real people, dictation, or assistive technology.
- **The webdriver-true runs have little margin.** They score 0.6 from `webdriver` alone, and from reading the scoring in dist, any pointer or keyboard signal would add a second group and flip the verdict to `agent`.
- **Not tested:** production HTTPS, a CSP, non-English pages, phones, the Cloudflare and Next.js paths in a real runtime.

## Lines added

Counted from the `[wf]` tags in the source (`grep -c '\[wf\]'`, minus the header comment). Lines needed only for the `WHOFILLS` switch are counted separately.

| Site | Integration lines | Switch-only lines | App lines around them |
|---|---|---|---|
| grant-portal | **30** | 4 | 218-line server |
| panel-survey | **26** (20 server, 6 client) | 3 | 139-line server, 278-line client |
| scholarship | **18** | 7 | 106-line server, 131-line page |

For comparison, the docs' Express path is about 6 lines: script tag, import, `createGuard`, route argument, two static routes.

**grant-portal (30)**
- 1 import, 6 guard setup with `fallbackHtml`, 2 serving the scripts.
- 4 for the script tag and per-page attestation choice.
- 13 for a `protect()` wrapper: detects holds, reads the attestation before the guard strips it, remembers a passed person across steps, records the verdict.
- 2 flattening repeated checkboxes (workaround for bug 1).
- 2 route arguments.

**panel-survey (26)**
- Server: 1 import, 5 guard setup, 2 reading the scripts, 1 script tag, 2 flattening JSON (bug 1), 1 accepting urlencoded on a JSON endpoint, 4 check, hold, verdict and strip, 2 extra HTML pages for hold replays, 2 routes.
- Client: 1 import, 1 comment, 1 attestation check, 1 token in the body, 1 `document.write` of the hold page, 1 rendering `HumanAttestation`.

**scholarship (18)**
- 1 import, 5 guard setup, 2 reading the scripts, 3 page edits, 3 check, hold and verdict, 1 certification rule, 1 strip, 2 routes.
- On a real site the 3 page edits would be one new script line and one edited checkbox line.

Some lines are partly for this project's contract: the `held` log lines, and the fallback for `WHOFILLS_SECRET`, which the contract doesn't set.

## Bugs

Reproduce 1 to 5 with `node bench/heldout/library-probes.mjs`.

### 1. The hold page throws on any non-string field (high)

`check()` throws `TypeError: s.replace is not a function` when it builds the hold page and any field is an array, number or boolean. Clean submissions pass, so **it only fails when someone is about to be held**: that person gets a 500 instead of the step-up page.

Express gives arrays for repeated checkboxes even with the docs' `extended: false`, and the docs' JSON advice produces numbers and arrays. All three sites flatten values before the guard.

### 2. `guard.fetch` passes JSON and multipart bodies with no check (high)

It always parses the body as URL-encoded. A JSON body with an agent token returns `{verdict: null}` and passes in hold mode, with no error. The same happens for multipart.

The docs recommend `guard.fetch` for Next.js and tell React developers to send JSON, so following both gives **no protection and no warning**. I avoided it by using `guard.check`.

### 3. `guard.fetch` silently loses repeated fields (high)

`c=1&c=2&c=3` comes back as `{"c":"3"}`. This is data loss in the customer's own form, in every mode.

### 4. A missing secret only fails at the first hold (high)

`createGuard({ mode: "hold" })` succeeds and clean submissions pass. The first hold then throws. An unset env var therefore goes unnoticed in tag mode and in testing, then breaks in production at the worst moment. It should throw at startup.

### 5. Hold tickets are weak (medium for this threat model)

- **The answer ships in the page.** `data-mask` is the digit bitmap, and 10 lines of code read it with no canvas or vision. My verification scripts do exactly this.
- **Tickets are reusable.** A solved ticket passed again for a second submission and on a different path with different answers. It isn't bound to the fields or path, and nothing records that it was used. Expiry is the only limit.

The docs do say a dedicated attacker isn't the target, but these undercut the claim that the hold page needs a person.

### 6. Attestation injection breaks on a paged form (medium)

With `data-attest="visible"` on my three-page React form (`verify.mjs attest-probe`, `shot-attest-probe.png`):

- The checkbox appears on **page 1**, because no submit button exists yet and it falls back to the end of the form.
- It sits outside the card, jammed against the card's shadow.
- It's still in the DOM on page 3.
- Adding `<HumanAttestation />` as well gives **two checkboxes**.

So the panel survey leaves out `data-attest` and uses the React component. The injected label also lands inside whatever element holds the submit button, which on grant-portal is my `.actions` flex row. I didn't review how that looks.

### 7. Smaller

- `docs/RESULTS.md`, linked from "Limits you should know", **doesn't exist**.
- `dist/` has no `.d.ts`, yet the Next.js example is TypeScript.
- The attestation is localised by page `lang`, but the hold page is hard-coded English, with `lang="en"`.
- Forms that mount late are bound on a 200 ms debounce. In my probe, a focus right after mount didn't inject the checkbox.

## Gaps in the docs

1. **No install or file location.** "Serve `whofills.js` from your own origin" gives no package name or path. I found `import.meta.resolve("whofills/whofills.js")` by copying the import in the Worker example.
2. **Hold on `fetch` forms isn't covered, and this was the biggest job.** The docs explain how to send the token, then stop. They don't say:
   - what the client should do with hold HTML (I used `document.write`);
   - that the hold page replays as a **native urlencoded POST** to your JSON endpoint, so it must accept both formats;
   - that a successful replay must return a full HTML page, because the SPA's success screen never runs.
3. **Attestation can't be recorded the way the docs imply.** The docs say `visible` "holds up as a signed statement" for legal teams, but:
   - the guard strips `wf_attest`, and `req.whofills` doesn't include it, so on Express you must read it before the middleware;
   - `guard.fetch` doesn't return it either;
   - `check()` returns `attested` on a normal pass but **not after a hold replay**, so `if (!d.attested) reject` would turn away every person who solved the hold. I read the raw field instead.
4. **Nothing on `noValidate`.** The clause relies on the browser enforcing `required`. React forms with their own validation commonly set `noValidate`, which removes that, and nothing on the server enforces it. I added a client check.
5. **Nothing on multi-step forms.**
   - The recorder resets on each page load, so each token covers only its own page.
   - The docs don't say which step to guard, where the attestation belongs, or whether a person who passed should be challenged again.
   - My choices: guard both steps, attest on the last, and don't challenge twice. These are my judgement, not documented practice.
6. **"Add the clause to your own markup" is ambiguous.** Do I add a second checkbox, or merge it with the existing certification? Must the field be named `wf_attest`? Should `data-attest` be left out? I merged them and renamed the field, which also meant changing the site's own server rule. In dist, `data-attest` makes no difference when the field exists, but the docs don't say so.
7. **Undocumented options and exports found only by reading dist:**
   - `holdAt`, `holdMissing` and `ttl`;
   - `data-channels`;
   - `stripGuardFields`, which `guard.check` users need because `check` returns no cleaned fields;
   - `passed` and `attested`;
   - `window.whofills.features()` and `score()`.

   `holdMissing` matters most: without it, **a submission with no `__wf` passes in hold mode**, so simply not sending the token avoids the behavioural check. The docs should state this and the trade-off. I kept the default because I can't judge the cost to people whose script fails to load.
8. **No hold visibility.** There's no `onHold` callback, and holds return status 200, so monitoring can't see them. On Express I detect a hold by noticing `next()` wasn't called. Week 2 of the rollout asks you to read verdicts, but no metric covers week 3.
9. **React helpers are barely documented.** They appear only in a comment in the Next.js example, and that example uses a native POST, so there is **no React plus `fetch` example**. `Whofills` also has no `notice` or `attest` props, so I used a plain script tag for the notice.
10. **No guidance on `data-notice` wording,** though the Limits section says open-weight models are what it's for. I wrote my own.
11. **No guidance on middleware order.** I put the guard before CSRF so a held POST doesn't consume anything. Docs should mention single-use tokens.
12. **The hold page can't be styled.** It looks generic next to all three of my designs. It also carries inline styles, which a strict CSP may block (not tested).

## What was good

- The script tag, `guard.express()` and `guard.check()` all worked first time for the normal path.
- Hold replay kept answers correctly in all three stacks, including my CSRF field and flattened values.
- `fallbackHtml` was simple and renders correctly.
- The `off` paths stayed clean: no whofills requests on any site, and esbuild's define removed the clause from the survey bundle.

## Time

I didn't time myself, so this is a ranking rather than hours.

1. The SPA's hold round trip.
2. Working out the attestation for the paged form.
3. Multi-step guard decisions and detecting holds on Express.
4. Most of my debugging time went on my own verification driver, not the library.

## Test validity notes

- **Reading dist affects this report.** I read `dist/` before building, as allowed. Bugs 1 to 5 and gap 7 came from there. A developer with only the docs would have shipped bugs 1 and 4 without knowing, so "easy to integrate" is more generous than the real experience.
- **Boundary slip.** An early probe wrote `bench/.probe-tmp.mjs`, outside `bench/heldout/`. I deleted it within the same command. The script only called the library.
- **Unintended file names seen.** A `git status --short` showed 4 changed or new paths under `bench/` and `tests/`. They aren't mine, and I didn't open them. I read no git history, `src/`, `tests/`, `README.md` or `package.json`.
- **No workaround touched library files.** All of them are in the site code.
