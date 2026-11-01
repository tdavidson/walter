# Walter

Walter works out the money in a venture fund: who gets each dollar when the fund pays out, how
much the GP earns in carry, what the management fee comes to, and what the GP owes back at the
end. It is an open spec, with 95 test cases and a free reference engine, so anyone can check
whether a spreadsheet, an administrator or a piece of fund software gets those numbers right.

## Why

Fund agreements (LPAs) are ambiguous in a handful of places that move real money: which capital
comes back before carry, whether the preferred return grows on all capital paid in or only on
capital not yet returned, what a "50% catch-up" is a catch-up to. Two systems can read the same
LPA differently and both look right on their own.

Hemrock found this firsthand. Its three engines that compute waterfalls agreed on simple terms and
gave different answers on real ones, and none of them was wrong by its own reading. Walter gives
each of those choices a name, so a reading is something you write down in the terms, not a
default hidden in someone's code. All three Hemrock engines now pass every test case.

## What it does

You give Walter two things:

- **The terms**: what the LPA says about the economics. For example, an 8% preferred return, a
  full catch-up, 20% carry, and a 2% fee that steps down to 1.5% after the investment period.
  You write these once in a short JSON file (example below), or start from a standard setup.
- **The cash flows**: what actually happened, with dates. Capital calls, investments, exits,
  write-offs and quarterly NAVs.

Walter gives back every line of every distribution, by partner and by step (return of capital,
preferred return, catch-up, carry), the management fee each period for each LP, the carry accrued
at each NAV, and any clawback the GP owes at the end of the fund.

## How people use it

1. **To check a number.** Put in your fund's terms and cash flows and compare Walter's answer with
   your administrator's distribution notice or your own model. If they differ, the terms show
   which reading of the LPA each side used.
2. **To check software.** Run a waterfall model or fund accounting system against the 95 test
   cases. Each is a small made-up fund with a known right answer. You get a scorecard of what it
   gets right, topic by topic, like the one in [COMPATIBILITY.md](COMPATIBILITY.md).
3. **To agree on terms.** A GP can write the fund's terms as a Walter file and give the same file
   to the administrator, the auditor and LPs, so everyone is checking against the same thing.
4. **To draft an LPA.** The spec lists the places LPA language is usually read more than one way.
   Each term can carry the LPA section and quote it came from.

The test cases are the core of Walter. The spec explains them, and the reference engine exists to
show they agree with each other. Specs like this traditionally call test cases "vectors", which is
why the folder and the spec pages use that word.

## What's in this repo

```
spec/      the spec, one short page per topic; start at spec/00-overview.md
schema/    JSON Schemas for terms, flows, results and test cases (draft 2020-12)
vectors/   the 95 test cases, one JSON file each, grouped by what they test
engine/    the TypeScript reference engine, @hemrock/walter
runner/    runs any engine against the test cases and builds COMPATIBILITY.md
results/   each engine's results
```

## For developers

The rest of this page is for people running the engine or testing their own.

### Example terms

```json
{
  "walter": "0.3",
  "fund": { "id": "example-fund-i", "currency": "USD" },
  "partners": [
    { "id": "gp", "role": "gp", "commitment": "2000000" },
    { "id": "lp-a", "role": "lp", "commitment": "98000000" }
  ],
  "waterfall": {
    "basis": "whole-fund",
    "tiers": [
      { "type": "return-of-capital" },
      { "type": "preferred-return", "rate": "0.08", "base": "unreturned" },
      { "type": "catch-up", "target": "0.20" },
      { "type": "split", "gpShare": "0.20" }
    ]
  },
  "recycling": { "cap": "0.20", "until": "2030-06-30" }
}
```

Flows are a dated list of contributions, investments, proceeds, write-offs, NAVs and fee income.
See [spec/02-terms.md](spec/02-terms.md) and [spec/03-flows.md](spec/03-flows.md) for every field.

### Using the reference engine

```ts
import { run } from '@hemrock/walter'

const result = run(terms, flows)
result.allocations // [{ date, tier, partner, amount }, ...]
```

Node 22.18 or later runs the TypeScript source directly. The one dependency is `decimal.js`.
The package isn't on npm yet, so for now clone this repository and import from
`engine/src/index.ts`.

### Running the test cases

```sh
npm install
npm test            # schema checks, every test case against the reference engine, unit tests
npm run vectors     # writes results/reference.json
npm run compat      # rebuilds COMPATIBILITY.md from results/
```

To test another engine, write an adapter that exports `run(terms, flows)` and run
`node runner/run.ts --engine ./adapter.ts --name "My engine" --out results/my-engine.json`. See
[spec/08-conformance.md](spec/08-conformance.md).

### Contributing a test case

Open a pull request with the test case file, a hand calculation in its description, and a
`provenance` line saying where the answer came from. One behaviour per test case. A change to an
existing expected answer needs a written reason: which was wrong, the test case or the spec, and why.

## Licence

Apache 2.0 for everything here: the spec text, the schemas, the test cases and the engine.
