# Waterline 0.1

Waterline is an open, machine-readable description of how a venture fund's economics work: who
gets which dollar of a distribution, what the preferred return is on a given day, when the GP
catches up, how recycled proceeds are booked, what the GP gives back at the end, and what the
management fee comes to. It has three parts, and they're meant to be read together.

- **The spec**, these pages. They say what every term means and how to compute it, precisely
  enough that two people who have never met write engines that agree to the cent.
- **The test vectors** in `vectors/`. Each one is a JSON file holding terms, dated flows and the
  answer. The vectors are the product. Prose can be read two ways; a vector can't.
- **The reference engine** in `engine/`, a small TypeScript package that passes every vector. It
  exists to prove the vectors are consistent with each other, not to be the only way to run them.

The reason this exists is that there's no oracle for fund economics. Hemrock has three engines that
compute waterfalls, and on the same plain terms they agree. They part ways on catch-up size, on
which pref base applies, and on which capital comes back first, and none of them was wrong by its
own lights. Each was reading an ambiguous term one way. Waterline turns each of those ambiguities
into a term with a name and a vector for every value, so nothing gets quietly decided.

## Scope

0.1 covers the distribution waterfall and the management fee that feeds it:

- whole-fund and deal-by-deal waterfalls, with return of capital on capital contributed so far
  (with or without fees and expenses), a preferred return as a simple or compounding rate on
  contributed or unreturned capital or as a flat multiple, full, partial and split catch-ups, and
  carry that steps up at a multiple or an IRR;
- a GP commit that pays no carry, and carry shared between several recipients;
- recycling, chosen on each distribution, as never distributed or as deemed distributed and
  recontributed, inside the LPA's cap and end date;
- clawback at fund end, and carry accrued at a NAV;
- management fees on commitments, invested capital or NAV, with step-downs at a date or an event,
  fee offsets and an organizational expense cap.

What it leaves out is in [10-not-in-scope.md](10-not-in-scope.md). The big one for 0.2 is LP
classes.

## Reading order

| Page | What it covers |
| --- | --- |
| [01-conventions.md](01-conventions.md) | Decimal strings, dates, day counts, rounding, refusals |
| [02-terms.md](02-terms.md) | The terms document: partners, tiers, presets, recycling, clawback, fees |
| [03-flows.md](03-flows.md) | The flows: contributions, investments, proceeds, write-offs, NAV, events |
| [04-distributions.md](04-distributions.md) | How a distribution is split, tier by tier |
| [05-recycling.md](05-recycling.md) | The two recycling treatments and the cap |
| [06-clawback-and-accrued-carry.md](06-clawback-and-accrued-carry.md) | The fund-end view, clawback, carry accrued at NAV |
| [07-management-fees.md](07-management-fees.md) | Fee periods, steps, offsets |
| [08-conformance.md](08-conformance.md) | Results, vectors, the runner and the compatibility table |
| [09-existing-engines.md](09-existing-engines.md) | How the terms map onto the engines that already exist |
| [10-not-in-scope.md](10-not-in-scope.md) | What 0.1 doesn't model |

## Conformance language

"Must" is a requirement: an engine that does otherwise fails a vector. "Should" is a
recommendation the vectors don't test. Where these pages and a vector disagree, the vector is
right until the disagreement is fixed in a pull request that says which one was wrong and why.

## Versioning

The terms, flows and result documents each carry `"waterline": "0.1"`. A change that alters an
expected answer, or the meaning of an existing term, is a new minor version until 1.0. Adding a
term whose absence keeps today's behaviour is not.

## Licence

The spec text, the schemas, the vectors and the engine are all under the Apache License 2.0. A
fund administrator can ship the vectors inside a closed product as long as it keeps the notice,
and the licence's patent grant covers anyone who implements the spec.
