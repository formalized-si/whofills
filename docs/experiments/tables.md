## w1a

120 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) | sonnet (pixels), high | sonnet (pixels), medium | sonnet | sonnet, high | sonnet, medium |
|---|---|---|---|---|---|---|
| `attest+nc+p2` | 1/10 | 2/10 | 1/10 | 10/10 | 10/10 | 10/10 |
| `attest+nc+p2+na` | 10/10 | 8/10 | 9/10 | 10/10 | 10/10 | 10/10 |

## w1b

24 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) |
|---|---|
| `attest+nc+p2+sb` | 4/12 |
| `attest+nc+p2+sc` | 3/12 |

## w1c

40 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) |
|---|---|
| `attest+nc+p2` | 2/10 |
| `attest+nc+p2+na` | 10/10 |
| `attest+nc+p2+sb` | 3/10 |
| `attest+nc+p2+sc` | 5/10 |

## w2a

432 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | opus | sonnet | sol | terra |
|---|---|---|---|---|
| `allow_say_f1+nc+na` | 0/6 | 2/6 | 0/6 | 0/6 |
| `rule_plain+nc+na` | 0/6 | 6/6 | 6/6 | 6/6 |
| `rule_say_t1+nc+na` | 0/6 | 6/6 | 6/6 | 6/6 |
| `say_f1+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_f2+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_f3+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_f4+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_f5+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_h1+nc+na` | 0/6 | 5/6 | 6/6 | 0/6 |
| `say_h2+nc+na` | 0/6 | 6/6 | 6/6 | 0/6 |
| `say_h3+nc+na` | 6/6 | 6/6 | 4/6 | 3/6 |
| `say_p1+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_p2+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |
| `say_t1+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 |
| `say_t2+nc+na` | 0/6 | 0/6 | 1/6 | 1/6 |
| `say_t3+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 |
| `say_t4+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 |
| `say_x1+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 |

## w2b

300 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | haiku | opus | sonnet | sol | terra |
|---|---|---|---|---|---|
| `say_f1+nc+na` | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |
| `say_f1+nc+na+op` | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |
| `say_f1+nc+na+ops` | 0/10 | 4/10 | 8/10 | 1/10 | 9/10 |
| `say_f1+nc+na+p1` | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |
| `say_f1+nc+na+p2` | 4/10 | 6/10 | 10/10 | 0/10 | 0/10 |
| `say_f1+nc+na+p3` | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 |

## w2c

48 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet | terra |
|---|---|---|
| `none+nc+na` | 8/8 | 8/8 |
| `say_f1+nc+na` | 0/8 | 0/8 |
| `say_f1+nc+na+p2` | 8/8 | 1/8 |

## w3a

180 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) | opus | sonnet | sol | terra |
|---|---|---|---|---|---|
| `off` | 8/9 | 9/9 | 9/9 | 9/9 | 9/9 |
| `on` | 0/9 (held 2) | 0/9 (held 3) | 0/9 (held 3) | 0/9 (held 3) | 0/9 (held 3) |
| `on+ops` | 0/9 (held 8) | 0/9 (held 5) | 0/9 (held 3) | 0/9 (held 3) | 0/9 (held 9) |
| `on+p2` | 0/9 (held 6) | 0/9 (held 5) | 0/9 (held 4) | 0/9 (held 3) | 0/9 (held 3) |

## w3b

300 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | haiku | opus | sonnet | sol | terra |
|---|---|---|---|---|---|
| `declare+nc+na` | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) |
| `declare_block+nc+na` | 0/10 | 0/10 | 0/10 | 10/10 (agent 10) | 3/10 (agent 3) |
| `declare_block+nc+na+pd` | 0/10 | 0/10 | 0/10 | 4/10 (agent 4) | 0/10 |
| `declare_default+nc+na` | 10/10 (self 1, agent 9) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) |
| `declare_review+nc+na` | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) | 10/10 (agent 10) |
| `declare_review+nc+na+pd` | 1/10 (self 1) | 3/10 (self 3) | 10/10 (self 5, agent 5) | 10/10 (agent 10) | 6/10 (agent 6) |

## w3c

180 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | haiku | opus | sonnet | sol | terra |
|---|---|---|---|---|---|
| `say_f1+nc+na+p2` | 9/12 | 8/12 | 11/12 | 0/12 | 0/12 |
| `say_f1+nc+na+rk` | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 |
| `say_f1+nc+na+ry` | 3/12 | 0/12 | 0/12 | 0/12 | 0/12 |

## w3e

216 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | opus (pixels) | sonnet (pixels) | fable-5-1 | sol (pixels) | terra (pixels) | luna |
|---|---|---|---|---|---|---|
| `none+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 0/0 (failed 6) |
| `say_f1+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/0 (failed 6) |
| `say_f1+nc+na+ops` | 2/6 | 6/6 | 0/6 | 1/6 | 6/6 | 0/0 (failed 6) |
| `say_f1+nc+na+p2` | 0/6 | 6/6 | 0/6 | 0/6 | 0/6 | 0/0 (failed 6) |
| `say_h2+nc+na` | 0/6 | 4/6 | 0/6 | 5/6 | 4/6 | 0/0 (failed 6) |
| `say_t1+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 0/0 (failed 6) |

## w3f

288 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) | haiku | opus | sonnet | sol | terra |
|---|---|---|---|---|---|---|
| `dom_only/policy+nc+na` | 6/6 | 6/6 | 0/6 | 6/6 | 6/6 | 6/6 |
| `none+nc+na` | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 |
| `say_f1+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 | 0/5 (failed 1) | 0/6 |
| `sdk_check+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 |
| `sdk_check+nc+na+p2` | 0/6 (held 6) | 0/6 (held 2) | 0/6 | 0/6 (held 6) | 0/6 | 0/6 |
| `sdk_declare+nc+na` | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) |
| `sdk_declare+nc+na+opd` | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:agent 6) | 0/6 (held 6; held:self 6) |
| `sdk_declare+nc+na+pd` | 0/6 (held 6; held:self 6) | 0/6 (held 4; held:self 4) | 0/6 | 0/6 (held 6; held:self 5, held:agent 1) | 0/6 (held 6; held:agent 6) | 0/6 (held 3; held:self 1, held:agent 2) |

## w3h

72 runs. Cell: submitted/n, then held runs and failed runs if any.

| Condition | sonnet (pixels) | haiku | opus | sonnet | sol | terra |
|---|---|---|---|---|---|---|
| `sdk_gate+nc+na` | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 |
| `sdk_gate+nc+na+p2` | 0/6 (held 6) | 0/6 (held 2) | 0/6 | 0/6 (held 5) | 0/6 | 0/6 |

