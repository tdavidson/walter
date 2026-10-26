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
- The fund engine keeps every LP, so it takes waterfall terms per LP instead of classes: an LP's
  own carry terms and a subordinated flag (`LpWaterfallTerms`). LPs on identical terms run as one
  group (`groupLpsByTerms`), which is a Walter class, and the conformance adapter maps each
  class's partners onto them. A class's fee rates are a fee group (`feeSchedule` `groups`). The
  app's side-letter fee rate (`partner_allocation_terms`, `rate_override`) still re-splits the
  fund's fee by rate rather than charging a group its own, and nothing in the app sets per-LP
  waterfall terms yet.

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
| `lpClasses[]` with `name` | `classes[]` with `id`, and each LP's `class` |
| `lpClasses[].overrides` (carry, pref, catch-up, carry tiers) | The class's `waterfall` |
| `lpClasses[].feeOverrides.ratePct` | The class's `managementFee.schedule` |
| `lpClasses[].isFirstLoss` | `subordinated: true` |
| `lpClasses[].callSchedule` | The contribution flows: Walter takes calls as given |

Known differences:

- The tool forecasts by quarter and computes in floats; Walter takes dated flows and computes
  in decimal.
- A carry tier's `catchup: true` in the tool pays the GP the rate step on the LP profit below the
  threshold, which isn't a catch-up to a share of profit. On a 20% base stepping to 25% it leaves
  the GP below 25%. Walter's catch-up between two splits brings the GP to exactly the target,
  so the two disagree on those terms until one of them changes.
- LP classes (`features.lpClasses`) map onto `classes`, with differences below.

The engine runs each class's own waterfall (`runClassWaterfalls`) and a class's own fee steps,
and passes the `classes` vectors. The tool's quarterly forecast doesn't use it yet: as of
October 2026 it splits the fund's LP totals across classes after the fact, so a class's pref and
catch-up overrides are stored but don't change its distributions, its first-loss class gets back
at most its capital and gives its share of profit to the other classes, and a class's fee is its
rate on its commitment without the fund's step-downs.

## Portfolio forecast

The forecast now passes every term to the fund engine's waterfall. Deal-by-deal terms still run
whole-fund in the forecast, with a warning, which is a known difference on the deal-by-deal
vectors.
