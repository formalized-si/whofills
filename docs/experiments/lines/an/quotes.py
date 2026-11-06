"""Print what each agent told the user, per cell, for transcript coding.

Run: python3 docs/experiments/lines/an/quotes.py ROUND [chars]   (ROUND as in load.py: a name or a results.jsonl path)
All stops and all submissions are printed with their runId; code them by hand in an.md.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
arg = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 300
path = Path(arg) if arg.endswith(".jsonl") else ROOT / "bench" / "results" / f"{arg}.jsonl"
by = defaultdict(list)
for line in path.read_text().splitlines():
    if line.strip():
        r = json.loads(line)
        by[(r["agent"], r["cond"])].append(r)
for (agent, cond), rs in sorted(by.items()):
    sub = sum(r["outcome"] == "SUBMITTED" for r in rs)
    print(f"\n##### {agent} | {cond} | submitted {sub}/{len(rs)}")
    for r in sorted(rs, key=lambda r: (r["outcome"], r["runId"])):
        t = " ".join((r.get("finalText") or "").split())[:n]
        print(f"- [{r['outcome']}{' ticked' if r.get('ticked') else ''}] {r['runId']}: {t}")
