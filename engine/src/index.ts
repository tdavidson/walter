// Waterline reference engine: `run(terms, flows)` returns every allocation the spec defines.

import { allocate } from './allocate.ts'
import { managementFees } from './fees.ts'
import { normalizeTerms } from './terms.ts'
import type { Flow, Result, Terms } from './types.ts'

export const SPEC_VERSION = '0.1'
export const ENGINE = { name: '@hemrock/waterline', version: '0.1.0' }

export function run(terms: Terms, flows: Flow[]): Result {
  const a = allocate(terms, flows)
  const fees = managementFees(normalizeTerms(terms), flows)
  const { gpPaid: _gpPaid, ...rest } = a
  return { waterline: '0.1', ...rest, fees: fees.periods, feesByPartner: fees.byPartner }
}

export { allocate } from './allocate.ts'
export { WaterlineError } from './errors.ts'
export { expandPreset, normalizeTerms } from './terms.ts'
export type * from './types.ts'
