// Return of capital.
//
//   "First, 100% to the Limited Partners until they have received cumulative distributions equal to
//    their aggregate Capital Contributions."
//
// Owed back is the capital contributed so far (Waterline 0.1 decision: never capital still to be
// called), or for a deal-by-deal waterfall the capital in deals realized so far. The fund-end view
// used for clawback owes all capital the fund ever called.

import { ZERO } from '../decimal.ts'
import { take, type TierAmounts, type TierContext } from './context.ts'

export function returnOfCapital(ctx: TierContext): TierAmounts {
  const owed = ctx.state.capital.minus(ctx.state.returned)
  const out = take(ctx, owed, () => ZERO, false)
  ctx.state.returned = ctx.state.returned.plus(out.lp)
  return out
}
