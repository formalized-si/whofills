# Bench

Runs real agents against test sites. The site's log decides the outcome.

```sh
npm run bench -- --round demo \
  --agents claude:pw:sonnet,codex:pixel:gpt-6.1-terra:low \
  --scenarios phd --conditions none+nc,attest+nc,sdk_full+nc --n 3 --parallel 2
```

**To try an idea, use the fast loop:** `npm run quick -- sdk_gate`. It runs two DOM agents plus a baseline, and takes about a minute. The sample is too small to publish.

Needs Chrome, and the `claude` and `codex` CLIs for those agents. `CODEX_BIN` overrides the Codex path. Each run costs about 1 GB across the client, MCP server and browser; workers wait when memory is low.

| Argument | Values |
|---|---|
| `--agents` | `claude\|codex:pw\|pixel\|pixeljpeg:<model>[:effort]`; `oss:pw:<model>` and `browseruse:<model>:<vision>` need `OLLAMA_API_KEY`. In Ollama tags write `~` for `:` |
| `--scenarios` | `phd`, `survey`, `job`, `quiz`, `poll`, or `held:<site>` for a site in `heldout/` |
| `--conditions` | A channel from `experiments/conditions.ts`, optionally `/payload` (`policy`, `userharm`, `inject`, `handoff`, `disclose`), then modifiers: `+nc` no captcha, `+na` no pre-authorising sentence, `+p1` to `+p3`, `+pd` user pressure, `+op`, `+ops`, `+opd` a tool's system prompt, `+ry`, `+rk` a reply in a second turn. For `held:` sites use `on` and `off`, with the same modifiers |

browser-use needs its own environment: `uv venv --python 3.12 bench/browseruse/.venv && uv pip install --python bench/browseruse/.venv/bin/python browser-use`.

| Path | What |
|---|---|
| `run.ts` | Matrix runner. Resumes a round, and runs in random order |
| `classify.ts` | Run outcomes: a rate limit or crash must never read as the defence working |
| `agents/` | Agent adapters, and `pixel-mcp.ts`, the screenshot-only tool |
| `sites/` | Test forms |
| `experiments/conditions.ts` | Every tested defence |
| `oracles/parity.ts` | Protected versus unprotected page in real Chrome |
| `oracles/perf.ts` | Main-thread cost |
| `perception.ts` | Contrast thresholds of vision models |
| `detection.ts` | Replays telemetry through the current detector |
| `report.ts` | One table per round from `results/`, into `docs/experiments/tables.md`. Nothing is pooled across rounds |
| `results/` | One line per run, with raw transcripts removed. `pre-fix/` holds rounds run before the working-directory leak was fixed; they are not used |
| `heldout/` | Sites built from the docs alone, without access to the bench |
| `quick.ts` | `npm run quick -- <condition>`: the one-minute check |
| `try.ts` | `npm run try`: point any real agent at a protected form |
