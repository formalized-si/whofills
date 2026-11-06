"""Statistics for the variance study. Separation-safe: nothing here is a plain maximum-likelihood logit.

* `decompose`: ANOVA of the 0/1 outcome on the probability scale for a full factorial of cells. The between-cell
  variance is split into main effects and interactions (orthogonal, equal cell weights); the within-cell binomial
  variance p(1-p) is "chance". Uncertainty: each cell's p drawn from its Jeffreys posterior Beta(y+.5, n-y+.5),
  so cells at 0/n or n/n are fine.
* `firth`: Firth-penalised logistic regression on binomial cells (Heinze and Schemper 2002), with penalised
  likelihood-ratio tests per term. Finite under complete separation.
* `cp`: Clopper-Pearson interval.
"""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd
from patsy import dmatrix
from scipy import stats


def cp(y: int, n: int, a: float = 0.05) -> tuple[float, float]:
    lo = 0.0 if y == 0 else stats.beta.ppf(a / 2, y, n - y + 1)
    hi = 1.0 if y == n else stats.beta.ppf(1 - a / 2, y + 1, n - y)
    return float(lo), float(hi)


def _term_vars(p: np.ndarray, factors: list[str]) -> dict[str, np.ndarray]:
    """p: array of shape (draws, L1, L2, ...). Returns the variance of every ANOVA term over the equally weighted cells."""
    k = len(factors)
    axes = list(range(1, k + 1))
    # Marginal means for every subset of factors, broadcast back to full shape.
    means = {}
    for r in range(k + 1):
        for sub in itertools.combinations(range(k), r):
            drop = tuple(a for i, a in enumerate(axes) if i not in sub)
            means[sub] = p.mean(axis=drop, keepdims=True) if drop else p
    # Effects by inclusion-exclusion (Moebius inversion).
    out = {}
    for r in range(1, k + 1):
        for sub in itertools.combinations(range(k), r):
            eff = 0
            for rr in range(r + 1):
                for s in itertools.combinations(sub, rr):
                    eff = eff + (-1) ** (r - rr) * means[s]
            eff = np.broadcast_to(eff, p.shape)
            out[":".join(factors[i] for i in sub)] = (eff**2).mean(axis=tuple(axes))
    return out


def _cube(cells: pd.DataFrame, factors: list[str]):
    levels = [sorted(cells[f].unique()) for f in factors]
    shape = tuple(len(l) for l in levels)
    if len(cells) != int(np.prod(shape)):
        raise ValueError(f"not a full factorial: {len(cells)} cells, expected {np.prod(shape)}")
    if len(factors) == 1:
        idx = cells.set_index(factors[0]).reindex(levels[0])
    else:
        idx = cells.set_index(factors).reindex(pd.MultiIndex.from_product(levels, names=factors))
    return idx["y"].to_numpy(float).reshape(shape), idx["n"].to_numpy(float).reshape(shape), shape


def _shares(y: np.ndarray, n: np.ndarray, factors: list[str], correct: bool) -> dict[str, np.ndarray]:
    """y, n: (draws, *shape). Shares of the variance of the 0/1 outcome over equally weighted cells.

    With correct=True, each term's observed variance is reduced by the part binomial noise in the cell means adds to
    it in expectation, (df_term / cells) * mean(p(1-p)/(n-1)), truncated at 0; and within-cell variance is the unbiased
    p(1-p) n/(n-1). This is the method-of-moments (ANOVA) estimator of variance components.
    """
    axes = tuple(range(1, y.ndim))
    p = y / n
    tv = _term_vars(p, factors)
    C = np.prod(y.shape[1:])
    if correct:
        samp = (p * (1 - p) / np.maximum(n - 1, 1)).mean(axis=axes)
        L = y.shape[1:]
        for t in tv:
            df = np.prod([L[factors.index(f)] - 1 for f in t.split(":")])
            tv[t] = np.maximum(0.0, tv[t] - df / C * samp)
        within = (p * (1 - p) * n / np.maximum(n - 1, 1)).mean(axis=axes)
    else:
        within = (p * (1 - p)).mean(axis=axes)
    total = sum(tv.values()) + within
    with np.errstate(invalid="ignore", divide="ignore"):
        return {**{k: v / total for k, v in tv.items()}, "chance (within cell)": within / total}


def decompose(cells: pd.DataFrame, factors: list[str], draws: int = 4000, seed: int = 0) -> pd.DataFrame:
    """Probability-scale ANOVA of a full factorial of binomial cells (columns factors + y + n).

    share: bias-corrected point estimate from the observed counts. lo95/hi95: posterior-predictive bootstrap: draw
    each cell's p from Beta(y+.5, n-y+.5), draw new counts at the same n, re-estimate. Cells at 0/n are therefore
    allowed some chance of not being exactly 0, which widens the interval honestly. raw: the uncorrected plug-in.
    """
    y, n, shape = _cube(cells, factors)
    point = _shares(y[None], n[None], factors, True)
    raw = _shares(y[None], n[None], factors, False)
    rng = np.random.default_rng(seed)
    p = rng.beta(y + 0.5, n - y + 0.5, size=(draws, *shape))
    yb = rng.binomial(n.astype(int)[None].repeat(draws, 0), p).astype(float)
    boot = _shares(yb, np.broadcast_to(n, yb.shape), factors, True)
    rows = []
    for term in point:
        d = boot[term][np.isfinite(boot[term])]
        rows.append(
            {
                "term": term,
                "share": float(point[term][0]),
                "lo95": float(np.quantile(d, 0.025)) if len(d) else np.nan,
                "hi95": float(np.quantile(d, 0.975)) if len(d) else np.nan,
                "raw": float(raw[term][0]),
            }
        )
    return pd.DataFrame(rows)


def chance_range(rate: float, n: int, k: int, sims: int = 20000, seed: int = 0) -> np.ndarray:
    """Distribution of max - min of k binomial(n, rate) proportions: the spread chance alone gives k equal cells."""
    rng = np.random.default_rng(seed)
    x = rng.binomial(n, rate, size=(sims, k)) / n
    return x.max(1) - x.min(1)


def _firth_fit(X: np.ndarray, y: np.ndarray, n: np.ndarray, free: np.ndarray | None = None, iters: int = 300):
    """Firth-penalised binomial logit. `free` marks the coefficients to estimate; the rest are fixed at 0, while the
    penalty keeps using the full X (as in logistf's penalised likelihood-ratio test), so the statistic is never negative."""
    k = X.shape[1]
    free = np.ones(k, bool) if free is None else free
    beta = np.zeros(k)

    def pll(b):
        p = np.clip(1 / (1 + np.exp(-(X @ b))), 1e-12, 1 - 1e-12)
        w = n * p * (1 - p)
        info = X.T @ (X * w[:, None])
        logdet = np.linalg.slogdet(info)[1]
        ll = np.sum(y * np.log(p) + (n - y) * np.log(1 - p))
        return ll + 0.5 * logdet, p, w, info

    cur, p, w, info = pll(beta)
    for _ in range(iters):
        inv = np.linalg.pinv(info)
        h = w * np.einsum("ij,jk,ik->i", X, inv, X)
        u = X.T @ (y - n * p + h * (0.5 - p))
        step = np.zeros(k)
        step[free] = np.linalg.pinv(info[np.ix_(free, free)]) @ u[free]
        for _h in range(40):
            nb = beta + step
            new, np_, nw, ninfo = pll(nb)
            if new >= cur - 1e-10:
                break
            step = step / 2
        beta, cur, p, w, info = nb, new, np_, nw, ninfo
        if np.max(np.abs(step)) < 1e-9:
            break
    return beta, cur, info


def _full_rank(X: np.ndarray, names: list[str]):
    keep = []
    for j in range(X.shape[1]):
        cand = keep + [j]
        if np.linalg.matrix_rank(X[:, cand]) == len(cand):
            keep.append(j)
    return X[:, keep], [names[j] for j in keep]


def firth(cells: pd.DataFrame, formula: str) -> dict:
    """Hierarchical (type II) penalised likelihood-ratio tests, sum-to-zero coding.

    A term of order k is tested inside the model made of every term of the formula of order <= k: its coefficients
    are fixed at 0 and the rest refitted under the same penalty. Main effects are thus tested without interactions,
    and an interaction is tested over and above all main effects (and lower interactions).
    """
    dm = dmatrix(formula, cells, return_type="dataframe")
    info = dm.design_info
    X_all = dm.to_numpy()
    y = cells["y"].to_numpy(float)
    n = cells["n"].to_numpy(float)
    names = list(dm.columns)
    order = {t.name(): len(t.factors) for t in info.terms}
    tests = []
    for term, sl in info.term_name_slices.items():
        if term == "Intercept":
            continue
        k = order[term]
        cols = [i for t2, s2 in info.term_name_slices.items() if order[t2] <= k for i in range(s2.start, s2.stop)]
        X, kept = _full_rank(X_all[:, cols], [names[i] for i in cols])
        tested = {names[i] for i in range(sl.start, sl.stop)}
        free = np.array([c not in tested for c in kept])
        _, pll_full, _ = _firth_fit(X, y, n)
        _, pll_r, _ = _firth_fit(X, y, n, free)
        df = int((~free).sum())
        lr = max(0.0, 2 * (pll_full - pll_r))
        tests.append({"term": term, "df": df, "LR": lr, "p": float(stats.chi2.sf(lr, df)) if df else np.nan})
    X, kept = _full_rank(X_all, names)
    beta, pll_full, _ = _firth_fit(X, y, n)
    return {"coef": dict(zip(kept, beta)), "tests": pd.DataFrame(tests)}


def fisher(a: tuple[int, int], b: tuple[int, int]) -> float:
    (ya, na), (yb, nb) = a, b
    return float(stats.fisher_exact([[ya, na - ya], [yb, nb - yb]])[1])


def exact_homogeneity(groups: list[tuple[int, int]], sims: int = 20000, seed: int = 0) -> float:
    """Are k binomial counts consistent with one common rate? Monte Carlo exact test conditional on the total."""
    y = np.array([g[0] for g in groups])
    n = np.array([g[1] for g in groups])
    if len(groups) == 2:
        return fisher(groups[0], groups[1])
    tot = y.sum()
    pooled = tot / n.sum()
    def chi(yy):
        e = n * pooled
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(e > 0, (yy - e) ** 2 / e, 0) + np.where(n - e > 0, ((n - yy) - (n - e)) ** 2 / (n - e), 0)
        return t.sum()
    obs = chi(y)
    rng = np.random.default_rng(seed)
    pool = np.repeat(np.arange(len(n)), n)
    hits = 0
    for _ in range(sims):
        perm = rng.permutation(pool)[:tot]
        yy = np.bincount(perm, minlength=len(n))
        hits += chi(yy) >= obs - 1e-9
    return (hits + 1) / (sims + 1)
