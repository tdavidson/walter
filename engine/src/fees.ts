// Management fees.
//
//   "The Partnership shall pay the Manager a management fee, quarterly in advance, equal to 0.5% of
//    aggregate Commitments (2% per annum) until the end of the Investment Period, and thereafter
//    0.375% of Invested Capital (1.5% per annum). The fee shall be reduced by 100% of Transaction
//    Fees and Monitoring Fees, and by Organizational Expenses in excess of $500,000."
//
// Periods start on `start` and step by the frequency, on calendar months. Each period's fee is
// rate ÷ periods-per-year × the basis on the period's first day, for the fee-bearing partners.
// A period that a schedule step or `end` cuts is split at that date, and each piece is prorated by
// its days over the period's days. Offsets earned in a period reduce that period's fee, never below
// zero, and what is left carries forward. Nothing here is rounded until the period's figures are
// final.
//
// A class with rates of its own (0.2) pays them on its own partners' basis: their commitments, or
// their commitments' share of invested capital or NAV. The fund's frequency, dates, offsets and
// expense cap apply to every class, and an offset reduces each class's fee in proportion to it.

import { D, ZERO, dec, money, pos, sum, type Dec } from './decimal.ts'
import { addMonths, compareDates, daysBetween } from './dates.ts'
import { fail } from './errors.ts'
import { apportion } from './rounding.ts'
import { FUND_CLASS, type NormalizedTerms } from './terms.ts'
import type { FeeStep, Flow } from './types.ts'

export interface FeePeriod {
  start: string
  end: string
  gross: string
  offset: string
  net: string
}

const MONTHS = { quarterly: 3, semiannual: 6, annual: 12 } as const

export function managementFees(nt: NormalizedTerms, flows: Flow[]): { periods: FeePeriod[]; byPartner: Record<string, string> } {
  const fee = nt.raw.managementFee
  if (!fee) return { periods: [], byPartner: {} }
  const mu = nt.minorUnits
  const step = MONTHS[fee.frequency]
  if (!step) fail('invalid-terms', `managementFee.frequency: ${fee.frequency}`)
  const perYear = new D(12 / step)

  const eventDate = (from: FeeStep['from']): string | undefined => {
    if (typeof from === 'string') return from
    if (from.event === 'investment-period-end') return nt.raw.fund.investmentPeriodEnd
    const e = flows.find((f) => f.type === 'event' && f.name === from.event)
    return e?.date
  }
  // Steps whose event never happened don't apply.
  const datedSteps = (schedule: FeeStep[], where: string) => {
    const steps = schedule
      .map((s) => ({ date: eventDate(s.from), rate: dec(s.rate), basis: s.basis }))
      .filter((s): s is { date: string; rate: Dec; basis: FeeStep['basis'] } => s.date !== undefined)
      .sort((a, b) => compareDates(a.date, b.date))
    if (steps.length === 0) fail('invalid-terms', `${where} needs at least one step that applies`)
    return steps
  }

  // The fee-bearing partners, in groups that share a rate schedule: a class with rates of its own is
  // a group, and everyone else pays the fund's.
  const total = sum(nt.partners.map((p) => p.commitment))
  const feeBearing = nt.partners.filter((p) => p.feeBearing)
  const own = new Map(nt.classes.filter((c) => c.feeSchedule).map((c) => [c.id, c]))
  const groupOf = (p: (typeof feeBearing)[number]) => (own.has(p.class) ? p.class : FUND_CLASS)
  const groups = [FUND_CLASS, ...own.keys()]
    .map((id) => {
      const members = feeBearing.filter((p) => groupOf(p) === id)
      const commit = sum(members.map((p) => p.commitment))
      const schedule = id === FUND_CLASS ? fee.schedule : own.get(id)!.feeSchedule!
      return {
        members,
        commit,
        share: total.isZero() ? ZERO : commit.div(total),
        steps: datedSteps(schedule, id === FUND_CLASS ? 'managementFee.schedule' : `class ${id}: managementFee.schedule`),
      }
    })
    .filter((g) => g.members.length > 0)
  const steps = groups.flatMap((g) => g.steps)

  const invested = (asOf: string): Dec => {
    let cost = ZERO
    const deals = new Map<string, Dec>()
    for (const f of flows) {
      if (compareDates(f.date, asOf) >= 0) continue
      if (f.type === 'investment') {
        cost = cost.plus(dec(f.amount))
        deals.set(f.deal, (deals.get(f.deal) ?? ZERO).plus(dec(f.amount)))
      }
    }
    // Cost exited before the day stops paying the fee.
    const exited = new Map<string, Dec>()
    for (const f of flows) {
      if (compareDates(f.date, asOf) >= 0) continue
      if ((f.type === 'write-off' || f.type === 'distributable') && f.deal) {
        const dealCost = deals.get(f.deal) ?? ZERO
        const done = exited.get(f.deal) ?? ZERO
        const left = pos(dealCost.minus(done))
        const out = f.costExited === undefined ? left : D.min(left, dec(f.costExited))
        exited.set(f.deal, done.plus(out))
      }
    }
    return pos(cost.minus(sum([...exited.values()])))
  }
  const nav = (asOf: string): Dec => {
    let last: Dec = ZERO
    for (const f of flows) if (f.type === 'nav' && compareDates(f.date, asOf) <= 0) last = dec(f.amount)
    return last
  }
  const basisAmount = (g: (typeof groups)[number], basis: FeeStep['basis'], asOf: string): Dec =>
    basis === 'commitments' ? g.commit : (basis === 'invested' ? invested(asOf) : nav(asOf)).times(g.share)

  const offsetRates = fee.offsets ?? {}
  const orgCap = fee.organizationalExpenseCap === undefined ? undefined : dec(fee.organizationalExpenseCap)
  const offsetsIn = (from: string, to: string): Dec => {
    let o = ZERO
    for (const f of flows) {
      if (f.type !== 'portfolio-fee' || compareDates(f.date, from) < 0 || compareDates(f.date, to) >= 0) continue
      o = o.plus(dec(f.amount).times(dec(offsetRates[f.kind], ZERO)))
    }
    if (orgCap) {
      const upTo = (d: string) =>
        sum(flows.filter((f) => f.type === 'organizational-expense' && compareDates(f.date, d) < 0).map((f) => dec((f as { amount: string }).amount)))
      o = o.plus(pos(upTo(to).minus(orgCap)).minus(pos(upTo(from).minus(orgCap))))
    }
    return o
  }

  const end = fee.end
  const periods: FeePeriod[] = []
  let grossTotal = ZERO
  let netTotal = ZERO
  let carried = ZERO
  // Each fee-bearing partner's net fee, exact: its group's share of the period's net, by commitment.
  const owed = new Map<string, Dec>()
  for (let start = fee.start; !end || compareDates(start, end) < 0; start = addMonths(start, step)) {
    const periodEnd = addMonths(start, step)
    const stop = end && compareDates(end, periodEnd) < 0 ? end : periodEnd
    const days = new D(daysBetween(start, periodEnd))
    // Cut the period at every step date inside it.
    const cuts = [start, ...steps.map((s) => s.date).filter((d) => compareDates(d, start) > 0 && compareDates(d, stop) < 0), stop]
    const groupGross = groups.map((g) => {
      let gg = ZERO
      for (let i = 0; i + 1 < cuts.length; i++) {
        const s = [...g.steps].reverse().find((x) => compareDates(x.date, cuts[i]) <= 0)
        if (!s) continue
        const frac = new D(daysBetween(cuts[i], cuts[i + 1])).div(days)
        gg = gg.plus(s.rate.div(perYear).times(basisAmount(g, s.basis, cuts[i])).times(frac))
      }
      return gg
    })
    const exactGross = sum(groupGross)
    const gross = exactGross.toDecimalPlaces(mu, D.ROUND_HALF_EVEN)
    const available = carried.plus(offsetsIn(start, stop))
    const offset = D.min(gross, available).toDecimalPlaces(mu, D.ROUND_HALF_EVEN)
    carried = available.minus(offset)
    const net = gross.minus(offset)
    // The offset reduces each group's fee in proportion to it.
    groups.forEach((g, k) => {
      const groupNet = exactGross.isZero() ? ZERO : net.times(groupGross[k]).div(exactGross)
      for (const p of g.members) {
        const part = g.commit.isZero() ? ZERO : groupNet.times(p.commitment).div(g.commit)
        owed.set(p.id, (owed.get(p.id) ?? ZERO).plus(part))
      }
    })
    grossTotal = grossTotal.plus(gross)
    netTotal = netTotal.plus(net)
    periods.push({ start, end: stop, gross: money(gross, mu), offset: money(offset, mu), net: money(net, mu) })
    if (!end && periods.length > 400) fail('invalid-terms', 'managementFee needs an end')
  }

  const split = apportion(netTotal, feeBearing.map((p) => owed.get(p.id) ?? ZERO), mu)
  const byPartner: Record<string, string> = {}
  feeBearing.forEach((p, i) => (byPartner[p.id] = money(split[i], mu)))
  return { periods, byPartner }
}
