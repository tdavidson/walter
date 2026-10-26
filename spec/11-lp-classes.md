# LP classes

New in 0.2. A class is a group of LPs on terms of their own: an anchor LP at a lower carry, a
founders' class with no pref, a side letter that cuts the fee, or a first-loss tranche that takes
losses before everyone else. Anything a class doesn't set is the fund's, so a class that sets
nothing changes nothing (`classes-one-class-matches-fund`).

## Terms

```json
{
  "walter": "0.2",
  "partners": [
    { "id": "gp", "role": "gp", "commitment": "2000000" },
    { "id": "lp-a", "role": "lp", "commitment": "60000000" },
    { "id": "lp-b", "role": "lp", "commitment": "28000000", "class": "anchor" },
    { "id": "lp-c", "role": "lp", "commitment": "10000000", "class": "first-loss" }
  ],
  "classes": [
    {
      "id": "anchor",
      "waterfall": { "preset": "european-standard", "presetTerms": { "carry": "0.15" } },
      "managementFee": { "schedule": [{ "from": "2026-01-01", "rate": "0.015", "basis": "commitments" }] }
    },
    { "id": "first-loss", "subordinated": true }
  ]
}
```

A partner names its class with `class`. A partner with none is on the fund's own terms, which act
as one more class.

| Term | Meaning | Absent |
| --- | --- | --- |
| `id` | Names the class. Unique | |
| `waterfall` | The class's own `tiers` or `preset`, with the rules of [02-terms.md](02-terms.md) | The fund's tiers |
| `managementFee.schedule` | The class's own fee steps | The fund's steps |
| `subordinated` | First loss: senior classes get their capital back before this class gets any | `false` |

Some terms stay the fund's for every class: the waterfall `basis`, what counts as capital
(`returnOfCapital.includes`), the carry recipients, clawback, recycling, and the fee's frequency,
dates, offsets and expense cap. A class may have carry-free partners. They take their slice outside
the tiers as in 0.1, and the class's fee rates still apply to them.

Refusals: a partner naming a class that isn't defined is `unknown-class`; two classes with one id,
or `classes` in terms that say `"walter": "0.1"`, are `invalid-terms`.

## Distributions

Step 3 of [04-distributions.md](04-distributions.md) runs on the classes instead of one pool. Each
class has its own state (C, R, P, T, Π, G, L, Qᵢ) on its own carry-bearing partners, and its own
pref accrual on their dated capital.

1. **Return of capital, senior first.** The senior classes (every class that isn't `subordinated`,
   the fund's own included) are paid what their first tier owes, `C − R`. When the pool is short,
   each class gets a share in proportion to what it's owed. Whatever is left then pays the
   subordinated classes the same way.
2. **Everything after.** What's left of the pool goes to the classes pro rata by capital, and each
   class runs its own tiers on its share. Its return-of-capital tier owes nothing by now, so in
   practice the pref, catch-up and splits are where the classes differ.

Within a class, each tier's LP amount is split across its partners by capital, and its GP amount
across the carry recipients, as in 0.1. With one class, or with classes that only differ in fees,
this is exactly the 0.1 waterfall.

Subordination changes the order capital comes back, not the share of profit. If the fund loses
money, the first-loss class takes the loss up to its capital (`classes-first-loss-takes-the-loss`).
If it makes money, every class is repaid and the first-loss class shares profit pro rata like the
others (`classes-first-loss-in-profit`). Over several distributions the first-loss class waits
until the senior classes are whole (`classes-first-loss-over-time`).

Deal by deal, each class's first tier owes its own share of the realized capital: the factor in
[04-distributions.md](04-distributions.md) uses the class's capital instead of all carry-bearing
capital.

## Clawback and accrued carry

The fund-end view runs the classes too, so the GP's entitlement is a sum over the classes. The
clawback is the GP's total paid less its total entitlement, so a class where the GP fell short
offsets one where it was overpaid. The amount goes back to the classes that overpaid, in proportion
to how much each overpaid, and within a class to its LPs by capital
(`classes-clawback-by-class`). Carry accrued at a NAV is the total entitlement less the total paid.

## Management fees

A class with its own steps pays them on its own partners' basis: their fee-bearing commitments,
or their commitments' share of invested capital or NAV. The fee periods in the result are the
fund's, and each period's gross is the sum over the classes. An offset reduces each class's fee
in proportion to its share of the period's gross, and each partner pays its class's net by
commitment (`classes-fee-discount`, `classes-fee-discount-with-offset`). `feesByPartner` in the
result shows what each partner pays over the schedule.

## Not in 0.2

- A first-loss class that gets no profit at all, or that also waits for the senior classes' pref.
  Both are worded in some LPAs, and either would be a term on the class.
- Classes with different waterfall bases, or different carry recipients.
- Capital call schedules by class. Walter takes contributions as given, so a schedule belongs to
  whatever produces the flows.
