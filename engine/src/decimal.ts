// Exact decimal arithmetic. Every amount and rate in the spec is a decimal string, and every
// computation runs in decimal.js at 40 significant digits, so two engines that follow the spec
// can only disagree by rounding the final lines differently, never by binary float drift.

import { Decimal as DecimalJs } from 'decimal.js'

export const D = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN })
export type Dec = InstanceType<typeof D>

export const ZERO = new D(0)
export const ONE = new D(1)

export const dec = (v: string | number | Dec | undefined, fallback: Dec = ZERO): Dec =>
  v === undefined ? fallback : new D(v)

export const max = (a: Dec, b: Dec): Dec => (a.gt(b) ? a : b)
export const min = (a: Dec, b: Dec): Dec => (a.lt(b) ? a : b)
export const pos = (a: Dec): Dec => max(a, ZERO)
export const sum = (xs: Dec[]): Dec => xs.reduce((s, x) => s.plus(x), ZERO)

/** A money string at the currency's minor unit, e.g. "1250.00". */
export const money = (v: Dec, minorUnits: number): string => v.toFixed(minorUnits)
