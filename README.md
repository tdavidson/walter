# Waterline

An open spec for venture fund economics: how a distribution is split between the LPs and the GP,
what the preferred return is on a given day, how recycled proceeds are booked, what the GP gives
back at fund end, and what the management fee comes to. It comes with test vectors and a
reference engine, so a claim like "supports Waterline 0.1" is something anyone can check.

```
spec/      the spec, one page per section; start at spec/00-overview.md
schema/    JSON Schemas for terms, flows, results and vectors (draft 2020-12)
vectors/   71 test vectors, one JSON file each, grouped by what they test
engine/    the TypeScript reference engine, @hemrock/waterline
runner/    runs any engine against the vectors and builds COMPATIBILITY.md
results/   each engine's results.json
```

## Why

Every fund engine has to decide what its LPA means, and LPAs are ambiguous in a handful of places
that move real money: which capital comes back before carry, whether the pref accrues on capital
contributed or capital still out, what a 50% catch-up is a catch-up to. Engines that read those
differently all look right on their own. Waterline gives each ambiguity a term with a name and
ships a vector for every value, so a reading is a choice you make in the terms and not a default
hidden in someone's code.

The vectors are the product. The schema exists so the vectors can be written down, and the
reference engine exists to show the vectors are consistent with each other.

## A terms document

```json
{
  "waterline": "0.1",
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
The engine returns every line of every distribution by tier and partner, the clawback, carry
accrued at each NAV, and the management fee by period.

## Using the reference engine

```ts
import { run } from '@hemrock/waterline'

const result = run(terms, flows)
result.allocations // [{ date, tier, partner, amount }, ...]
```

Node 22.18 or later runs the TypeScript source directly. The one dependency is `decimal.js`.

## Running the suite

```sh
npm install
npm test            # schema checks, every vector against the reference engine, unit tests
npm run vectors     # writes results/reference.json
npm run compat      # rebuilds COMPATIBILITY.md from results/
```

To test another engine, write an adapter that exports `run(terms, flows)` and run
`node runner/run.ts --engine ./adapter.ts --name "My engine" --out results/my-engine.json`. See
[spec/08-conformance.md](spec/08-conformance.md).

## Contributing a vector

Open a pull request with the vector file, a hand calculation in its description, and a
`provenance` line saying where the answer came from. One behaviour per vector. A change to an
existing expected answer needs a written reason: which was wrong, the vector or the spec, and why.

## Licence

Apache 2.0 for everything here: the spec text, the schemas, the vectors and the engine.
