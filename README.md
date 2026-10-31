# Walter

An open spec for venture fund economics: how a distribution is split between the LPs and the GP,
what the preferred return is on a given day, how recycled proceeds are booked, what the GP gives
back at fund end, and what the management fee comes to. It comes with test vectors and a
reference engine, so a claim like "supports Walter 0.3" is something anyone can check.

In plain terms: give Walter a fund's LPA terms and its dated cash flows, and it says who gets
every dollar, to the cent, along with a worked example for each of the ways LPAs are commonly
read. Two pieces of software that both pass the vectors will give the same answer on the same
fund.

```
spec/      the spec, one page per section; start at spec/00-overview.md
schema/    JSON Schemas for terms, flows, results and vectors (draft 2020-12)
vectors/   95 test vectors, one JSON file each, grouped by what they test
engine/    the TypeScript reference engine, @hemrock/walter
runner/    runs any engine against the vectors and builds COMPATIBILITY.md
results/   each engine's results.json
```

## Why

Every fund engine has to decide what its LPA means, and LPAs are ambiguous in a handful of places
that move real money: which capital comes back before carry, whether the pref accrues on capital
contributed or capital still out, what a 50% catch-up is a catch-up to. Engines that read those
differently all look right on their own. Walter gives each ambiguity a term with a name and
ships a vector for every value, so a reading is a choice you make in the terms and not a default
hidden in someone's code.

The vectors are the product. The schema exists so the vectors can be written down, and the
reference engine exists to show the vectors are consistent with each other.

## Who it's for

- **Teams building fund software** (fund administration, accounting, LP portals, carry and
  waterfall models). Run the vectors against your engine to find where it reads an LPA differently
  from everyone else, and publish the compatibility table so customers can see it.
- **GPs and fund CFOs.** Write your fund's terms as a Walter terms document and every ambiguous
  choice in the waterfall is spelled out. Hand the same document to your administrator, your
  auditor and your own model, and they're checking against the same thing.
- **LPs and their advisers.** Ask a manager or administrator which Walter version their numbers
  conform to, and recompute a distribution notice yourself with the reference engine.
- **Fund lawyers.** The spec lists the places LPA language is usually read more than one way.
  Each `source` field ties a term back to the LPA section and quote it came from.

## How to use it

1. **Read the spec.** Start at [spec/00-overview.md](spec/00-overview.md). Each page is short and
   says exactly what a term means and how it's computed.
2. **Write your terms.** Describe the fund's waterfall, recycling, clawback and fees as a terms
   document (below), or start from a preset. Validate it against
   [schema/terms.schema.json](schema/terms.schema.json).
3. **Run it.** Pass the terms and the fund's flows to the reference engine, or to your own engine.
4. **Check an engine.** Point the runner at any engine and see which vectors it passes, tag by
   tag, in [COMPATIBILITY.md](COMPATIBILITY.md).

## A terms document

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
The engine returns every line of every distribution by tier and partner, the clawback and any
carry held in escrow, carry accrued at each NAV by partner, and the management fee by period and
partner.

## Using the reference engine

```ts
import { run } from '@hemrock/walter'

const result = run(terms, flows)
result.allocations // [{ date, tier, partner, amount }, ...]
```

Node 22.18 or later runs the TypeScript source directly. The one dependency is `decimal.js`.
The package isn't on npm yet, so for now clone this repository and import from
`engine/src/index.ts`.

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
