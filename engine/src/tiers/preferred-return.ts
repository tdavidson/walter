// Preferred return.
//
//   "Second, 100% to the Limited Partners until they have received an amount equal to a preferred
//    return of 8% per annum, compounded annually, on their unreturned Capital Contributions."
//
// As a rate, the tier owes what has accrued to the distribution date (hurdle.ts) less what it has
// paid. As a multiple, it owes (multiple − 1) × the capital the first tier owes, less what it has
// paid, so the LPs get `multiple` × capital through the two tiers together.

import { ZERO } from '../decimal.ts'
import type { NormalizedTier } from '../terms.ts'
import { take, type TierAmounts, type TierContext } from './context.ts'

export function preferredReturn(ctx: TierContext, tier: NormalizedTier): TierAmounts {
  const target = tier.multiple ? tier.multiple.minus(1).times(ctx.state.capital) : ctx.preferredAccrued()
  const out = take(ctx, target.minus(ctx.state.preferredPaid), () => ZERO)
  ctx.state.preferredPaid = ctx.state.preferredPaid.plus(out.lp)
  return out
}
