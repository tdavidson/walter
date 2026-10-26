# Conventions

## Numbers are decimal strings

Every amount and every rate is a JSON string holding a decimal: `"1250000"`, `"0.08"`,
`"133.33"`. Rates are fractions, so `"0.08"` is 8%. Engines must compute in exact decimal
arithmetic (or a precision that can't be told apart from it at the currency's minor unit) and
must not round through binary floating point. LPA arithmetic is decimal, and a spec that lets one
engine drift through floats has already lost the argument about which engine is right.

Fractional powers (a pref compounding over 1.4137 years) can't be exact in any finite precision.
The reference engine works to 40 significant digits, and an engine should carry at least 20.

## Amounts are never negative

A contribution, a distribution, an investment, a NAV and a fee are all zero or more. A flow with a
negative amount must be refused with `invalid-flow`. The only negative numbers in a result are
clawback lines, where the GP pays back.

## Currency and minor units

`fund.currency` is an ISO 4217 code and `fund.minorUnits` the number of decimal places in its
minor unit, 2 by default. Every amount in a result is a string with exactly that many places.

## Dates

Dates are ISO `YYYY-MM-DD` and mean a whole day, in no time zone. A date that isn't on the
calendar (`2025-02-30`) is an invalid flow.

## Day counts

The preferred return names its day count, because ACT/365 against 30/360 is one of the quiet
reasons two correct-looking waterfalls disagree.

- **`act/365`** (the default): the actual days between the two dates, divided by 365. A leap year
  is therefore 366/365 of a year, slightly more than one.
- **`30/360`**: the US (bond basis) rule. With the dates `Y1-M1-D1` and `Y2-M2-D2`, first set D1 to
  30 if it is 31, then set D2 to 30 if it is 31 and D1 is now 30. The fraction is
  `(360 × (Y2 − Y1) + 30 × (M2 − M1) + (D2 − D1)) / 360`.

An IRR hurdle on a split (`until.lpIrr`) always uses ACT/365.

## Rounding

Each distribution is computed exactly and rounded once, when its lines are final. A line is one
tier's amount to one partner on one date. The rounding goes in three steps, the last two by
largest remainder:

1. Round the distributable amount itself to the minor unit, half to even.
2. Round each partner's total for the distribution so that the partners add up to the
   distributable amount.
3. Round each partner's lines so that they add up to that partner's total.

Largest remainder means: round every value down, then give one minor unit to each value in order
of the largest discarded remainder until the total is reached. Ties go to the earlier item:
partners in the order the terms list them, and lines in tier order. Rounding partner totals first
is what makes a partner's share tie to the cent. If each line were rounded on its own, a GP
holding exactly 20% of profit across two tiers could come out a cent over.

The waterfall's running state (capital returned, pref paid, the GP's share so far) is then
advanced by the rounded lines, which is to say by what was actually paid.

Engines that round after every tier will land within a cent of these answers almost always, and
that's what the vectors' default tolerance of `"0.01"` allows for. A vector can tighten it.

## Refusals

When terms or flows can't be computed, an engine must refuse rather than guess, and the refusal
has a code a vector can expect:

| Code | When |
| --- | --- |
| `invalid-terms` | The terms break a rule in [02-terms.md](02-terms.md) |
| `invalid-flow` | A flow has an unknown type, a bad date or a negative amount |
| `unknown-partner` | A contribution or carry recipient names someone not in `partners` |
| `unknown-class` | A partner names a class that `classes` doesn't define |
| `no-carry-recipient` | A tier pays the GP but nobody receives it |
| `recycling-not-permitted` | A distribution recycles, and the terms have no `recycling` |
| `recycle-over-cap` | The recycling to date would pass the cap |
| `recycle-after-end` | A recycle is dated after `recycling.until` |
| `recycle-exceeds-proceeds` | A recycle is larger than the proceeds it comes from |
