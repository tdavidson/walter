// Walter reference engine: `run(terms, flows)` returns every allocation the spec defines.

import { allocate } from './allocate.ts'
import { managementFees } from './fees.ts'
import { normalizeTerms } from './terms.ts'
import type { Flow, Result, Terms } from './types.ts'

export const SPEC_VERSION = '0.3'
export const ENGINE = { name: '@hemrock/walter', version: '0.3.0' }

export function run(terms: Terms, flows: Flow[]): Result {
  const a = allocate(terms, flows)
  const fees = managementFees(normalizeTerms(terms), flows)
  const { gpPaid: _gpPaid, gpPaidByClass: _byClass, ...rest } = a
  return { walter: terms.walter, ...rest, fees: fees.periods, feesByPartner: fees.byPartner }
}

export { allocate } from './allocate.ts'
export { WalterError } from './errors.ts'
export { expandPreset, normalizeTerms } from './terms.ts'
export type * from './types.ts'
export { PORTFOLIO_FEE_KINDS } from './types.ts'
