// GP catch-up.
//
//   "Third, 100% to the General Partner until it has received 20% of the sum of all amounts
//    distributed under clause (ii) and this clause (iii)."                    (measure: profit)
//
//   "Third, 80% to the General Partner and 20% to the Limited Partners until the General Partner has
//    received an amount equal to 25% of the preferred return distributed."   (measure: preferred)
//
// measure profit     With Π the profit distributed so far and G the GP's share of it, the GP is
//                    caught up when G + k·F = t·(Π + F), so the flow is F = (t·Π − G) ÷ (k − t).
// measure preferred  The GP is owed N = t·P ÷ (1 − t) less this tier's catch-up so far, where P is
//                    the preferred return paid; the flow is F = N ÷ k and the LPs keep 1 − k of it.
//
// With a gpShare (k) of 1 the two are the same number. They part when the LPs share the catch-up
// flow: on 8% compounding over five years and a 50% gpShare, the GP ends at 20.00 of 100 of
// profit under `profit` and at 17.65 under `preferred`.

import { ONE, min, pos, ZERO } from '../decimal.ts'
import type { NormalizedTier } from '../terms.ts'
import { take, type TierAmounts, type TierContext } from './context.ts'

export function catchUp(ctx: TierContext, tier: NormalizedTier): TierAmounts {
  const t = tier.target
  const k = tier.gpShare
  const s = ctx.state
  const before = s.catchUp.get(tier.id) ?? ZERO

  if (tier.measure === 'profit') {
    const flow = pos(t.times(s.profit).minus(s.gp)).div(k.minus(t))
    const out = take(ctx, flow, (x) => x.times(k))
    s.catchUp.set(tier.id, before.plus(out.gp))
    return out
  }

  const owed = pos(t.times(s.preferredPaid).div(ONE.minus(t)).minus(before))
  const flow = owed.div(k)
  // When the flow is all there, the GP gets exactly what it is owed and the LPs the rest.
  const full = ctx.remaining.gte(flow)
  const out = take(ctx, flow, (x) => (full ? min(owed, x) : x.times(k)))
  s.catchUp.set(tier.id, before.plus(out.gp))
  return out
}
