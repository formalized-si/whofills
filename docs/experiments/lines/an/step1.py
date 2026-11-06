"""Step 1: how much of the variation in existing clean rounds is model, wording, surface, scenario, chance.

Run: uv run --with scipy,pandas,statsmodels python docs/experiments/lines/an/step1.py
Every block is one randomised round (or says plainly where a factor is confounded with the round).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from load import cells, rows  # noqa: E402
from stats import cp, decompose, exact_homogeneity, firth  # noqa: E402

pd.set_option("display.width", 200)
OUT = []


def say(s=""):
    OUT.append(s)
    print(s)


def table(df: pd.DataFrame, fmt="{:.2f}"):
    cols = list(df.columns)
    say("| " + " | ".join(cols) + " |")
    say("|" + "---|" * len(cols))
    for _, r in df.iterrows():
        say("| " + " | ".join(fmt.format(v) if isinstance(v, float) else str(v) for v in r) + " |")
    say()


def block(title, c, factors, formula=None, note=""):
    say(f"### {title}")
    say()
    if note:
        say(note)
        say()
    say(f"{int(c.n.sum())} runs, {len(c)} cells, {int(c.y.sum())} submitted.")
    say()
    if c.y.sum() == 0 or c.y.sum() == c.n.sum():
        say("No variation in the outcome: nothing to decompose.")
        say()
        return
    d = decompose(c, factors)
    d = d.rename(columns={"share": "share (corrected)", "lo95": "2.5%", "hi95": "97.5%", "raw": "share (uncorrected)"})
    table(d)
    if formula:
        f = firth(c, formula)
        t = f["tests"].copy()
        t["LR"] = t["LR"].map(lambda v: f"{v:.1f}")
        t["p"] = t["p"].map(lambda v: f"{v:.2g}")
        say("Firth logistic, hierarchical penalised likelihood-ratio tests:")
        say()
        table(t)


def main():
    d = rows()

    say("## B1. `w2a`: statement wording x model, no pressure, DOM tools")
    say()
    w = d[d["round"] == "w2a"]
    c = cells(w, ["model", "cond", "scenario"])
    block("All 18 conditions (constructs and wordings)", c, ["model", "cond", "scenario"],
          "C(model, Sum) + C(cond, Sum) + C(scenario, Sum)")
    for grp, keys in {
        "false_self f1..f5": ["say_f1", "say_f2", "say_f3", "say_f4", "say_f5"],
        "true_self t1..t4": ["say_t1", "say_t2", "say_t3", "say_t4"],
        "identity h1..h3": ["say_h1", "say_h2", "say_h3"],
        "two wordings of one claim, h1 vs h2": ["say_h1", "say_h2"],
    }.items():
        cc = cells(w[w.channel.isin(keys)], ["model", "channel", "scenario"])
        block(f"Within one construct: {grp}", cc, ["model", "channel", "scenario"],
              "C(model, Sum) * C(channel, Sum) + C(scenario, Sum)")

    say("## B2. `w2b`: user or tool wording x model, statement f1, DOM tools")
    say()
    w = d[d["round"] == "w2b"]
    c = cells(w, ["model", "pressure", "scenario"])
    block("All six authority levels", c, ["model", "pressure", "scenario"],
          "C(model, Sum) * C(pressure, Sum) + C(scenario, Sum)")
    cc = cells(w[w.pressure.isin(["p2", "ops"])], ["model", "pressure", "scenario"])
    block("Only the two that name the statement: user order p2 vs tool prompt ops", cc, ["model", "pressure", "scenario"],
          "C(model, Sum) * C(pressure, Sum) + C(scenario, Sum)")

    say("## B3. `w3c`: order now vs consent afterwards x model")
    say()
    w = d[d["round"] == "w3c"]
    block("p2, ry, rk", cells(w, ["model", "pressure", "scenario"]), ["model", "pressure", "scenario"],
          "C(model, Sum) * C(pressure, Sum) + C(scenario, Sum)")

    say("## B4. `w1a`: Sonnet, order to tick, surface x effort x the captcha sentence (phd only)")
    say()
    w = d[d["round"] == "w1a"]
    block("surface x effort x sentence", cells(w, ["surface", "effort", "sentence"]), ["surface", "effort", "sentence"],
          "C(surface, Sum) * C(sentence, Sum) + C(effort, Sum)")

    say("## B5. `w1c`: Sonnet on pixels, order to tick, four versions of one task sentence")
    say()
    w = d[d["round"] == "w1c"]
    c = cells(w, ["sentence"])
    block("sentence", c, ["sentence"], "C(sentence, Sum)")

    say("## B6. `w3e`: four pixel agents and Fable on DOM x condition")
    say()
    w = d[(d["round"] == "w3e") & (d.model != "luna")].copy()
    w["agentS"] = w.model + "/" + w.surface
    block("agent x condition x scenario", cells(w, ["agentS", "cond", "scenario"]), ["agentS", "cond", "scenario"],
          "C(agentS, Sum) * C(cond, Sum) + C(scenario, Sum)")

    say("## B7. Surface, across rounds: same model, same condition, DOM vs pixels")
    say()
    say("Pixel cells from `w3e`; DOM cells from `w2b` (f1, f1+p2, f1+ops), `w2a` (h2, t1) and `w3f` (none). "
        "Surface is therefore confounded with round, and phd/job are pooled within each cell.")
    say()
    pix = d[(d["round"] == "w3e") & (d.surface == "pixel")]
    dom_src = {"say_f1+nc+na": "w2b", "say_f1+nc+na+p2": "w2b", "say_f1+nc+na+ops": "w2b",
               "say_h2+nc+na": "w2a", "say_t1+nc+na": "w2a", "none+nc+na": "w3f"}
    dom = pd.concat([d[(d["round"] == r) & (d.cond == k) & (d.surface == "dom")] for k, r in dom_src.items()])
    both = pd.concat([pix, dom])
    both = both[both.model.isin(["sonnet", "opus", "terra", "sol"])]
    c = cells(both, ["model", "surface", "cond"])
    block("model x surface x condition", c, ["model", "surface", "cond"],
          "C(model, Sum) * C(cond, Sum) + C(surface, Sum) * C(cond, Sum) + C(model, Sum):C(surface, Sum)")
    say("Cells (submitted/n):")
    say()
    piv = c.assign(v=c.y.astype(str) + "/" + c.n.astype(str), ms=c.model + " " + c.surface).pivot_table(index="cond", columns="ms", values="v", aggfunc="first")
    table(piv.reset_index())

    say("## B8. `w3b`: the honest channel, false answer 'Me, personally' (said_self) and stops")
    say()
    w = d[d["round"] == "w3b"]
    c = cells(w, ["model", "cond", "scenario"], y="said_self")
    block("said_self: model x condition x scenario", c, ["model", "cond", "scenario"],
          "C(model, Sum) * C(cond, Sum) + C(scenario, Sum)")
    w = w.assign(stopped=1 - w.submitted)
    c = cells(w, ["model", "cond", "scenario"], y="stopped")
    block("stopped: model x condition x scenario", c, ["model", "cond", "scenario"],
          "C(model, Sum) * C(cond, Sum) + C(scenario, Sum)")

    say("## R. Replication: the same cell in different rounds")
    say()
    reps = []
    def add(label, parts):
        groups = [(int(x.submitted.sum()), len(x)) for _, x in parts]
        reps.append({"cell": label, **{f"r{i}": f"{r}: {g[0]}/{g[1]}" for i, ((r, _), g) in enumerate(zip(parts, groups))},
                     "exact p (same rate)": f"{exact_homogeneity(groups):.2g}"})
    sp = d[(d.model == "sonnet") & (d.surface == "pixel") & (d.effort == "default")]
    for cond in ["attest+nc+p2", "attest+nc+p2+na", "attest+nc+p2+sb", "attest+nc+p2+sc"]:
        parts = [(r, sp[(sp["round"] == r) & (sp.cond == cond)]) for r in ["w1a", "w1b", "w1c"]]
        parts = [p for p in parts if len(p[1])]
        if len(parts) > 1:
            add(f"sonnet/pixel {cond}", parts)
    for m in ["haiku", "opus", "sonnet", "sol", "terra"]:
        x = d[(d.model == m) & (d.surface == "dom") & (d.cond == "say_f1+nc+na+p2")]
        parts = [(r, x[x["round"] == r]) for r in ["w2b", "w3c", "w2c"] if len(x[x["round"] == r])]
        if len(parts) > 1:
            add(f"{m}/dom say_f1+nc+na+p2 (w2c is the poll)", parts)
    for m in ["opus", "sonnet", "sol", "terra", "haiku"]:
        x = d[(d.model == m) & (d.surface == "dom") & (d.cond == "say_f1+nc+na")]
        parts = [(r, x[x["round"] == r]) for r in ["w2a", "w2b", "w3f", "w2c"] if len(x[x["round"] == r])]
        if len(parts) > 1:
            add(f"{m}/dom say_f1+nc+na", parts)
    table(pd.DataFrame(reps).fillna(""))

    say("## S. phd vs job inside each round (scenario as a factor)")
    say()
    sc = []
    for r in ["w2a", "w2b", "w3b", "w3c", "w3e", "w3f", "w3h"]:
        x = d[(d["round"] == r) & d.scenario.isin(["phd", "job"])]
        y = "said_self" if r == "w3b" else "submitted"
        a = x[x.scenario == "phd"][y]
        b = x[x.scenario == "job"][y]
        sc.append({"round": r, "outcome": y, "phd": f"{a.sum()}/{len(a)}", "job": f"{b.sum()}/{len(b)}",
                   "Fisher p (pooled over cells, descriptive)": f"{exact_homogeneity([(int(a.sum()), len(a)), (int(b.sum()), len(b))]):.2g}"})
    table(pd.DataFrame(sc))

    Path(__file__).with_name("step1.out.md").write_text("\n".join(OUT) + "\n")


if __name__ == "__main__":
    main()
