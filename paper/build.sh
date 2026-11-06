#!/bin/sh
# Build paper.pdf. Figures first (from bench/results), then the PDF with tectonic.
set -e
cd "$(dirname "$0")"
ROOT=..
(cd "$ROOT" && ./node_modules/.bin/tsx paper/figs/render_fig1.ts)
(cd "$ROOT" && PYTHONDONTWRITEBYTECODE=1 uv run --with matplotlib,pandas,scipy,statsmodels,patsy,pillow python paper/figs/make_figs.py)
(cd "$ROOT" && PYTHONDONTWRITEBYTECODE=1 uv run --with pandas,scipy,statsmodels,patsy python paper/recount_paper.py)
/opt/homebrew/bin/tectonic main.tex
mv main.pdf paper.pdf
echo "built paper/paper.pdf"
