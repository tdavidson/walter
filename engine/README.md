# @hemrock/waterline

The reference engine for [Waterline](../README.md), the open spec for venture fund economics.

```ts
import { run } from '@hemrock/waterline'

const result = run(terms, flows)
```

`run` takes a terms document and a list of flows, both as plain JSON with decimal strings, and
returns allocations by date, tier and partner, recontributions and recycling, the clawback,
carry accrued at each NAV, management fees by period, and each partner's totals. It throws a
`WaterlineError` with a stable `code` when the terms or flows can't be computed.

It's written to be read. Each tier is in its own file under `src/tiers/`, with the LPA wording it
implements at the top, and every figure is computed in decimal (`decimal.js` at 40 significant
digits) and rounded once per distribution, as the spec says.

| File | What it does |
| --- | --- |
| `terms.ts` | Defaults, presets, and the rules a tier list must follow |
| `flows.ts` | Checking flows and the order they're processed in |
| `hurdle.ts` | The preferred return accrued to a date, on either base, and the IRR shortfall |
| `tiers/*.ts` | Return of capital, preferred return, catch-up, split |
| `allocate.ts` | Every flow in order: carry-free slices, the tiers, deal by deal, recycling, clawback, accrued carry |
| `fees.ts` | Management fee periods, steps, offsets |
| `rounding.ts` | Largest remainder, partner totals first |

Apache 2.0.
