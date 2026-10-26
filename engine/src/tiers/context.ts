// What a tier sees: the cash left in this distribution and the waterfall's cumulative state on the
// carry-bearing side of the fund. The state already counts the earlier tiers of this distribution.

import { ZERO, min, pos, type Dec } from '../decimal.ts'
import type { Dated } from '../hurdle.ts'

export interface WaterfallState {
  /** Capital the return-of-capital tier owes back in total (contributed to date, or lifetime). */
  capital: Dec
  /** Returned so far by the return-of-capital tier. */
  returned: Dec
  /** Preferred return paid so far. */
  preferredPaid: Dec
  /** Profit distributed so far: everything after return of capital, to the LPs and the GP. */
  profit: Dec
  /** The GP's share received so far, from every tier. */
  gp: Dec
  /** Everything the LPs have received, return of capital included. */
  lp: Dec
  /** The GP's catch-up so far, per catch-up tier id. */
  catchUp: Map<string, Dec>
}

export interface TierContext {
  date: string
  state: WaterfallState
  /** The preferred return accrued to this date (cumulative). */
  preferredAccrued: () => Dec
  /** Carry-bearing contributions, dated, for an IRR hurdle. */
  lpContributions: Dated[]
  /** Carry-bearing LP distributions before this one, dated. */
  lpDistributions: Dated[]
  remaining: Dec
}

export interface TierAmounts {
  lp: Dec
  gp: Dec
}

/** Take up to `want` from what is left, and book it to the state. */
export function take(ctx: TierContext, want: Dec, gpShareOf: (taken: Dec) => Dec, isProfit = true): TierAmounts {
  const taken = min(ctx.remaining, pos(want))
  ctx.remaining = ctx.remaining.minus(taken)
  const gp = gpShareOf(taken)
  const lp = taken.minus(gp)
  if (isProfit) ctx.state.profit = ctx.state.profit.plus(taken)
  ctx.state.gp = ctx.state.gp.plus(gp)
  ctx.state.lp = ctx.state.lp.plus(lp)
  return { lp, gp }
}

export const nothing = (): TierAmounts => ({ lp: ZERO, gp: ZERO })
