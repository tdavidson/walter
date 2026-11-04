# Walter

Walter calculates the money in a venture fund. Give it the fund's terms and its cash flows, and it
tells you who gets each dollar when the fund pays out, how much carry the GP earns, what the
management fee comes to for each LP, and what the GP owes back at the end. Install it from npm and
run it from the command line, or call it from your own code.

```sh
npm install -g @hemrock/walter
walter init                        # writes an example terms.json and flows.json
walter run terms.json flows.json   # prints each partner's distributions, fees and carry
```

```
Distribution on 2032-09-30
step                         gp           lp-a           lp-b
return-of-capital    400,000.00  24,000,000.00  15,600,000.00
carry-free           700,000.00           0.00           0.00
preferred-return           0.00  16,231,152.80  10,550,249.32
catch-up           6,695,350.53           0.00           0.00
split              7,164,649.47  17,368,847.20  11,289,750.68
```

Add `--json` for the full result: every line of every distribution, fees by period and partner,
carry accrued at each NAV, clawback and escrow.

## What you give it

- **The terms**: what the LPA says about the economics. For example, an 8% preferred return, a
  full catch-up, 20% carry, and a 2% fee that steps down to 1.5% after the investment period.
  Edit the `terms.json` that `walter init` writes, or see [spec/02-terms.md](spec/02-terms.md)
  for every option.
- **The cash flows**: what happened, with dates. Capital calls, investments, exits, write-offs and
  NAVs. See [spec/03-flows.md](spec/03-flows.md).

## What people use it for

- **Running a fund's waterfall.** Work out a distribution before it goes out, or carry accrued at
  quarter end, from the LPA's terms.
- **Checking someone else's numbers.** Compare Walter's answer with an administrator's distribution
  notice or your own spreadsheet.
- **Building fund software.** Call Walter from your code instead of writing a waterfall engine, or
  test your own engine against Walter's 95 test cases (below).
- **Writing terms down once.** The terms file names every choice an LPA leaves open, so the GP,
  administrator, auditor and LPs can all work from the same file.

## Why we built it

LPAs are ambiguous in a handful of places that move real money: which capital comes back before
carry, whether the preferred return grows on all capital paid in or only on capital not yet
returned, what a "50% catch-up" is a catch-up to. Hemrock had three engines that computed
waterfalls, and on real terms they gave different answers. None was wrong by its own reading. Each
had made a choice in code that nobody had written down.

Walter gives each of those choices a name in the terms, and every choice comes with test cases: a
small fund with a worked answer. All three Hemrock engines now use the same terms and pass every
test case. Specs like this traditionally call test cases "vectors", which is why the folder and the
spec pages use that word.

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

The rest of this page is for people calling Walter from code or testing their own engine.

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

### Using it in code

```ts
import { run } from '@hemrock/walter'

const result = run(terms, flows)
result.allocations // [{ date, tier, partner, amount }, ...]
```

`npm install @hemrock/walter` for use in your code. It runs on Node 18 or later and its one
dependency is `decimal.js`. Inside this repo, Node 22.18 or later runs the TypeScript source
directly, with no build step.

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
