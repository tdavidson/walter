// One distribution through the tiers, on the carry-bearing side of the fund. Exact, unrounded:
// the caller rounds the lines and books what was actually paid back into the state.

import { ZERO, type Dec } from './decimal.ts'
import type { NormalizedTier } from './terms.ts'
import { catchUp } from './tiers/catch-up.ts'
import type { TierAmounts, TierContext, WaterfallState } from './tiers/context.ts'
import { preferredReturn } from './tiers/preferred-return.ts'
import { returnOfCapital } from './tiers/return-of-capital.ts'
import { split } from './tiers/split.ts'

export interface TierResult extends TierAmounts {
  tier: NormalizedTier
}

export function runTiers(tiers: NormalizedTier[], ctx: TierContext): TierResult[] {
  const out: TierResult[] = []
  for (const tier of tiers) {
    if (ctx.remaining.lte(0)) {
      out.push({ tier, lp: ZERO, gp: ZERO })
      continue
    }
    let amounts: TierAmounts
    switch (tier.type) {
      case 'return-of-capital':
        amounts = returnOfCapital(ctx)
        break
      case 'preferred-return':
        amounts = preferredReturn(ctx, tier)
        break
      case 'catch-up':
        amounts = catchUp(ctx, tier)
        break
      case 'split':
        amounts = split(ctx, tier)
        break
    }
    out.push({ tier, ...amounts })
  }
  return out
}

export const cloneState = (s: WaterfallState): WaterfallState => ({ ...s, catchUp: new Map(s.catchUp) })

export const emptyState = (capital: Dec = ZERO): WaterfallState => ({
  capital,
  returned: ZERO,
  preferredPaid: ZERO,
  profit: ZERO,
  gp: ZERO,
  lp: ZERO,
  catchUp: new Map(),
})
