// The preferred return accrued as at a date: cumulative, everything accrued whether paid or not,
// because the waterfall compares it with the cumulative preferred return paid.
//
// contributed base  Each contribution accrues from its own date to asOf, as one interval, and
//                   capital coming back does not stop it.
//                     compounding:  amount × ((1 + rate)^years − 1)
//                     simple:       amount × rate × years
// unreturned base   Walk the dated events. Contributions add to unreturned capital K, and each
//                   earlier distribution's return-of-capital tier takes from K and its preferred
//                   tier from the unpaid pref U. On one date contributions land first. Between
//                   events, over `years`:
//                     compounding:  growth = (K + U) × ((1 + rate)^years − 1)
//                     simple:       growth = K × rate × years
//
// A contribution dated on or after asOf accrues nothing. Nothing here is rounded.

import { ONE, ZERO, pos, type Dec } from './decimal.ts'
import { compareDates, yearFraction, type DayCount } from './dates.ts'

export interface Dated {
  date: string
  amount: Dec
  /** A recycled amount deemed recontributed. */
  deemed?: boolean
}

export interface Reduction {
  date: string
  capital: Dec
  preferred: Dec
}

export interface HurdleTerms {
  rate: Dec
  compounding: 'annual' | 'none'
  base: 'contributed' | 'unreturned'
  dayCount: DayCount
}

const growthFactor = (rate: Dec, years: Dec): Dec => ONE.plus(rate).pow(years).minus(1)

export function accruedPreferred(
  terms: HurdleTerms,
  contributions: Dated[],
  reductions: Reduction[],
  asOf: string,
): Dec {
  const { rate, compounding, dayCount } = terms
  if (rate.lte(0)) return ZERO
  const live = contributions.filter((c) => compareDates(c.date, asOf) < 0 && c.amount.gt(0))

  if (terms.base === 'contributed') {
    let total = ZERO
    for (const c of live) {
      const years = yearFraction(c.date, asOf, dayCount)
      total = total.plus(compounding === 'annual' ? c.amount.times(growthFactor(rate, years)) : c.amount.times(rate).times(years))
    }
    return total
  }

  type Event = { date: string; order: number; capital: Dec; preferred: Dec }
  const events: Event[] = [
    ...live.map((c) => ({ date: c.date, order: 0, capital: c.amount, preferred: ZERO })),
    ...reductions
      .filter((r) => compareDates(r.date, asOf) < 0)
      .map((r) => ({ date: r.date, order: 1, capital: pos(r.capital).neg(), preferred: pos(r.preferred) })),
  ].sort((a, b) => compareDates(a.date, b.date) || a.order - b.order)

  let capital = ZERO
  let unpaid = ZERO
  let accrued = ZERO
  let at = events.length > 0 ? events[0].date : asOf
  const accrueTo = (date: string) => {
    if (compareDates(date, at) <= 0) return
    const years = yearFraction(at, date, dayCount)
    const growth =
      compounding === 'annual' ? capital.plus(unpaid).times(growthFactor(rate, years)) : capital.times(rate).times(years)
    accrued = accrued.plus(growth)
    unpaid = unpaid.plus(growth)
    at = date
  }
  for (const e of events) {
    accrueTo(e.date)
    capital = pos(capital.plus(e.capital))
    unpaid = pos(unpaid.minus(e.preferred))
  }
  accrueTo(asOf)
  return accrued
}

/**
 * What the LPs must have received by `asOf` for their IRR to reach `irr`: the contributions grown
 * at `irr` to asOf, less the distributions grown the same way. ACT/365, annual compounding. A
 * contribution after asOf is discounted back, so a fund-end view counts capital still to come.
 */
export function irrShortfall(irr: Dec, contributions: Dated[], distributions: Dated[], asOf: string): Dec {
  const fv = (xs: Dated[]) =>
    xs.reduce((s, x) => s.plus(x.amount.times(ONE.plus(irr).pow(yearFraction(x.date, asOf, 'act/365')))), ZERO)
  return pos(fv(contributions).minus(fv(distributions)))
}

