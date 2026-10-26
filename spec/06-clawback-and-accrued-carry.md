# Clawback and accrued carry

Return of capital owes only capital contributed so far. That's the reading Walter takes, and it
means a strong early exit can pay the GP carry it isn't entitled to over the fund's life: the
capital called later, and the pref on it, still have to come back first. Clawback is how the LPA
settles that, so it's in 0.1 rather than left for later.

## The fund-end view

The GP's **entitlement** is the GP's share on the fund-end view of the same flows. The fund-end
view runs every flow up to the date with two changes:

- return of capital owes, from the first distribution, all the carry-bearing capital the fund
  contributes over the flows (recontributions included), not only what has been called so far;
- the waterfall runs whole-fund, whatever its basis, because a liquidation realizes every deal.

Everything else is unchanged: the same tiers, the same dated pref accrual, the same rounding.

## Clawback

At a `fund-end` flow, when `clawback.enabled` is true (the default):

```
paid         = the GP's share of every tier, to the fund-end date
entitlement  = the GP's share on the fund-end view of the flows to that date
clawback     = max(0, paid − entitlement)
```

The clawback is paid back by the carry recipients, by share, as negative `clawback` lines, and
received by the carry-bearing LPs, by capital, as positive ones, all dated at fund end. The result
reports `clawback: { date, paid, entitlement, amount }`. The GP is never topped up when the
entitlement is above what it was paid.

Vectors: `clawback-early-carry` (1.68 paid early and given back), `deal-by-deal-clawback` (a
winner's carry returned after a write-off), `roc-called-to-date` (early carry the fund-end view
agrees with, so no clawback), and `clawback-disabled`.

LPAs often cap a clawback at the carry received net of tax, or hold carry in escrow. Neither is in
0.1.

## Carry accrued at a NAV

At each `nav` flow the result reports what the GP would be entitled to if the fund liquidated at
that NAV that day:

```
entitlement  = the GP's share on the fund-end view of the flows to the date, plus a distribution of the NAV on it
paid         = the GP's share of every tier so far
accrued      = entitlement − paid
```

`accrued` is negative when the GP has been paid more than a liquidation would give it, which is
the clawback exposure on that date. This is the carried-interest line a capital account statement
needs, and deal-by-deal terms accrue exactly what whole-fund terms do, since a liquidation
realizes every deal.
