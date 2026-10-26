// Split (carried interest).
//
//   "Thereafter, 80% to the Limited Partners and 20% to the General Partner."
//
//   "Fourth, 80% to the Limited Partners and 20% to the General Partner until the Limited Partners
//    have received distributions equal to 2.0 times their Capital Contributions" (until lpMultiple)
//    "... until the Limited Partners have achieved an internal rate of return of 15%" (until lpIrr)
//
// A split with `until` ends when the LPs' cumulative distributions, return of capital included,
// reach the multiple of the capital the first tier owes, or reach the amount that takes their IRR
// (ACT/365, from the dated contributions and distributions) to the rate. The flow needed is the
// LPs' shortfall ÷ (1 − gpShare). The last tier is a split with no `until` and takes the rest.

import { ONE, pos, ZERO, type Dec } from '../decimal.ts'
import { irrShortfall } from '../hurdle.ts'
import type { NormalizedTier } from '../terms.ts'
import { take, type TierAmounts, type TierContext } from './context.ts'

export function split(ctx: TierContext, tier: NormalizedTier): TierAmounts {
  const g = tier.gpShare
  let flow: Dec = ctx.remaining
  if (tier.untilMultiple) {
    const shortfall = pos(tier.untilMultiple.times(ctx.state.capital).minus(ctx.state.lp))
    flow = shortfall.div(ONE.minus(g))
  } else if (tier.untilIrr) {
    // The LP distributions so far include this distribution's earlier tiers, dated today.
    const paidToday = ctx.state.lp.minus(ctx.lpDistributions.reduce((s, d) => s.plus(d.amount), ZERO))
    const shortfall = irrShortfall(tier.untilIrr, ctx.lpContributions, [
      ...ctx.lpDistributions,
      { date: ctx.date, amount: paidToday },
    ], ctx.date)
    flow = shortfall.div(ONE.minus(g))
  }
  return take(ctx, flow, (x) => x.times(g))
}
