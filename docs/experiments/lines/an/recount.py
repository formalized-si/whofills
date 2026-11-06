"""Recount kit: raw results to per-cell k/n with Clopper-Pearson 95%, Fisher exact contrasts, failed runs apart, and a
check of every row against its own site log.

  python recount.py L1-b                                  # submitted per agent x cond, both scenarios together
  python recount.py L1-b --by agent,scenario,cond         # split by scenario
  python recount.py L1-b --y said:agent --y said:self     # declaration answers (fields.completed_by or SDK declared)
  python recount.py L1-b --fisher cond=say_f1+nc+na,say_f1+nc+na+l1motor   # per level of the other --by columns
  python recount.py L1-b --verify                         # recompute submitted/held/fields from bench/runs/<round>/*/site.jsonl
  python recount.py L1-b --claims l1-claims.csv           # after the blind count: diff against a line's reported k/n
  python recount.py bench/runs/L3-a/results.jsonl         # a round still running, or not yet copied

Outcome specs for --y (repeatable; default `submitted`):
  submitted | stopped | held | failed | ticked | filled0 | first_submitted (two-turn: submitted in the first turn)
  field:NAME=VALUE   fields[NAME] == VALUE in the submitted payload (e.g. field:completed_by=agent, field:attest=on)
  said:VALUE         fields.completed_by, else the first SDK `declared` value, equals VALUE
  text:REGEX         the final message to the user matches REGEX (case-insensitive)

Denominator: valid runs (SUBMITTED, or STOPPED without a timeout) unless the spec is `failed`, whose denominator is
all runs. Failed runs (INFRA, INVALID, UNKNOWN, timeouts without a submission) are listed per cell, never counted as
stops. Cells with more than 10% failed are flagged for a rerun.

Run with: uv run --with scipy,pandas,statsmodels python docs/experiments/lines/an/recount.py ...
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from load import ROOT, load  # noqa: E402
from stats import cp, fisher  # noqa: E402


def outcome(df: pd.DataFrame, spec: str) -> pd.Series:
    if spec == "submitted":
        return df.submitted
    if spec == "stopped":
        return 1 - df.submitted
    if spec == "held":
        return df.held
    if spec == "failed":
        return (~df.valid).astype(int)
    if spec == "ticked":
        return df.ticked.astype(int)
    if spec == "filled0":
        return (df.filledFields.fillna(-1) == 0).astype(int)
    if spec == "first_submitted":
        return df.firstSubmitted.fillna(df.submitted.astype(bool)).astype(int)
    if spec.startswith("field:"):
        name, _, val = spec[6:].partition("=")
        return df.fields.map(lambda f: int(str(f.get(name)) == val))
    if spec.startswith("said:"):
        return (df.said == spec[5:]).astype(int)
    if spec.startswith("text:"):
        rx = re.compile(spec[5:], re.I)
        return df.finalText.map(lambda t: int(bool(rx.search(t or ""))))
    raise SystemExit(f"unknown outcome spec {spec}")


def site_check(df: pd.DataFrame, rounds_dir: Path) -> pd.DataFrame:
    """Recompute from each run's own site log; any disagreement with the results row is listed."""
    out = []
    for _, r in df.iterrows():
        p = rounds_dir / r["round"] / r["runId"] / "site.jsonl"
        if not p.exists():
            out.append({"runId": r["runId"], "problem": "no site.jsonl"})
            continue
        ev = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        sub = [e for e in ev if e.get("type") == "submit_ok"]
        held = any(e.get("type") == "held" for e in ev)
        if int(bool(sub)) != r["submitted"]:
            out.append({"runId": r["runId"], "problem": f"log submit_ok={len(sub)} but row outcome={r['outcome']}"})
        if int(held) != r["held"]:
            out.append({"runId": r["runId"], "problem": f"log held={held} but row held={r['held']}"})
        if sub and (sub[0].get("fields") or {}) != r["fields"]:
            out.append({"runId": r["runId"], "problem": "submitted fields differ from the row"})
        if len(sub) > 1:
            out.append({"runId": r["runId"], "problem": f"{len(sub)} submissions"})
    return pd.DataFrame(out)


def md(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(str(v) for v in r) + " |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rounds", nargs="+")
    ap.add_argument("--by", default="agent,cond")
    ap.add_argument("--y", action="append")
    ap.add_argument("--fisher", action="append", default=[], help="COL=V1,V2: contrast two levels of COL")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--claims", help="CSV with the --by columns plus k and n, as the line reported them")
    ap.add_argument("--where", action="append", default=[], help="COL=V1,V2: keep only these levels")
    a = ap.parse_args()
    specs = a.y or ["submitted"]
    by = a.by.split(",")
    raw = pd.concat([load(r) for r in a.rounds], ignore_index=True)
    for w in a.where:
        col, _, vals = w.partition("=")
        raw = raw[raw[col].astype(str).isin(vals.split(","))]
    dup = raw[raw.duplicated("runId", keep=False)]
    print(f"# Recount of {', '.join(a.rounds)}\n")
    print(f"{len(raw)} rows, {raw.runId.nunique()} distinct runIds, {int((~raw.valid).sum())} failed.")
    if len(dup):
        print(f"\nDuplicate runIds: {sorted(dup.runId.unique())}")
    served = raw.groupby("agent").servedModel.agg(lambda s: ", ".join(sorted({str(x) for x in s}))).reset_index()
    print("\nServed model per agent (Claude rows only carry it):\n")
    print(md(served))
    for spec in specs:
        d = raw.copy()
        d["y"] = outcome(d, spec)
        base = d if spec == "failed" else d[d.valid]
        g = base.groupby(by, observed=True).y.agg(["sum", "count"]).reset_index()
        g.columns = by + ["k", "n"]
        fails = d[~d.valid].groupby(by, observed=True).outcome.agg(lambda s: ", ".join(f"{k} {v}" for k, v in s.value_counts().items()))
        tot = d.groupby(by, observed=True).size()
        rows = []
        for _, r in g.iterrows():
            key = tuple(r[b] for b in by)
            lo, hi = cp(int(r.k), int(r.n))
            f = fails.get(key if len(by) > 1 else key[0], "")
            share = 1 - r.n / tot.get(key if len(by) > 1 else key[0], r.n) if spec != "failed" else 0
            rows.append({**{b: r[b] for b in by}, "k/n": f"{int(r.k)}/{int(r.n)}", "rate": f"{r.k / r.n:.2f}",
                         "CP 95%": f"{lo:.2f} to {hi:.2f}", "failed": f + (" RERUN" if share > 0.10 else "")})
        print(f"\n## {spec}\n")
        print(md(pd.DataFrame(rows)))
        for fs in a.fisher:
            col, _, vals = fs.partition("=")
            v1, v2 = vals.split(",")
            others = [b for b in by if b != col]
            print(f"\nFisher exact, {spec}, {col}: {v1} vs {v2}\n")
            out = []
            groups = base.groupby(others, observed=True) if others else [((), base)]
            for key, sub in groups:
                x1 = sub[sub[col].astype(str) == v1].y
                x2 = sub[sub[col].astype(str) == v2].y
                if len(x1) and len(x2):
                    p = fisher((int(x1.sum()), len(x1)), (int(x2.sum()), len(x2)))
                    k = key if isinstance(key, tuple) else (key,)
                    out.append({**dict(zip(others, k)), v1: f"{int(x1.sum())}/{len(x1)}", v2: f"{int(x2.sum())}/{len(x2)}", "p (two-sided)": f"{p:.3g}"})
            print(md(pd.DataFrame(out)) if out else "(no cell pairs)")
        if a.claims:
            c = pd.read_csv(a.claims, dtype=str)
            g2 = g.astype({b: str for b in by})
            # Every claimed cell must exist and match; recount cells the line did not report are not errors.
            m = c.merge(g2.astype({"k": str, "n": str}), on=by, how="left", suffixes=("_claimed", "_recount"), indicator=True)
            bad = m[(m["_merge"] != "both") | (m.k_claimed != m.k_recount) | (m.n_claimed != m.n_recount)]
            print(f"\nClaims vs recount ({a.claims}): {len(m) - len(bad)} of {len(m)} claimed cells match.\n")
            if len(bad):
                print(md(bad.drop(columns="_merge").fillna("")))
    if a.verify:
        rd = ROOT / "bench" / "runs"
        chk = site_check(raw, rd)
        print(f"\n## Site-log check ({len(raw)} runs)\n")
        print("Every row agrees with its site log." if chk.empty else md(chk))


if __name__ == "__main__":
    main()
