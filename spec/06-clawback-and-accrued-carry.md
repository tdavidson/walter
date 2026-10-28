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
received by the carry-bearing LPs, by capital, as positive ones, all dated at fund end. With LP
classes the amount goes to the classes that overpaid, in proportion to how much each overpaid
([11-lp-classes.md](11-lp-classes.md)). The result
reports `clawback: { date, paid, entitlement, amount }`. The GP is never topped up when the
entitlement is above what it was paid.

Vectors: `clawback-early-carry` (1.68 paid early and given back), `deal-by-deal-clawback` (a
winner's carry returned after a write-off), `roc-called-to-date` (early carry the fund-end view
agrees with, so no clawback), and `clawback-disabled`.

## Net of tax

Most LPAs don't ask the GP to give back more than it kept after tax on the carry it was paid. From
0.3, `clawback.netOfTax.rate` says so:

```
cap     = paid × (1 − rate), rounded half to even
amount  = min(cap, max(0, paid − entitlement))
```

The rate is an assumed one, the way LPAs write it ("the highest combined marginal rate"), not a
partner's actual tax. The result adds `cap`. The amount is shared out across classes and recipients
as before. Vector: `clawback-net-of-tax`.

## Escrow

From 0.3, `clawback.escrow` holds back a share of each carry payment to secure the clawback. In each
distribution, `share` of what each recipient receives through the tiers' GP share is held. Each
recipient's amount is rounded to the minor unit, half to even. The allocations still show the carry
as paid, because the waterfall has paid it and the clawback measures against it. The new `escrow`
result lists each recipient's held amounts as negative lines and its released amounts as positive
ones, and `totals` count them, so a recipient's total is the cash it actually received.

`release` says when the escrow is paid out:

- `fund-end` (the default) releases the whole balance at the `fund-end` flow. The clawback is
  measured first, and `clawback.fromEscrow` reports how much of it the balance covered: each
  recipient's repayment, as far as its balance goes. The clawback lines and the release are both
  dated at fund end. A recipient whose balance covers its clawback pays nothing in cash and
  receives the difference.
- `{ "lpMultiple": "1.5" }` releases the balance once the carry-bearing LPs (partners with role
  `lp`) have received, in total, that multiple of everything they contributed. It is checked after
  each distribution, counting that distribution. Once the multiple is reached, nothing more is held
  and the balance is released the same day. A recipient's escrow lines on one date are shown net.
  Anything still held at fund end is released there.

Interim releases on a coverage ratio, or escrow that earns interest, aren't modelled. Vectors:
`clawback-escrow-covers-clawback`, `clawback-escrow-released-at-fund-end`,
`clawback-escrow-released-at-lp-multiple`, and `clawback-escrow-needs-0-3` for the refusal of an
escrow in 0.2 terms.

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

From 0.3, `accruedCarry[].byPartner` splits it from both sides, the way `carry` splits carry paid.
The recipients are credited `accrued` by their shares. Each class's own accrual (its entitlement on
the fund-end view, less what its tiers have paid the GP) is charged to its carry-bearing partners by
the capital that counts for the waterfall. The charges are rounded by largest remainder so they add
up to `accrued`. A partner on both sides is shown net, so the lines add up to zero. Vector:
`reporting-accrued-carry-by-partner`.
