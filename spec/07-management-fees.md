# Management fees

The management fee belongs in the spec because whether fees sit inside return of capital changes
the split, and because the fee itself is one of the numbers an LP most wants to check. The fee
engine reads the same terms and flows as the waterfall and reports a fee per period. It doesn't
create contributions: how the fee is funded (called from the LPs, netted from proceeds) is in the
flows.

```json
"managementFee": {
  "frequency": "quarterly",
  "start": "2026-01-01",
  "end": "2036-01-01",
  "schedule": [
    { "from": "2026-01-01", "rate": "0.02", "basis": "commitments" },
    { "from": { "event": "investment-period-end" }, "rate": "0.015", "basis": "invested" }
  ],
  "offsets": { "transaction": "1", "monitoring": "1", "directors": "1" },
  "organizationalExpenseCap": "500000"
}
```

## Periods

Periods start on `start` and step by the `frequency` (3, 6 or 12 months) on the calendar, a month
end clamping to the shorter month. A period runs from its first day up to, not including, the next
period's first day. The fee stops at `end`; a period that runs past it is cut there. Without `end`
the fee doesn't stop, and an engine may refuse to compute it.

## The schedule

Each step starts `from` a date or an event: `{ "event": "investment-period-end" }` takes
`fund.investmentPeriodEnd`, and any other name takes the date of the first `event` flow with that
name. A step whose event never happens doesn't apply. The step in force on a day is the latest one
that has started.

## The fee for a period

```
fee = Σ over the pieces of the period:
        rate ÷ periods per year × basis on the piece's first day × days in the piece ÷ days in the period
```

A period is in one piece unless a step starts inside it or `end` cuts it, and then it's cut at
those dates. The basis is the fee-bearing partners' share:

| Basis | Amount on a day |
| --- | --- |
| `commitments` | The fee-bearing partners' commitments |
| `invested` | Investment cost before the day, less cost realized before the day by proceeds and write-offs, × fee-bearing commitments ÷ all commitments |
| `nav` | The last NAV on or before the day, × fee-bearing commitments ÷ all commitments |

Each period's gross fee is rounded to the minor unit, half to even.

## Offsets

`offsets` gives, for each kind of portfolio-company fee income, the share that reduces the
management fee. The kinds are the ILPA Reporting Template's: `advisory`, `broken-deal`,
`transaction`, `directors`, `monitoring`, `capital-markets`, `arrangement`, `origination`,
`reimbursement` and `other`. Before 0.3 there were four (`transaction`, `monitoring`, `directors`,
`other`), and terms that offset any other kind must say `"walter": "0.3"`. A `portfolio-fee` flow dated in a period earns `amount × share` of offset in it.
Organizational expenses above `organizationalExpenseCap`, cumulative from the first one, also
offset the fee dollar for dollar in the period they're incurred.

A period's offset is the smaller of its gross fee and the offset available (what it earned plus
what earlier periods couldn't use), rounded to the minor unit. The net fee is gross less offset,
never below zero, and any offset left carries forward to the next period.

## The result

`fees` lists each period's `start`, `end`, `gross`, `offset` and `net`. From 0.3 each period
also has `recognized`, the offset it earned before any was applied, keyed by the kind of fee it
came from or `organizational` for expenses over the cap and each rounded to the minor unit, half to
even; and `unapplied`, the offset still to use at the period's end, rounded the same way. `offset`
is what was applied. ILPA reports all three ([12-reporting.md](12-reporting.md)). `feesByPartner` splits the
total net fee across the fee-bearing partners by commitment, by largest remainder. From 0.3 each
period also has `byPartner`, that period's net split the same way. Each period is rounded on its
own, so a partner's periods can differ from its `feesByPartner` total by a cent. Vector:
`reporting-fees-by-partner`.

## LP classes

A class can have fee steps of its own, a side letter's lower rate for instance. How they combine
with the fund's, and how offsets are shared between classes, is in
[11-lp-classes.md](11-lp-classes.md).
