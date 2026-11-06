#!/bin/bash
# Codex as the bench runs it, plus one line of evidence about which model answered.
# Codex's --json stream does not name the model. The Responses API does, in every `response.completed` event,
# which Codex logs only at trace level. This keeps those events' "model" field as `l4-served-model: <name>` lines
# on stderr (so they land in the run's stderr.log) and drops the rest of the trace. Other stderr passes through.
#   CODEX_BIN=docs/experiments/lines/l4-codex.sh tsx bench/run.ts ...
# The name is what the server says it ran. It cannot show internal routing behind that name.
REAL="${L4_REAL_CODEX:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}"
[ "$1" = "--version" ] && exec "$REAL" --version
export RUST_LOG="error,tungstenite::protocol=trace"
exec "$REAL" "$@" 2> >(/usr/bin/awk '
  # A log record starts with a timestamp; a TRACE record may run over several lines (websocket frame dumps).
  /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T/ { intrace = ($0 ~ / TRACE /) }
  intrace {
    if (index($0, "\"type\":\"response.completed\"") && match($0, /"model":"[^"]*"/)) {
      m = substr($0, RSTART + 9, RLENGTH - 10)
      if (!(m in seen)) { seen[m] = 1; print "l4-served-model: " m; fflush() }
    }
    next
  }
  { print; fflush() }
' >&2)
