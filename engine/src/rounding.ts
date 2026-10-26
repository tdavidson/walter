// Rounding is specified, because it is where two correct engines quietly disagree.
//
// Each distribution is computed exactly, then rounded to the currency's minor unit in two steps,
// each by largest remainder: first each partner's total for the distribution, so the partners add
// up to the distribution, then that partner's lines (one per tier) to its total. Ties go to the
// earlier item: partners in the order the terms list them, lines in tier order.

import { D, ZERO, type Dec } from './decimal.ts'

/** Round `values` to `minorUnits` places so they sum to `total` (already at that precision). */
export function largestRemainder(values: Dec[], total: Dec, minorUnits: number): Dec[] {
  const unit = new D(10).pow(-minorUnits)
  const floors = values.map((v) => v.toDecimalPlaces(minorUnits, D.ROUND_FLOOR))
  let short = total.minus(floors.reduce((s, x) => s.plus(x), ZERO)).div(unit).round().toNumber()
  const order = values
    .map((v, i) => ({ i, rem: v.minus(floors[i]) }))
    .sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i)
  const out = floors.slice()
  for (let j = 0; short > 0 && order.length > 0; j = (j + 1) % order.length, short--) {
    out[order[j].i] = out[order[j].i].plus(unit)
  }
  for (let j = order.length - 1; short < 0 && order.length > 0; j = (j - 1 + order.length) % order.length, short++) {
    out[order[j].i] = out[order[j].i].minus(unit)
  }
  return out
}

/** Split `total` across `weights` pro rata, by largest remainder. Equal shares when every weight is 0. */
export function apportion(total: Dec, weights: Dec[], minorUnits: number): Dec[] {
  if (weights.length === 0) return []
  const w = weights.reduce((s, x) => s.plus(x), ZERO)
  const shares = w.isZero()
    ? weights.map(() => total.div(weights.length))
    : weights.map((x) => total.times(x).div(w))
  return largestRemainder(shares, total, minorUnits)
}

/** Round lines grouped by partner: partner totals to `total` first, then each partner's lines to its total. */
export function roundByPartner(lines: { partner: string; exact: Dec }[], partnerOrder: string[], total: Dec, minorUnits: number): Dec[] {
  const ids = partnerOrder.filter((id) => lines.some((l) => l.partner === id))
  const exactTotals = ids.map((id) => lines.filter((l) => l.partner === id).reduce((s, l) => s.plus(l.exact), ZERO))
  const totals = largestRemainder(exactTotals, total, minorUnits)
  const out: Dec[] = lines.map(() => ZERO)
  ids.forEach((id, k) => {
    const idx = lines.map((l, i) => (l.partner === id ? i : -1)).filter((i) => i >= 0)
    const r = largestRemainder(idx.map((i) => lines[i].exact), totals[k], minorUnits)
    idx.forEach((i, j) => (out[i] = r[j]))
  })
  return out
}
