# Terms

One JSON document per fund, validated by [`schema/terms.schema.json`](../schema/terms.schema.json).

```json
{
  "walter": "0.1",
  "fund": { "id": "example-fund-i", "currency": "USD", "investmentPeriodEnd": "2030-06-30" },
  "partners": [
    { "id": "gp", "role": "gp", "commitment": "2000000" },
    { "id": "lp-a", "role": "lp", "commitment": "60000000" },
    { "id": "lp-b", "role": "lp", "commitment": "38000000" }
  ],
  "waterfall": {
    "basis": "whole-fund",
    "tiers": [
      { "type": "return-of-capital" },
      { "type": "preferred-return", "rate": "0.08", "compounding": "annual", "base": "unreturned", "dayCount": "act/365" },
      { "type": "catch-up", "target": "0.20" },
      { "type": "split", "gpShare": "0.20" }
    ]
  },
  "recycling": { "cap": "0.20", "capBasis": "commitments", "until": "2030-06-30" },
  "managementFee": {
    "frequency": "quarterly",
    "start": "2026-01-01",
    "end": "2036-01-01",
    "schedule": [
      { "from": "2026-01-01", "rate": "0.02", "basis": "commitments" },
      { "from": { "event": "investment-period-end" }, "rate": "0.015", "basis": "invested" }
    ],
    "offsets": { "transaction": "1", "monitoring": "1" }
  }
}
```

Any term may carry a `source`, `{ "section": "8.2(b)", "page": 41, "quote": "..." }`, saying
where in the LPA it comes from. Engines ignore it. It's there so that the terms document can be
the output of LPA extraction as well as an engine's input.

## Fund

`id` and `currency` are required. `minorUnits` defaults to 2. `investmentPeriodEnd` is the date a
fee step can name as the `investment-period-end` event.

## Partners

Each partner has an `id`, a `role` of `lp` or `gp`, and a `commitment`.

- **`carryBearing`** says whether the partner's capital runs through the waterfall and pays carry.
  It defaults to true for an LP and false for the GP, so a GP commit is carry-free unless the
  terms say otherwise. Carry-free capital takes its pro-rata share of each distribution outside
  the tiers ([04-distributions.md](04-distributions.md)).
- **`feeBearing`** says whether the partner pays the management fee, with the same defaults.

## Waterfall

### Basis

`basis` is `whole-fund` (the default) or `deal-by-deal`. Those are European and American
waterfalls by their plainer names. Deal by deal, the first tier owes only the capital in deals
realized so far ([04-distributions.md](04-distributions.md)).

### What counts as capital

`returnOfCapital.includes` lists the contribution purposes that count as capital to return, and to
accrue the preferred return on: any of `investments`, `fees`, `expenses` and `other`. It defaults
to all four. An LPA that returns fees and expenses before carry is the default; one that returns
only invested capital sets `["investments"]`.

### Tiers

The waterfall is an ordered list of tiers rather than a fixed set of flags. A flag set ("has
catch-up: true") can't express an LPA that puts a second hurdle after the first split, and an
ordered list can express every flag set.

Each tier may have an `id`, which names it in the result. It defaults to the type, then `type-2`,
`type-3` and so on for repeats. So the tiers in the example above are `return-of-capital`,
`preferred-return`, `catch-up` and `split`, and a second split would be `split-2`.

The rules for a tier list, each refused with `invalid-terms`:

- the first tier is `return-of-capital`, and there's only one;
- there's at most one `preferred-return`;
- the last tier is a `split` with no `until`, so that every dollar has somewhere to go;
- a `catch-up` measured on `profit` has a `gpShare` above its `target`, or it would never finish.

**`return-of-capital`** has no terms. It pays the carry-bearing partners until they've had back
the capital it owes. That's the capital contributed so far, never capital still to be called; deal
by deal it's the capital in realized deals.

**`preferred-return`** is a rate or a multiple:

| Term | Values | Default | Meaning |
| --- | --- | --- | --- |
| `rate` | a fraction | | The annual rate |
| `compounding` | `annual`, `none` | `annual` | `annual` compounds once a year, on fractional years too, as `(1 + rate)^years − 1`; `none` is simple interest |
| `base` | `contributed`, `unreturned` | `contributed` | What it accrues on ([04-distributions.md](04-distributions.md)) |
| `dayCount` | `act/365`, `30/360` | `act/365` | How years are counted |
| `multiple` | 1 or more | | Instead of a rate: the LPs get `multiple` × capital through the first two tiers |

**`catch-up`** sends the GP a share of each dollar until it has caught up to a target:

| Term | Values | Default | Meaning |
| --- | --- | --- | --- |
| `target` | a fraction below 1 | | The GP's share of profit once caught up |
| `gpShare` | a fraction above 0 | `"1"` | The GP's share of each dollar during the catch-up |
| `measure` | `preferred`, `profit` | `preferred` | What the target is measured against |

The two measures are two LPA wordings. They agree when `gpShare` is 1 and the catch-up comes straight after the preferred return, and part otherwise (a catch-up after a split, or one the LPs share):

- **`preferred`** (the default): "until the General Partner has received an amount equal to 25% of
  the preferred return distributed". The GP's catch-up is `target ÷ (1 − target)` of the preferred
  return paid, however much of the catch-up flow went to the LPs. This is the reading the existing
  engines use, which is why it's the default.
- **`profit`**: "until the General Partner has received 20% of the sum of the amounts distributed
  under clause (ii) and this clause (iii)". The catch-up ends when the GP holds `target` of all
  profit distributed so far.

On 100 called and 200 back after five years at 8% compounding, a 50/50 catch-up to 20% leaves the
GP with 20.00 under `profit` and 17.65 under `preferred`. Both vectors are in the suite
(`catch-up-50-profit-five-years`, `catch-up-50-preferred-five-years`).

**`split`** divides each dollar between the GP (`gpShare`) and the carry-bearing LPs (the rest).
With `until` it stops when the LPs reach a hurdle and the next tier takes over:

- `until.lpMultiple`: the LPs' total distributions, return of capital included, reach this
  multiple of the capital the first tier owes;
- `until.lpIrr`: the LPs' IRR on their dated contributions and distributions reaches this rate.

That is how carry steps up. 20% to a 2× multiple and 30% after it is
`[return-of-capital, split 0.20 until lpMultiple 2.0, split 0.30]`, and a catch-up between the two
splits catches the GP up to the higher rate on everything before.

### Presets

`preset` is a named tier list, and `presetTerms` sets its `carry` (default `"0.20"`) and `pref`
(default `"0.08"`). Give a preset or tiers, not both.

| Preset | Basis | Tiers |
| --- | --- | --- |
| `european-standard` | whole-fund | return of capital; pref at `pref`, compounding annually on unreturned capital, ACT/365; catch-up to `carry` at a gpShare of 1; split at `carry` |
| `american-standard` | deal-by-deal | the same tiers |

### Carry recipients

`carryRecipients` lists who receives the GP's share of each tier, with `share`s that add up to 1.
Without it the GP's share goes to the one partner whose role is `gp`. If tiers pay the GP and
nobody receives it, the terms are refused with `no-carry-recipient`.

## Clawback

`clawback.enabled` defaults to true. It's evaluated at a `fund-end` flow
([06-clawback-and-accrued-carry.md](06-clawback-and-accrued-carry.md)).

## Recycling

`recycling` holds the limits the LPA sets. Each distribution then says how much of it is recycled
([05-recycling.md](05-recycling.md)).

| Term | Values | Default | Meaning |
| --- | --- | --- | --- |
| `cap` | a fraction | | The most that may be recycled, as a share of `capBasis` |
| `capBasis` | `commitments`, `management-fees` | `commitments` | Total commitments, or management fees paid so far |
| `until` | a date | none | No proceeds received after this date may be recycled |
| `uses` | purposes | | What recycled proceeds may pay for. Recorded, not enforced |
| `defaultTreatment` | `never-distributed`, `deemed` | `never-distributed` | The treatment when a recycle names none |

## Management fee

See [07-management-fees.md](07-management-fees.md).
