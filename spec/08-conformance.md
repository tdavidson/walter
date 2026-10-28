# Conformance

## The result

An engine returns a document like [`schema/result.schema.json`](../schema/result.schema.json):

| Field | Holds |
| --- | --- |
| `allocations` | Every non-zero line: `date`, `tier` (a tier id, or `carry-free`, `recycled` or `clawback`), `partner`, `amount` |
| `recontributions` | Deemed recycling's contributions, by partner |
| `recycled` | Each recycle: date, amount, treatment |
| `clawback` | At a `fund-end`: `paid`, `entitlement`, `amount`, and from 0.3 the net-of-tax `cap` and the part paid `fromEscrow` |
| `accruedCarry` | At each `nav`: `nav`, `entitlement`, `paid`, `accrued`, and from 0.3 `byPartner` |
| `carry` | 0.3: the carry in each distribution, credited to its recipients and charged to the partners who bore it ([12-reporting.md](12-reporting.md)) |
| `escrow` | 0.3: carry escrow by recipient, held (negative) and released (positive) |
| `fees`, `feesByPartner` | Management fee periods (from 0.3 with the offset `recognized` by kind, the `unapplied` balance and the net fee `byPartner`), and the net total by partner |
| `totals` | Each partner's `contributed`, `distributed` (clawback and escrow included) and `net` |
| `warnings` | Anything worth a person's attention that isn't a refusal |

An engine may return only the parts it supports. A vector checks only the parts it states.

## Vectors

A vector is one JSON file in `vectors/<group>/<id>.json`, validated by
[`schema/vector.schema.json`](../schema/vector.schema.json):

```json
{
  "id": "pref-30-360-simple-full-catch-up",
  "walter": "0.1",
  "title": "30/360, simple pref, full catch-up",
  "description": "100 called, 200 back five years later ...",
  "tags": ["pref-simple", "day-count-30-360", "catch-up-full"],
  "provenance": "hand-computed",
  "terms": { "...": "..." },
  "flows": [ "..." ],
  "expected": {
    "allocations": [
      { "date": "2031-01-01", "tier": "return-of-capital", "partner": "lp-a", "amount": "100.00" }
    ],
    "totals": { "gp": "20.00", "lp-a": "180.00" }
  },
  "tolerance": "0.01"
}
```

What `expected` can hold, and how it's compared:

- `allocations`: summed by date, tier and partner, and compared both ways. A listed line the
  engine doesn't produce fails, and so does a non-zero line the engine produces that isn't listed.
- `totals`: each partner's total distributed.
- `clawback`: `amount`, and `entitlement`, `cap` and `fromEscrow` when given. `null` means there
  must be no clawback.
- `accruedCarry`: the entitlement at each listed date, and `byPartner` when given, compared both
  ways.
- `fees`: every period's gross, offset and net, and the number of periods. With `recognized`,
  every listed kind is compared, and a kind the engine reports that isn't listed must be zero;
  `unapplied` when given; `byPartner` when given, compared both ways.
- `carry` and `escrow`: summed by date and partner and compared both ways, like `allocations`.
- `recontributions`: by date and partner.
- `error`: the refusal code the engine must raise.

Each figure must be within `tolerance` (default `"0.01"`) of the expected one.

**Provenance** says where the answer came from. `hand-computed` means a person worked it out and
the description shows how. `ported: Portfolio spec v2, <id>` means it comes from the vectors the
Portfolio fund engine has run in CI, rewritten as terms and flows. `reference-engine` means the
reference engine computed it and a person reviewed it, and a vector like that should gain a hand
calculation over time.

The rules for adding one: one behaviour per vector, named and tagged, so a failure points at a
term rather than at "the waterfall". Where LPAs genuinely differ, the spec adds a term and ships a
vector for each value. A change that alters an expected answer needs a written reason in the pull
request.

## Running an engine

```sh
node runner/run.ts --engine ./my-adapter.ts --name "My engine" --version 1.2.0 --out results/my-engine.json
npm run compat
```

The adapter is any module that exports `run(terms, flows)`. It throws an error with a `code` to
refuse, and a code of `unsupported` for terms the engine can't express, which the runner reports
as unsupported rather than failed. `npm run compat` rebuilds [`COMPATIBILITY.md`](../COMPATIBILITY.md)
from every file in `results/`: one column per engine, one row per tag, and a list of each engine's
known differences.
