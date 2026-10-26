// Dates are ISO YYYY-MM-DD and mean the whole day, in no time zone.

import { D, type Dec } from './decimal.ts'
import { fail } from './errors.ts'

export type DayCount = 'act/365' | '30/360'

const DAY_MS = 86_400_000

export function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('invalid-flow', `not an ISO date: ${date}`)
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    fail('invalid-flow', `not a calendar date: ${date}`)
  }
  return t / DAY_MS
}

export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from)

/**
 * Years from `from` to `to` under a day count.
 *   act/365  actual days ÷ 365, so a leap year is 366/365 of a year.
 *   30/360   the US (bond basis) rule: D1 = 31 becomes 30; D2 = 31 becomes 30 when D1 is 30 or 31.
 */
export function yearFraction(from: string, to: string, basis: DayCount): Dec {
  if (basis === 'act/365') return new D(daysBetween(from, to)).div(365)
  const [y1, m1, d1raw] = from.split('-').map(Number)
  const [y2, m2, d2raw] = to.split('-').map(Number)
  const d1 = d1raw === 31 ? 30 : d1raw
  const d2 = d2raw === 31 && d1 >= 30 ? 30 : d2raw
  return new D(360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1)).div(360)
}

/** `date` plus a whole number of months, clamped to the month's last day. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(d, last)
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

export const compareDates = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
