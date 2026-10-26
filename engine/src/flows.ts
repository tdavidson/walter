// Reading flows: check each one, and put them in the order the spec processes them.
//
// Flows run in date order. On one date: contributions and investments, then write-offs, events and
// fee income, then distributions in the order given, then NAV, then fund end. A same-day
// contribution therefore counts as capital before the day's distribution, and accrues nothing
// that day.

import { D } from './decimal.ts'
import { compareDates, dayNumber } from './dates.ts'
import { fail } from './errors.ts'
import type { Flow } from './types.ts'

const ORDER: Record<Flow['type'], number> = {
  contribution: 0,
  investment: 0,
  'write-off': 1,
  event: 1,
  'portfolio-fee': 1,
  'organizational-expense': 1,
  distributable: 2,
  nav: 3,
  'fund-end': 4,
}

const amountOk = (v: unknown): boolean => {
  if (typeof v !== 'string') return false
  try {
    return new D(v).gte(0)
  } catch {
    return false
  }
}

export function orderFlows(flows: Flow[], partners: Set<string>): Flow[] {
  if (!Array.isArray(flows)) fail('invalid-flow', 'flows must be an array')
  flows.forEach((f, i) => {
    if (!f || !(f.type in ORDER)) fail('invalid-flow', `flow ${i}: unknown type ${(f as { type?: string })?.type}`)
    dayNumber(f.date)
    if ('amount' in f && !amountOk(f.amount)) fail('invalid-flow', `flow ${i}: amount must be a non-negative decimal string`)
    if (f.type === 'contribution' && !partners.has(f.partner)) fail('unknown-partner', `flow ${i}: unknown partner ${f.partner}`)
    if (f.type === 'distributable' && f.recycle && !amountOk(f.recycle.amount)) {
      fail('invalid-flow', `flow ${i}: recycle.amount must be a non-negative decimal string`)
    }
  })
  return flows
    .map((f, i) => ({ f, i }))
    .sort((a, b) => compareDates(a.f.date, b.f.date) || ORDER[a.f.type] - ORDER[b.f.type] || a.i - b.i)
    .map((x) => x.f)
}
