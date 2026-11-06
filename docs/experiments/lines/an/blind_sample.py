"""Blind-coding sample: 60 final messages from runs that submitted a declaration or a tick, 40 from stops.
Across the four lines' main rounds and all models, stratified by round. Model and condition go to a separate key.
Run: python3 docs/experiments/lines/an/blind_sample.py   (seed fixed; writes an/blind/{texts-*.tsv,key.tsv})
"""
import csv, json, random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ROUNDS = ["L1-a", "L1-b", "L2-a", "L3-a", "L4-a", "L4-b"]
out = Path(__file__).with_name("blind")
rng = random.Random(20261103)
subs, stops = {}, {}
for r in ROUNDS:
    for line in (ROOT / "bench/results" / f"{r}.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        x = json.loads(line)
        base = x["cond"].split("+")[0]
        if base.startswith("none") or base.startswith("held") or not (x.get("finalText") or "").strip():
            continue
        f = x.get("fields") or {}
        row = {"round": r, "runId": x["runId"], "agent": x["agent"], "cond": x["cond"], "scenario": x["scenario"],
               "completed_by": f.get("completed_by", ""), "text": " ".join(x["finalText"].split())}
        if x["outcome"] == "SUBMITTED":
            subs.setdefault(r, []).append(row)
        elif x["outcome"] == "STOPPED":
            stops.setdefault(r, []).append(row)

def stratified(pool, k):
    for v in pool.values():
        rng.shuffle(v)
    picked, i = [], 0
    while len(picked) < k:
        for r in ROUNDS:
            if i < len(pool.get(r, [])) and len(picked) < k:
                picked.append(pool[r][i])
        i += 1
    return picked

a = stratified(subs, 60)
b = stratified(stops, 40)
ids = rng.sample(range(100, 1000), 100)
key = []
for kind, sample, fn in (("told", a, "texts-told.tsv"), ("stop", b, "texts-stops.tsv")):
    rng.shuffle(sample)
    with open(out / fn, "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["id", "text"])
        for s in sample:
            i = ids.pop()
            w.writerow([i, s["text"]])
            key.append({"id": i, "kind": kind, **{k: v for k, v in s.items() if k != "text"}})
with open(out / "key.tsv", "w", newline="") as fh:
    w = csv.DictWriter(fh, delimiter="\t", fieldnames=list(key[0].keys()))
    w.writeheader()
    w.writerows(key)
print(len(a), len(b), {r: len(v) for r, v in subs.items()}, {r: len(v) for r, v in stops.items()})
