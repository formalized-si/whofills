"""Step 2: the crossed wording round AN-a. Analysis fixed before the data (see an.md, "Analysis, fixed before the run").

Run: uv run --with scipy,pandas,statsmodels python docs/experiments/lines/an/step2.py [ROUND]
Reads bench/results/<ROUND>.jsonl (default AN-a); writes an/step2.out.md.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from load import cells, load  # noqa: E402
from stats import chance_range, cp, decompose, exact_homogeneity, firth  # noqa: E402

OUT: list[str] = []
WORDINGS = ["p2", "an1", "an2", "an3"]


def say(s=""):
    OUT.append(s)
    print(s)


def table(df: pd.DataFrame, fmt="{:.2f}"):
    say("| " + " | ".join(map(str, df.columns)) + " |")
    say("|" + "---|" * len(df.columns))
    for _, r in df.iterrows():
        say("| " + " | ".join(fmt.format(v) if isinstance(v, float) else str(v) for v in r) + " |")
    say()


def tests(c, formula):
    try:
        t = firth(c, formula)["tests"].copy()
    except Exception as e:  # a pilot or a broken round is not a full design
        say(f"Firth fit not possible: {e}")
        say()
        return
    t["LR"] = t["LR"].map(lambda v: f"{v:.1f}")
    t["p"] = t["p"].map(lambda v: f"{v:.2g}")
    say("Firth logistic, hierarchical penalised LR tests:")
    say()
    table(t)


def dec(c, factors):
    try:
        table(decompose(c, factors))
    except ValueError as e:
        say(f"Decomposition not possible: {e}")
        say()


def frac(y, n):
    lo, hi = cp(int(y), int(n))
    return f"{int(y)}/{int(n)} ({lo:.2f} to {hi:.2f})"


def main(round_="AN-a"):
    raw = load(round_)
    raw["agentS"] = raw.model + "/" + raw.surface
    say(f"# {round_}")
    say()
    bad = raw[~raw.valid]
    say(f"{len(raw)} runs; {len(bad)} not decisions (timeouts, INFRA, INVALID, UNKNOWN), listed apart:")
    say()
    if len(bad):
        table(bad.groupby(["agentS", "cond", "outcome"]).size().reset_index(name="runs"))
    d = raw[raw.valid].copy()
    fail = raw.groupby(["agentS", "cond"]).valid.agg(lambda v: 1 - v.mean()).reset_index(name="failed share")
    over = fail[fail["failed share"] > 0.10]
    if len(over):
        say("Cells with more than 10% failed runs (rerun before analysis):")
        say()
        table(over)
    served = d.groupby("agentS").servedModel.agg(lambda s: ", ".join(sorted(set(map(str, s))))).reset_index()
    say("Served model per agent (Claude only):")
    say()
    table(served)

    say("## Controls")
    say()
    ctl = d[d.cond.isin(["none+nc+na", "say_f1+nc+na"])]
    c = cells(ctl, ["agentS", "cond"])
    c["submitted"] = [frac(y, n) for y, n in zip(c.y, c.n)]
    table(c[["agentS", "cond", "submitted"]])

    w = d[d.pressure.isin(WORDINGS)].copy()
    w["wording"] = w.pressure
    say("## Submitted per agent and wording (phd and job together), Clopper-Pearson 95%")
    say()
    c = cells(w, ["agentS", "wording"])
    c["v"] = [frac(y, n) for y, n in zip(c.y, c.n)]
    pv = c.pivot(index="agentS", columns="wording", values="v")
    table(pv[[x for x in WORDINGS if x in pv.columns]].reset_index())

    say("## Range of the four wording rates per agent against chance alone")
    say()
    rr = []
    for a, g in c.groupby("agentS"):
        rates = g.y / g.n
        pooled = g.y.sum() / g.n.sum()
        n = int(round(g.n.mean()))
        sim = chance_range(pooled, n, len(g))
        obs = rates.max() - rates.min()
        rr.append({"agent": a, "pooled": f"{pooled:.2f}", "n per wording": n, "observed range": f"{obs:.2f}",
                   "chance median": f"{np.median(sim):.2f}", "chance 95th": f"{np.quantile(sim, .95):.2f}",
                   "P(chance >= observed)": f"{(sim >= obs - 1e-9).mean():.2f}",
                   "exact test, same rate": f"{exact_homogeneity([(int(y), int(n_)) for y, n_ in zip(g.y, g.n)]):.2g}"})
    table(pd.DataFrame(rr))

    say("## Variance decomposition, agent x wording x scenario (probability scale, corrected)")
    say()
    c3 = cells(w, ["agentS", "wording", "scenario"])
    dec(c3, ["agentS", "wording", "scenario"])
    tests(c3, "C(agentS, Sum) * C(wording, Sum) + C(scenario, Sum)")

    if w.model.isin(["terra"]).any():
        say("## Model x surface x wording on Sonnet and Terra (2 x 2 x 4)")
        say()
        s = w[w.model.isin(["sonnet", "terra"])]
        c4 = cells(s, ["model", "surface", "wording"])
        dec(c4, ["model", "surface", "wording"])
        tests(c4, "C(model, Sum) * C(surface, Sum) + C(wording, Sum) + C(model, Sum):C(wording, Sum) + C(surface, Sum):C(wording, Sum)")

    say("## Agent x request: nothing to certify, a false box, a false box with an order (four wordings pooled)")
    say()
    say("The PI's line: models differ in which requests they accept, not in how compliant they are. "
        "Supported here if the agent x request share exceeds the agent share.")
    say()
    q = d.copy()
    q["request"] = q.cond.map(lambda c: "none" if c.startswith("none") else ("false box" if c == "say_f1+nc+na" else "false box + order"))
    # Equal weight per agent x request cell, so the larger n of the order cells does not dominate.
    c7 = cells(q, ["agentS", "request"])
    c7["v"] = [frac(y, n) for y, n in zip(c7.y, c7.n)]
    table(c7.pivot(index="agentS", columns="request", values="v").reset_index())
    dec(c7.drop(columns="v"), ["agentS", "request"])
    tests(c7.drop(columns="v"), "C(agentS, Sum) * C(request, Sum)")

    say("## Only the two agents in the middle (Opus, Haiku, DOM), n = 20 per wording")
    say()
    m = w[w.model.isin(["opus", "haiku"]) & (w.surface == "dom")]
    c5 = cells(m, ["model", "wording", "scenario"])
    dec(c5, ["model", "wording", "scenario"])
    tests(c5, "C(model, Sum) * C(wording, Sum) + C(scenario, Sum) + C(model, Sum):C(scenario, Sum)")

    say("## phd vs job per agent")
    say()
    c6 = cells(w, ["agentS", "scenario"])
    c6["v"] = [frac(y, n) for y, n in zip(c6.y, c6.n)]
    table(c6.pivot(index="agentS", columns="scenario", values="v").reset_index())

    say("## Ticked without submitting")
    say()
    tk = w[(w.ticked) & (w.submitted == 0)]
    say(f"{len(tk)} runs." + (" " + ", ".join(tk.runId) if len(tk) else ""))
    say()

    if not round_.endswith(".jsonl"):
        Path(__file__).with_name("step2.out.md").write_text("\n".join(OUT) + "\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "AN-a")
