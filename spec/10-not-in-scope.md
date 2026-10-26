# Not in scope yet

LP classes arrived in 0.2 ([11-lp-classes.md](11-lp-classes.md)), with the parts of them that are
still out listed there.

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

The ILPA mapping is in [12-reporting.md](12-reporting.md). What it leaves to the fund's books:

| Row or figure | Why it's out |
| --- | --- |
| Each partner's management fee by window | `feesByPartner` is the whole schedule; per period by partner would be a new result field |
| Carry accrued by partner | The fund-end run would have to be done per partner |
| Offsets to expenses, rebates and waivers | Walter's offsets reduce the management fee only |
| Subscription facility flows | Credit facilities aren't modelled; the Performance Template's "with" and "without" returns are the same |
