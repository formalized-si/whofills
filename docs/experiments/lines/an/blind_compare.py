"""Join the blind codes to the key, then compare with each line's own codes. Run after codes-*.tsv exist.

Line codes used: L4 per-run hand-checked TSVs (l4-codes-L4-*.tsv for "told", l4-stops-L4-*.tsv for stops);
L1, L2, L3 per-run first-pass codes from their own coder functions (l1_code.code_disclosure, l2_code.disclosure,
l3_analyze.tell_code), with l3_codes.json overrides. L1/L2 hand corrections live only in prose in their md files, so
the L1/L2 comparison is against their first-pass coder, and says so.
Run: uv run --with scipy,pandas python docs/experiments/lines/an/blind_compare.py
"""
import csv
import json
import re
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
LINES = HERE.parent
ROOT = HERE.parents[3]
B = HERE / "blind"


def tsv(p):
    with open(p) as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


key = {r["id"]: r for r in tsv(B / "key.tsv")}
told = {r["id"]: r for r in tsv(B / "codes-told.tsv")}
stops = {r["id"]: r for r in tsv(B / "codes-stops.tsv")}

# Raw rows for the line coders.
raw = {}
for rnd in {k["round"] for k in key.values()}:
    for l in (ROOT / "bench/results" / f"{rnd}.jsonl").read_text().splitlines():
        if l.strip():
            x = json.loads(l)
            raw[(rnd, x["runId"])] = x

# Line coders.
sys.path.insert(0, str(LINES))
import l1_code  # noqa: E402
src = (LINES / "l2_code.py").read_text()
ns: dict = {}
exec(src[: src.index("rows = [json.loads")], ns)  # definitions only; the rest reads argv
import l3_analyze  # noqa: E402
l3_over = json.loads((LINES / "l3_codes.json").read_text())


def l4_file(kind, rnd):
    p = LINES / f"l4-{kind}-{rnd}.tsv"
    out = {}
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            out[parts[0]] = parts[1]
    return out


def line_told(k):
    x = raw[(k["round"], k["runId"])]
    if k["round"].startswith("L1"):
        return l1_code.code_disclosure(x), "l1 first-pass coder"
    if k["round"].startswith("L2"):
        return ns["disclosure"](x), "l2 first-pass coder"
    if k["round"].startswith("L3"):
        o = l3_over.get(k["runId"])
        return (o["tell"], "l3 override") if o else (l3_analyze.tell_code(x.get("finalText")), "l3 first-pass coder")
    if k["round"].startswith("L4"):
        c = l4_file("codes", k["round"]).get(k["runId"])
        return c, "l4 hand-checked TSV"
    return None, ""


def line_stop(k):
    if k["round"].startswith("L4"):
        return l4_file("stops", k["round"]).get(k["runId"]), "l4 hand-checked TSV"
    return None, "no per-run stop codes in a file"


def kappa(a, b, cats):
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    pe = sum((a.count(c) / n) * (b.count(c) / n) for c in cats)
    return po, (po - pe) / (1 - pe) if pe < 1 else float("nan")


rows = []
for i, c in told.items():
    k = key[i]
    lc, src_ = line_told(k)
    rows.append({"id": i, "kind": "told", "round": k["round"], "agent": k["agent"], "cond": k["cond"],
                 "completed_by": k["completed_by"], "blind": c["code"], "line": lc, "line_source": src_, "note": c["note"]})
for i, c in stops.items():
    k = key[i]
    lc, src_ = line_stop(k)
    # The l4 scheme folds "I am an AI" into false and has no page-rule code.
    mapped = {"ai": "false", "rule": "other"}.get(c["code"], c["code"])
    rows.append({"id": i, "kind": "stop", "round": k["round"], "agent": k["agent"], "cond": k["cond"],
                 "completed_by": "", "blind": c["code"], "blind_mapped": mapped, "line": lc, "line_source": src_, "note": c["note"]})
df = pd.DataFrame(rows)
df.to_csv(B / "joined.tsv", sep="\t", index=False)

out = []
t = df[(df.kind == "told") & df.line.notna()]
out.append(f"Told: {len(df[df.kind=='told'])} coded blind; {len(t)} have a line code.")
for src_, g in [("all lines", t)] + list(t.groupby("line_source")):
    po, k = kappa(list(g.blind), list(g.line), ["yes", "partly", "no"])
    out.append(f"- {src_}: n={len(g)}, raw agreement {po:.2f}, Cohen's kappa {k:.2f}")
out.append("")
out.append("Told, blind (rows) x line (columns):")
out.append(pd.crosstab(t.blind, t.line).to_string())
s = df[(df.kind == "stop") & df.line.notna()]
out.append("")
out.append(f"Stops: {len(df[df.kind=='stop'])} coded blind; {len(s)} have a line code (L4 only).")
if len(s):
    po, k = kappa(list(s.blind_mapped), list(s.line), ["false", "handback", "confirm", "other"])
    out.append(f"- l4: n={len(s)}, raw agreement {po:.2f}, Cohen's kappa {k:.2f} (blind ai -> false, rule -> other)")
    out.append(pd.crosstab(s.blind_mapped, s.line).to_string())
out.append("")
out.append("Blind stop codes, all 100 runs' rounds:")
out.append(df[df.kind == "stop"].groupby(["round", "blind"]).size().unstack(fill_value=0).to_string())
out.append("")
out.append("Disagreements (told):")
for _, r in t[t.blind != t.line].iterrows():
    out.append(f"- {r.id} {r['round']} {r.agent} {r.cond}: blind {r.blind}, line {r.line} ({r.line_source}). {r.note}")
out.append("")
out.append("Disagreements (stops):")
for _, r in s[s.blind_mapped != s.line].iterrows():
    out.append(f"- {r.id} {r['round']} {r.agent} {r.cond}: blind {r.blind}, line {r.line}. {r.note}")
txt = "\n".join(out)
(B / "agreement.txt").write_text(txt + "\n")
print(txt)
