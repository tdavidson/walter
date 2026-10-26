# The engines that already exist

Hemrock has three engines that compute waterfalls: the fund economics tool (`lib/fund-economics`
in the hemrock.com repo), the Portfolio fund engine (`packages/fund-engine`, Apache 2.0) and the
Portfolio forecast, which runs the fund engine's waterfall month by month. Walter started from
the fund engine's spec version 2 and its vectors, and 35 of them are ported here. This page maps
each engine's terms onto Walter's, so that an adapter is a translation and not a guess.

## Portfolio fund engine (spec v2)

| Portfolio | Walter |
| --- | --- |
| `kind: european` | `basis: whole-fund` |
| `kind: american` | `basis: deal-by-deal` |
| `kind: straight` | `[return-of-capital, split carryRate]` |
| `kind: none` | Not expressible: Portfolio splits pro rata by capital balance, which depends on NAV |
| `carryRate` c | The split's `gpShare`, and the catch-up's `target` |
| `catchupRate` k | The catch-up's `gpShare`, with `measure: preferred` |
| `catchupSize` s | The catch-up's `target` t, where t ÷ (1 − t) = s × c ÷ (1 − c) |
| `prefRate`, `prefCompounds`, `prefBase` | `preferred-return` `rate`, `compounding: annual` or `none`, `base` |
| `carry_recipients` | `carryRecipients`, with percentages as fractions |
| `recycle_cap_rate`, `recycle_cap_basis`, `recycle_until`, `recycle_default_treatment` | `recycling.cap`, `capBasis`, `until`, `defaultTreatment` (`retained` is `never-distributed`) |

Known differences:

- The fund engine rounds every tier to cents as it goes; Walter computes a distribution exactly
  and rounds its lines once. They agree within the default tolerance, and in `deal-by-deal-realized`
  two LP lines differ by a cent that the tolerance covers.
- The fund engine's carry accrual is a liquidation from a clean state on NAV plus everything
  distributed. Walter replays the actual distributions on the fund-end view. The two agree
  whenever the catch-up is full; with a partial catch-up the path can matter.
- The fund engine has no clawback: carry paid early shows as accrued against paid on the GP panel.
  Its vectors for runWaterfall state, preferredTarget and carryTarget are function-level; the ones
  ported here were rewritten as terms and flows that produce the same state.

## The fund economics tool

| Fund economics | Walter |
| --- | --- |
| `preferredReturnMode: irr`, `preferredReturnRate` | `preferred-return` at `rate`, compounding on unreturned capital |
| `preferredReturnMode: multiple`, `preferredReturnMultiple` | `preferred-return` with `multiple` |
| `catchupPct` (the size) | The catch-up's `target`, as for Portfolio's `catchupSize` |
| `catchupGpShare` | The catch-up's `gpShare`, with `measure: preferred` |
| `carryTiers[].moicThreshold`, `carryPct` | A `split` with `until.lpMultiple` per step |
| `clawback` | `clawback.enabled` |
| `features.recycling` (`retained`, `deemed`) | `recycle` on each distribution, `never-distributed` or `deemed` |

Known differences:

- The tool forecasts by quarter and computes in floats; Walter takes dated flows and computes
  in decimal.
- A carry tier's `catchup: true` in the tool pays the GP the rate step on the LP profit below the
  threshold, which isn't a catch-up to a share of profit. On a 20% base stepping to 25% it leaves
  the GP below 25%. Walter's catch-up between two splits brings the GP to exactly the target,
  so the two disagree on those terms until one of them changes.
- The tool is moving to returning only capital called so far, with clawback on by default (in
  review as of October 2026), which matches Walter. Until that ships it returns all lifetime
  capital first.

## Portfolio forecast

The forecast now passes every term to the fund engine's waterfall. Deal-by-deal terms still run
whole-fund in the forecast, with a warning, which is a known difference on the deal-by-deal
vectors.
