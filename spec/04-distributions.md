# Distributions

Each `distributable` flow, less anything it recycles, is split in five steps.

## 1. Weights

A partner's **capital** is the sum of its contributions whose purpose `returnOfCapital.includes`
lists, plus anything it has been deemed to recontribute ([05-recycling.md](05-recycling.md)),
counted on or before the distribution date. Capital is the weight for everything pro rata below.
If no partner has any capital yet, commitments are the weights instead.

## 2. Carry-free partners

Each partner that isn't `carryBearing` takes its pro-rata share of the distribution, by capital,
outside the tiers. Of that slice, the part up to its capital not yet returned to it is a
`return-of-capital` line, and the rest is a `carry-free` line. What's left after these slices is
the **carry-bearing pool**, and the tiers divide it.

## 3. The tiers

The tiers run in order on the pool, each taking what it's owed from what's left, until the pool
runs out. They see one shared state, cumulative over every earlier distribution and the earlier
tiers of this one, on the carry-bearing side only:

| Symbol | Meaning |
| --- | --- |
| C | Capital the first tier owes in total (below) |
| R | Capital returned so far |
| P | Preferred return paid so far |
| T | Preferred return accrued to the distribution date (below) |
| Π | Profit distributed so far: every amount after return of capital, to the LPs and the GP |
| G | The GP's share received so far, from every tier |
| L | Everything the LPs have received, return of capital included |
| Qᵢ | The GP's catch-up so far from catch-up tier i |

`rem` is what's left of the pool. Each tier takes `F = min(rem, want)` of it, with `want` never
below zero, and splits `F` between the LPs and the GP.

**Return of capital.** `want = C − R`, all to the LPs. `R += F`.

**Preferred return.** As a rate, `want = T − P`. As a multiple, `want = (multiple − 1) × C − P`.
All to the LPs. `P += F`.

**Catch-up**, target `t`, gpShare `k`:

- measure `preferred` (the default): the GP is owed `N = t × P ÷ (1 − t) − Qᵢ`, and `want = N ÷ k`. When the
  pool covers `want`, the GP gets exactly `N` and the LPs `want − N`; otherwise the GP gets
  `k × F`.
- measure `profit`: `want = (t × Π − G) ÷ (k − t)`. The GP gets `k × F` and the LPs the rest.
  When `F = want`, the GP holds exactly `t` of all profit.

**Split**, gpShare `g`. Without `until`, `want = rem`. With `until.lpMultiple` m,
`want = (m × C − L) ÷ (1 − g)`. With `until.lpIrr` r, `want = S ÷ (1 − g)`, where S is what the
LPs still need for their IRR to reach r on the distribution date:

```
S = Σ contributions × (1 + r)^years(contribution date → today)
  − Σ LP distributions so far, this one's earlier tiers included, × (1 + r)^years(date → today)
```

with ACT/365 years, carry-bearing contributions and LP distributions only, and S floored at zero.
The GP gets `g × F` and the LPs the rest.

Every tier's take is added to the state as it goes: an LP amount to L, a GP amount to G, and
anything after return of capital to Π.

## 4. What the first tier owes, and what the pref accrues on

**Whole-fund.** C is the carry-bearing partners' capital to date. The pref accrues on their dated
contributions (recontributions included).

**Deal by deal.** C is the carry-bearing capital in deals realized so far:

```
factor   = (carry-bearing capital ÷ all capital) × (1 + fees and expenses ÷ invested cost)
C        = min(carry-bearing cash capital, Σ realized cost × factor) + carry-bearing recontributions
```

where every figure is to the distribution date, "fees and expenses" are the contributions with
those purposes that count as capital, and invested cost is the sum of `investment` flows. A deal's
realized cost is what its write-offs and proceeds have taken out of it, so a written-off deal's
capital is owed back before carry on the next winner. Fees and expenses ride with the deals in
proportion to cost, and the GP's carry-free capital is left out. The pref accrues on each realized
slice from the date of the investment it came from (each investment in the deal, scaled by the
share of the deal's cost realized and by the factor), and on recontributions from their dates.

Deal-by-deal terms with no `investment` flows can't say which capital is in which deal, so they
run whole-fund, and the result warns.

**The preferred return accrued, T.** T is cumulative: everything accrued to the distribution date,
paid or not, because the tier compares it with cumulative P. A contribution dated on or after the
distribution date accrues nothing.

On the **`contributed`** base, each contribution accrues on its own from its date, as one
interval, and capital coming back doesn't stop it:

```
compounding:  T = Σ amount × ((1 + rate)^years − 1)
simple:       T = Σ amount × rate × years
```

On the **`unreturned`** base, walk the dated events in order. A contribution adds to unreturned
capital K. Each earlier distribution's return-of-capital lines take from K, and its
preferred-return lines from the unpaid pref U. On one date, contributions land first. Between
two events, over `years`:

```
compounding:  growth = (K + U) × ((1 + rate)^years − 1)
simple:       growth = K × rate × years
T += growth;  U += growth
```

K and U are floored at zero.

## 5. Lines and rounding

Each tier's LP amount is split across the carry-bearing partners by capital, and its GP amount
across the carry recipients by share. Together with the carry-free lines from step 2, every line
is rounded as [01-conventions.md](01-conventions.md) says, and the state is advanced by the
rounded lines: R by the return-of-capital lines, P by the preferred-return lines, Π, G, L and Qᵢ
likewise. Lines that round to zero are left out of the result.

## Worked example

100 contributed on 1 January 2026, 200 back on 1 January 2031. Tiers: return of capital, 8%
simple on contributed capital at 30/360, a catch-up to 20%, a 20% split.

| Tier | want | To the LP | To the GP | rem after |
| --- | --- | --- | --- | --- |
| Return of capital | 100 − 0 | 100.00 | | 100.00 |
| Preferred return | 100 × 0.08 × 5.0 − 0 | 40.00 | | 60.00 |
| Catch-up | (0.2 × 40 − 0) ÷ (1 − 0.2) = 10 | | 10.00 | 50.00 |
| Split | 50 | 40.00 | 10.00 | 0 |

The GP ends with 20.00 of the 100.00 of profit. This is the vector
`pref-30-360-simple-full-catch-up`.
