// Every refusal has a stable code, so a vector can expect one and two engines can agree on it.

export type ErrorCode =
  | 'invalid-terms'
  | 'invalid-flow'
  | 'unknown-partner'
  | 'no-carry-recipient'
  | 'recycling-not-permitted'
  | 'recycle-over-cap'
  | 'recycle-after-end'
  | 'recycle-exceeds-proceeds'

export class WalterError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'WalterError'
  }
}

export const fail = (code: ErrorCode, message: string): never => {
  throw new WalterError(code, message)
}
