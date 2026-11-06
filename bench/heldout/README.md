# Held-out sites

Three small apps protected with whofills, built from `docs/INTEGRATION.md`, `examples/` and `packages/whofills/dist/` only.
Feedback on the integration is in [INTEGRATION-REPORT.md](INTEGRATION-REPORT.md).

| Site | Organisation (fictional) | Stack | Form shape | Path |
|---|---|---|---|---|
| `grant-portal` | Tallowbrook Community Foundation | Express, server-rendered | Two-page wizard, urlencoded | `/apply` |
| `panel-survey` | Quillmark Panel | React SPA, plain `http`, esbuild at startup | Three client-side pages, `fetch` + JSON | `/survey` |
| `scholarship` | The Halloran-Pike Scholarship Trust | Static HTML, plain `http` | One long form with its own certification, urlencoded | `/apply` |

## Run

From the repo root:

```sh
PORT=4101 LOG=/path/to/log.jsonl WHOFILLS=on node bench/heldout/<site>/server.mjs
```

`WHOFILLS=off` serves the plain site. `WHOFILLS=on` protects it with server mode `hold`. The server prints `ready` once listening on 127.0.0.1.

`LOG` receives `{"type":"form_view"}`, `{"type":"held"}` and `{"type":"submit_ok","fields":{...}}`. Verdicts go to stderr as lines starting `whofills`, so the log stays to the contract. `WHOFILLS_SECRET` is honoured if set; otherwise each process generates its own.

`manifest.json` in each site holds the host, path, task text and validation substrings.

## Verify

```sh
node bench/heldout/<site>/verify.mjs                 # off, robot, human, human-nowd
node bench/heldout/<site>/verify.mjs off robot shots # the fast ones, plus screenshots
node bench/heldout/panel-survey/verify.mjs attest-probe
node bench/heldout/library-probes.mjs                # library behaviour quoted in the report
```

| Run | What it does | Pass means |
|---|---|---|
| `off` | Scripted fill, `WHOFILLS=off` | One valid `submit_ok`, no whofills requests |
| `human` | Mouse paths and typed keys at human speed, `navigator.webdriver` true (Playwright's default) | One valid `submit_ok`, zero `held` |
| `human-nowd` | Same, with `navigator.webdriver` false | One valid `submit_ok`, zero `held` |
| `robot` | Scripted fill, expected to be held, then passes the hold | `held` logged, then one valid `submit_ok` after replay |

`human.mjs` is copied into each site's dir on purpose, so each site stands alone.

To count the integration lines: `grep -c '\[wf\]' <file>` (subtract 1 for the header comment that explains the tag).
