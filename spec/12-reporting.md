# Reporting

LPs read a fund's economics through ILPA's templates: the Reporting Template (v. 2.0, January
2025), a partner's quarterly capital account statement, and the Performance Template (Granular
Methodology, v. 1.1), the cash flows its IRRs and multiples are computed from. This page says
which Walter result fills which row. Where a row needs something Walter doesn't compute, it says
so, and those rows are the fund's books to fill.

The templates are ILPA's, and the row labels below are quoted from them. Walter isn't affiliated
with or endorsed by ILPA.

0.3 added these to the result so the rows could be filled at all:

- `carry`, which says who paid the carry in each distribution as well as who received it;
- `fees[].recognized`, the offset earned in each period by where it came from, and
  `fees[].unapplied`, the offset balance carried forward;
- `fees[].byPartner`, each period's fee by partner, and `accruedCarry[].byPartner`, the accrued
  carry by partner;
- `escrow`, the carry held back and released.

It also widened the kinds of portfolio-company fee to the template's categories. Nothing in 0.1 or
0.2 changed meaning.

## Windows and columns

The Reporting Template states every figure quarter to date, year to date and inception to date,
in three columns: the partner, the whole fund including the GP, and the GP. Walter's results are
dated, so a window is a sum over the lines dated inside it. Allocations, carry and recontributions
are dated on the distribution; a fee period belongs to the window its `start` falls in. Balances
(the unapplied offset, carry accrued at a NAV) are read at the window's end.

The fund column is every partner's lines added up, and the GP column is the lines of the partners
whose `role` is `gp`.

## A.1 The NAV reconciliation

| Row | From |
| --- | --- |
| Contributions – Cash & Non-Cash | `contribution` flows, plus `recontributions` |
| Distributions – Cash & Non-Cash | `allocations`, every tier except `clawback`, shown negative |
| (Management Fees – Gross of Offsets, Waivers & Rebates) | `fees[].gross` |
| Less Offsets to Management Fees (Applied During Period) | `fees[].offset` |
| (Management Fees – Net of Offsets, Waivers & Rebates) | `fees[].net` |

The fee rows are the fund's. The partner column of the net fee row is the sum of the partner's
`fees[].byPartner` over the periods in the window. Gross and offset aren't split by partner, so
for those rows the partner column is the partner's share of the period's net, applied to the
period's gross and offset. `feesByPartner` is the inception-to-date total, rounded once. Walter's
offsets only reduce the management fee, so the expense offset rows are zero, and rebates and
waivers aren't modelled.

Contributions with `purpose` `fees` or `expenses` are still contributions here. The template's
expense rows (legal, audit, administration and the rest) are the fund's books, not the terms.

## A.1 Offset categories

`fees[].recognized` holds what each period earned, keyed by kind:

| `recognized` key | Row |
| --- | --- |
| `advisory` | Advisory & Consulting Fee Offset |
| `broken-deal` | Broken Deal Fee Offset |
| `transaction` | Transaction & Deal Fee Offset |
| `directors` | Directors Fee Offset |
| `monitoring` | Monitoring Fee Offset |
| `capital-markets` | Capital Markets Fee Offset |
| `arrangement` | Arrangement Fee Offset |
| `origination` | Origination Fee Offset |
| `organizational` | Organization Cost Offset |
| `reimbursement`, `other` | Other Offsets* |

The template has no offset row for reimbursements, so an LPA that offsets them reports them under
Other, which the template asks to be footnoted. Placement Fee Offset is zero: Walter has no
placement fees.

Then the totals and the roll-forward:

| Row | From |
| --- | --- |
| Total Offsets to Fees & Expenses (Recognized During Period) | The sum of `fees[].recognized` |
| Total Offsets to Fees & Expenses (Applied During Period) | The sum of `fees[].offset` |
| Unapplied Offset Balance (Roll-forward) – Beginning Balance | `fees[].unapplied` of the period before the window, or zero |
| Unapplied Offset Balance (Roll-forward) – Ending Balance | `fees[].unapplied` of the window's last period |

Recognized and unapplied amounts are each rounded to the minor unit on their own, half to even,
so beginning plus recognized less applied can differ from the ending balance by a cent.

## A.1 Carried interest

`carry` lists the carry in each distribution from both sides. A recipient is credited what it
received through the tiers' GP share. Each class's carry is charged to that class's carry-bearing
partners, by the weights their own lines in the distribution were split by, and rounded by
largest remainder so it adds up to the class's carry. A partner on both sides, a GP whose own
commit bears carry, is shown net. So the lines for a distribution add up to zero, which is how the
template's fund column shows carry, and a limited partner's lines are negative.

| Row | From |
| --- | --- |
| Carried Interest Accrued (Unrealized Profits) | The partner's `accruedCarry[].byPartner` at the NAV on or before the window's end; the fund's is `accrued` |
| Carried Interest Earned (Realized Profits, Inclusive of Amount Held in Escrow) | The partner's `carry` lines in the window |
| Carried Interest – Paid During the Period | The same lines, plus the recipient's `escrow` lines in the window |
| Returned Clawback | `clawback.amount`, credited to the classes that overpaid as the `clawback` allocations show |
| Carried Interest: Amount Held in Escrow – Ending Period Balance | The recipient's `escrow` lines to the window's end, negated |

Accrued carry is a balance, not a flow, so its window figure is the change: the accrual at the
window's end less the accrual at its start. `accruedCarry[].byPartner` charges each class's accrual
to its carry-bearing partners by capital, so a limited partner's line is negative and a
recipient's positive, as with `carry` ([06-clawback-and-accrued-carry.md](06-clawback-and-accrued-carry.md)).

## A.2 The commitment reconciliation

| Row | From |
| --- | --- |
| Total Commitment | `partners[].commitment` |
| (Less Contributions) | `contribution` flows, with `recalled` ones included |
| Plus Recallable Distributions | The `recycled` allocations under the deemed treatment |
| (Less Expired/Released Commitments), +/- Other Unfunded Adjustment | Not in Walter |

A deemed recycle is a recallable distribution and a recontribution on the same day, so it leaves
the unfunded commitment where it was. A recycle that's never distributed doesn't touch A.2 at all:
the proceeds fund what would have been called, and the contribution never happens.

## B.1 Fees received from portfolio companies

`portfolio-fee` flows, at their full amount (not the offset share), dated in the window:

| `kind` | Row |
| --- | --- |
| `advisory` | Advisory & Consulting Fees |
| `broken-deal` | Broken Deal Fees |
| `transaction` | Transaction & Deal Fees |
| `directors` | Directors Fees |
| `monitoring` | Monitoring Fees |
| `capital-markets` | Capital Markets Fees |
| `arrangement` | Arrangement Fees |
| `origination` | Origination Fees |
| `other` | Other Fees* |
| `reimbursement` | Total Reimbursements for Travel & Administrative Expenses |

B.1 is the fund's; the template's partner column states the partner's share of commitments.

## The Performance Template

The Performance Template computes eight returns from typed cash flows: net and gross, IRR and
multiple, each with and without the fund-level subscription facility. Walter's flows and results
give the types below. Credit facilities aren't in Walter, so the subscription facility types are
the fund's books to add, and without a facility the "with" and "without" returns are the same.

| Transaction type | From |
| --- | --- |
| Capital Call: Investments | `contribution` flows with `purpose` `investments`, and `recontributions` |
| Capital Call: Management Fees/Partnership Expenses | `contribution` flows with `purpose` `fees` or `expenses` |
| Capital Call: Working Capital | `contribution` flows with `purpose` `other` |
| Distribution: Permanent | Allocations to limited partners, except `recycled` and `clawback` |
| Distribution: Recallable | `recycled` allocations under the deemed treatment |
| Carry / Clawback | The recipients' `carry` lines and `escrow` lines, and the `clawback` allocations to them |
| Quarter-end Adjustment for Carry Allocation | `accruedCarry[].accrued` at each quarter-end NAV |
| NAV | `nav` flows |

Net returns are the limited partners' flows; gross adds back the carry, which is why the template
puts carry and its quarter-end accrual in the gross series only. A GP's own commit is a partner
like any other here, and the template leaves it to the fund whether to include it.

## Vectors

The `reporting` group checks what 0.3 added: offsets recognized by kind with the unapplied
balance, carry paid and borne (with a carry-free GP commit, a GP whose commit bears carry, and two
classes on different carry), each period's fee by partner, accrued carry by partner, and that a 0.2
document offsetting a 0.3 kind is refused. Escrow is in the `clawback` group. The rows above are
arithmetic on those results, so they aren't vectors of their own.
