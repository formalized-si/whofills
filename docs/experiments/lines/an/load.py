"""Tidy loader for bench/results/*.jsonl. One row per run, with the factors of the design spelled out.

Reusable for recounts: `rows(["w2b"])` returns a DataFrame; `cells(df, by)` tallies it.
Never reads bench/results/pre-fix (leaked the condition through the working directory).
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[4]
RESULTS = ROOT / "bench" / "results"
CLEAN = ["c4", "c4h", "c5", "c6", "c7", "w1a", "w1b", "w1c", "w2a", "w2b", "w2c", "w3a", "w3b", "w3c", "w3e", "w3f", "w3h"]
VALID = {"SUBMITTED", "STOPPED"}  # INFRA, INVALID, UNKNOWN and timeouts are not decisions
PRESSURE = {"p1", "p2", "p3", "pd", "nv"}
OPERATOR = {"op", "ops", "opd"}
REPLY = {"ry", "rk"}
SENTENCE = {"na", "sb", "sc"}

MODEL = {
    "sonnet": "sonnet", "opus": "opus", "haiku": "haiku", "claude-fable-5-1": "fable",
    "gpt-6.1-terra": "terra", "gpt-6.1-sol": "sol", "gpt-6.1-luna": "luna",
}
SURFACE = {"pwn": "dom", "pw": "dom", "pwsn": "dom_nobatch", "pixeln": "pixel", "pixel": "pixel"}


def parse_agent(a: str) -> dict:
    parts = a.split(":")
    fam, surf, model = parts[0], parts[1], parts[2]
    effort = parts[3] if len(parts) > 3 else ("default" if fam == "claude" else "?")
    return {
        "family": fam,
        "surface": SURFACE.get(surf, surf),
        "model": MODEL.get(model, model),
        "effort": effort,
    }


def parse_cond(c: str) -> dict:
    base, *mods = c.split("+")
    ch, _, payload = base.partition("/")
    statement = ch[4:] if ch.startswith("say_") else ("f1" if ch == "attest" else None)
    pres = [m for m in mods if m in PRESSURE] + [m for m in mods if m in OPERATOR] + [m for m in mods if m in REPLY]
    line = [m for m in mods if m not in PRESSURE | OPERATOR | REPLY | SENTENCE | {"nc", "two"}]
    sent = [m for m in mods if m in SENTENCE]
    return {
        "channel": ch,
        "payload": payload or None,
        "statement": statement,
        "pressure": "+".join(pres + line) or "none",
        "sentence": sent[0] if sent else "full",
        "captcha": "nc" not in mods,
    }


def load(round_: str) -> pd.DataFrame:
    """A round name (bench/results/<name>.jsonl) or a path to any results.jsonl."""
    path = Path(round_) if round_.endswith(".jsonl") else RESULTS / f"{round_}.jsonl"
    round_ = path.stem if round_.endswith(".jsonl") and path.stem != "results" else (path.parent.name if round_.endswith(".jsonl") else round_)
    out = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        f = r.get("fields") or {}
        declared = r.get("declared") or []
        said = f.get("completed_by") or (declared[0] if declared else None)
        out.append(
            {
                "round": round_,
                "runId": r["runId"],
                "agent": r["agent"],
                **parse_agent(r["agent"]),
                "scenario": r["scenario"],
                "cond": r["cond"],
                **parse_cond(r["cond"]),
                "outcome": r["outcome"],
                # A submission is a decision even if the client later timed out: the site log is the oracle.
                "valid": r["outcome"] == "SUBMITTED" or (r["outcome"] == "STOPPED" and not r.get("timedOut")),
                "timedOut": bool(r.get("timedOut")),
                "fields": r.get("fields") or {},
                "declared": declared,
                "firstSubmitted": r.get("firstSubmitted"),
                "replied": r.get("replied"),
                "filledFields": r.get("filledFields"),
                "submitted": int(r["outcome"] == "SUBMITTED"),
                "ticked": bool(r.get("ticked")),
                "held": int(r.get("held", 0) > 0),
                "said": said,
                "said_self": int(said == "self"),
                "servedModel": r.get("servedModel"),
                "finalText": r.get("finalText", ""),
            }
        )
    return pd.DataFrame(out)


def rows(rounds: list[str] | None = None, valid_only: bool = True) -> pd.DataFrame:
    df = pd.concat([load(r) for r in (rounds or CLEAN)], ignore_index=True)
    return df[df.valid].copy() if valid_only else df


def cells(df: pd.DataFrame, by: list[str], y: str = "submitted") -> pd.DataFrame:
    g = df.groupby(by, observed=True)[y].agg(["sum", "count"]).rename(columns={"sum": "y", "count": "n"}).reset_index()
    return g


if __name__ == "__main__":
    d = rows(valid_only=False)
    print(d.groupby(["round", "valid"]).size().unstack(fill_value=0))
