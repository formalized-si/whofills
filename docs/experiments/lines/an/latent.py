"""Hierarchical Bayesian logistic ANOVA (Gelman 2005): variance components on the logit scale.

logit p_cell = mu + sum over terms t of alpha_t[level of the cell], alpha_t ~ Normal(0, sigma_t), sigma_t ~ HalfNormal(S).
Reported per term: the finite-population SD s_t (the SD of the effects of the levels actually in the design), and the
latent share s_t^2 / (sum s^2 + pi^2/3), where pi^2/3 is the variance of the standard logistic: the "chance" part on
this scale. Separation is handled by the hierarchical prior; the prior scale S is varied to show how much of an
answer comes from the prior rather than the data.

Run: uv run --with numpyro,jax,pandas,scipy,patsy python docs/experiments/lines/an/latent.py
"""
from __future__ import annotations

import itertools
import sys
from pathlib import Path

import jax
import jax.numpy as jnp
import numpy as np
import numpyro
import numpyro.distributions as dist
import pandas as pd
from numpyro.infer import MCMC, NUTS

sys.path.insert(0, str(Path(__file__).parent))
from load import cells, rows  # noqa: E402

numpyro.set_host_device_count(4)
LOGIT_VAR = np.pi**2 / 3


def latent_shares(c: pd.DataFrame, factors: list[str], S: float = 2.5, seed: int = 0, max_order: int | None = None):
    max_order = max_order or len(factors)
    terms = [t for r in range(1, max_order + 1) for t in itertools.combinations(factors, r)]
    idx = {}
    for t in terms:
        key = c[list(t)].astype(str).agg("|".join, axis=1)
        codes, uniq = pd.factorize(key)
        idx[t] = (jnp.array(codes), len(uniq))
    y = jnp.array(c.y.to_numpy(float))
    n = jnp.array(c.n.to_numpy(float))

    def model():
        mu = numpyro.sample("mu", dist.Normal(0, 5))
        eta = mu
        for t in terms:
            name = ":".join(t)
            sig = numpyro.sample(f"sd_{name}", dist.HalfNormal(S))
            z = numpyro.sample(f"z_{name}", dist.Normal(0, 1).expand([idx[t][1]]))
            a = numpyro.deterministic(f"a_{name}", z * sig)
            eta = eta + a[idx[t][0]]
        numpyro.sample("y", dist.Binomial(total_count=n, logits=eta), obs=y)

    mcmc = MCMC(NUTS(model, target_accept_prob=0.95), num_warmup=1000, num_samples=1000, num_chains=4, progress_bar=False)
    mcmc.run(jax.random.PRNGKey(seed))
    s = mcmc.get_samples()
    fs = {":".join(t): np.asarray(s[f"a_{':'.join(t)}"]).std(axis=1) for t in terms}
    tot = sum(v**2 for v in fs.values()) + LOGIT_VAR
    out = []
    for k, v in fs.items():
        sh = v**2 / tot
        out.append({"term": k, "fp_sd_median": np.median(v), "share_median": np.median(sh),
                    "share_lo95": np.quantile(sh, 0.025), "share_hi95": np.quantile(sh, 0.975)})
    sh = LOGIT_VAR / tot
    out.append({"term": "chance (logistic pi^2/3)", "fp_sd_median": np.sqrt(LOGIT_VAR), "share_median": np.median(sh),
                "share_lo95": np.quantile(sh, 0.025), "share_hi95": np.quantile(sh, 0.975)})
    div = int(np.asarray(mcmc.get_extra_fields()["diverging"]).sum())
    return pd.DataFrame(out), div


BLOCKS = {
    "w2a identity h1..h3": (lambda d: d[(d["round"] == "w2a") & d.channel.isin(["say_h1", "say_h2", "say_h3"])], ["model", "channel", "scenario"], "submitted"),
    "w2a h1 vs h2": (lambda d: d[(d["round"] == "w2a") & d.channel.isin(["say_h1", "say_h2"])], ["model", "channel", "scenario"], "submitted"),
    "w2a true_self t1..t4": (lambda d: d[(d["round"] == "w2a") & d.channel.isin(["say_t1", "say_t2", "say_t3", "say_t4"])], ["model", "channel", "scenario"], "submitted"),
    "w2b all authority": (lambda d: d[d["round"] == "w2b"], ["model", "pressure", "scenario"], "submitted"),
    "w2b p2 vs ops": (lambda d: d[(d["round"] == "w2b") & d.pressure.isin(["p2", "ops"])], ["model", "pressure", "scenario"], "submitted"),
    "w3c p2/ry/rk": (lambda d: d[d["round"] == "w3c"], ["model", "pressure", "scenario"], "submitted"),
    "w1a surface x effort x sentence": (lambda d: d[d["round"] == "w1a"], ["surface", "effort", "sentence"], "submitted"),
}


def main(scales=(1.0, 2.5, 5.0)):
    d = rows()
    lines = []
    for name, (sel, factors, yv) in BLOCKS.items():
        c = cells(sel(d), factors, y=yv)
        res = []
        for S in scales:
            r_df, div = latent_shares(c, factors, S=S, max_order=2)
            if S == 2.5:
                full = r_df.copy()
            res.append(r_df.set_index("term")["share_median"].rename(f"S={S}"))
        tab = pd.concat(res, axis=1)
        lines.append(f"### {name}\n")
        lines.append("Latent share, posterior median, by prior scale S of the HalfNormal on each SD; "
                     "95% interval at S=2.5 in the last column. Interactions up to two-way.\n")
        full = full.set_index("term")
        tab["95% at S=2.5"] = [f"{full.loc[t, 'share_lo95']:.2f} to {full.loc[t, 'share_hi95']:.2f}" for t in tab.index]
        lines.append("| term | " + " | ".join(tab.columns) + " |")
        lines.append("|---|" + "---|" * len(tab.columns))
        for t, row in tab.iterrows():
            lines.append(f"| {t} | " + " | ".join(f"{v:.2f}" if isinstance(v, float) else str(v) for v in row) + " |")
        lines.append(f"\nDivergent transitions at the last fit: {div}.\n")
        print("\n".join(lines[-(len(tab) + 5):]), flush=True)
    Path(__file__).with_name("latent.out.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
