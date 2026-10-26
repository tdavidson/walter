# Recycling

Recycling is exit proceeds a fund puts back to work instead of distributing. The LPA sets the
limits (a cap, an end date, sometimes what it may pay for), and within them the GP decides each
time. So the terms hold the limits and each distribution says how much of it was recycled:

```json
{ "date": "2028-09-30", "type": "distributable", "deal": "deal-a", "amount": "40000000",
  "recycle": { "amount": "8000000", "treatment": "never-distributed" } }
```

## Limits

A recycle is refused when:

- the terms have no `recycling` (`recycling-not-permitted`);
- it's larger than the proceeds it comes from (`recycle-exceeds-proceeds`);
- its date is after `recycling.until` (`recycle-after-end`);
- the total recycled so far, this one included and both treatments counted, would pass `cap` ×
  the cap basis (`recycle-over-cap`). On `commitments` the basis is all partners' commitments; on
  `management-fees` it's the contributions with purpose `fees` to the date.

`uses` is recorded and not enforced. Only the rest of the proceeds goes through the waterfall.

## Two treatments

The two treatments mean different things to the LPs, and both are common enough that an engine
must support both. A recycle with no `treatment` takes `recycling.defaultTreatment`, which is
`never-distributed` unless the terms say otherwise.

**Never distributed.** The money was never the LPs' to receive. Nothing is allocated, called
capital stays lower by the amount (because the fund calls less later, which is already in the
flows), and nothing is owed back on it.

**Deemed distributed and recontributed.** It counts as paid to the partners and contributed
again, the same day. Each partner's share, split by commitment, appears twice in the result: as
a `recycled` allocation and as a recontribution. In the waterfall state, capital owed and capital
returned both rise by the carry-bearing share, and the recontribution is dated capital for the
preferred return.

On an `unreturned` pref the two treatments give the same split, because K rises and falls by the
same amount on the same day. On a `contributed` pref the deemed version grows the hurdle: the
recontribution accrues from its date. Paid-in capital, DPI, TVPI and unfunded commitment differ
either way, and the recontribution is recallable, so it doesn't use up commitment.

Vectors: `recycling-never-distributed`, `recycling-deemed-unreturned` (the same split as the
first), `recycling-deemed-contributed` (174.40 of pref against 166.40), the default treatment,
and four refusals.

## Recallable distributions

Recallable distributions are the same idea after the fact: cash goes out through the waterfall and
comes back as a contribution. In Walter that's an ordinary distribution followed by a
`contribution` marked `recalled: true`.
