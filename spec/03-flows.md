# Flows

The flows are a JSON array, validated by [`schema/flows.schema.json`](../schema/flows.schema.json).
The spec takes them as given. Nothing about investment pacing or exit assumptions belongs here: a
forecasting tool decides the flows, and Walter says who gets what from them.

| Type | Fields | Meaning |
| --- | --- | --- |
| `contribution` | `partner`, `amount`, `purpose`, `recalled` | Capital a partner paid in. `purpose` is `investments` (the default), `fees`, `expenses` or `other`. `recalled` marks a recallable distribution called back, which is an ordinary contribution |
| `investment` | `deal`, `amount` | Cost put into a deal. Deal by deal, it's what realizations take capital out of; for fees on invested capital, it's the basis |
| `distributable` | `amount`, `deal`, `costExited`, `recycle` | Cash the fund distributes. With `deal`, it realizes `costExited` of the deal's cost (all that's left, by default). `recycle` holds back part of it ([05-recycling.md](05-recycling.md)) |
| `write-off` | `deal`, `costExited` | A deal written off: it realizes its cost with no proceeds |
| `nav` | `amount` | The fund's NAV on the date. It asks for carry accrued, and feeds fees on NAV |
| `portfolio-fee` | `kind`, `amount` | Fee income from a portfolio company: `transaction`, `monitoring`, `directors` or `other`. It offsets the management fee |
| `organizational-expense` | `amount` | Organizational expenses incurred, for the fee's expense cap |
| `event` | `name` | Something a fee step can wait for, such as `successor-fund` |
| `fund-end` | | The fund's end, where clawback is measured |

Every flow has a `date`.

## Order

Flows are processed in date order, and on one date in this order:

1. contributions and investments;
2. write-offs, events, portfolio fees and organizational expenses;
3. distributions, in the order the array lists them;
4. NAV;
5. fund end.

Within each step the array's order holds. The order matters in two places. A contribution dated
the same day as a distribution counts as capital to return in that distribution (and accrues no
pref, since it has had no time to). And a NAV on a distribution date is measured after the
distribution.
