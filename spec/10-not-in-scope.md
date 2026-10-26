# Not in 0.1

## Next: LP classes (0.2)

Several LP classes with their own carry, pref and fee terms, side-letter fee discounts, first-loss
classes, and classes on their own capital call schedules. The fund economics tool already models
these, and they're the first thing 0.2 should add.

## Not planned yet

| Provision | Why it's out |
| --- | --- |
| Tax distributions | They depend on each partner's tax position |
| Carry escrow and holdbacks | Worth a flag on the terms first, then a vector or two |
| A clawback capped net of tax | Same as escrow: a term and a vector once the wording is settled |
| Interim clawback (before fund end) | Rare, and LPAs word it very differently |
| GP removal provisions | Not a computation |
| Hurdle compounding other than annual (quarterly, daily) | Easy to add as `compounding` values; no LPA in front of us uses one yet |
| Deal by deal on unrealized write-downs | 0.1 counts realized deals only |
| Anything needing a valuation policy | NAV is an input, never computed |
| Forecasting | The spec takes flows as given; pacing and exits belong to the tool |

## Reporting

ILPA's Reporting Template and Performance Template ask for carried interest accrued, earned and
paid in the capital account statement, a gross-to-net fee reconciliation with offsets by category,
and IRR with and without the subscription line. Walter's results (allocations by tier,
`accruedCarry`, fee periods with offsets) should map onto those rows line by line, and that
mapping should be published as a table here once it's been checked against the templates
themselves.
