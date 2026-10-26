// The shapes the spec defines. Amounts and rates are decimal strings everywhere ("0.08", "1250.00").

import type { DayCount } from './dates.ts'

export type Purpose = 'investments' | 'fees' | 'expenses' | 'other'

export interface Source {
  section?: string
  page?: number
  quote?: string
}

export interface Partner {
  id: string
  role: 'lp' | 'gp'
  commitment: string
  /** Pays carry. Default: true for an LP, false for the GP. */
  carryBearing?: boolean
  /** Pays the management fee. Default: true for an LP, false for the GP. */
  feeBearing?: boolean
}

export interface ReturnOfCapitalTier {
  type: 'return-of-capital'
  id?: string
  source?: Source
}

export interface PreferredReturnTier {
  type: 'preferred-return'
  id?: string
  /** Annual rate. Give this or `multiple`. */
  rate?: string
  /** `annual` compounds once a year, on fractional years too; `none` is simple interest. */
  compounding?: 'annual' | 'none'
  base?: 'contributed' | 'unreturned'
  dayCount?: DayCount
  /** A flat hurdle: the LPs get `multiple` × capital through return of capital and this tier. */
  multiple?: string
  source?: Source
}

export interface CatchUpTier {
  type: 'catch-up'
  id?: string
  /** The GP's share of cumulative profit once caught up, e.g. "0.20". */
  target: string
  /** The GP's share of each dollar during the catch-up. Default "1". */
  gpShare?: string
  /**
   * What the target is measured against.
   *   profit     the GP has `target` of all profit distributed so far (the usual LPA wording:
   *              "until the GP has received 20% of the amounts distributed under (ii) and (iii)").
   *   preferred  the GP's catch-up equals target ÷ (1 − target) of the preferred return paid,
   *              whatever share of the catch-up flow went to the LPs.
   * The two agree whenever gpShare is 1. Default `profit`.
   */
  measure?: 'profit' | 'preferred'
  source?: Source
}

export interface SplitTier {
  type: 'split'
  id?: string
  /** The GP's share of each dollar in this tier. */
  gpShare: string
  /** Where the split ends and the next tier begins. Absent on the last tier. */
  until?: { lpMultiple?: string; lpIrr?: string }
  source?: Source
}

export type Tier = ReturnOfCapitalTier | PreferredReturnTier | CatchUpTier | SplitTier

export interface FeeStep {
  /** A date, or an event: `investment-period-end` (from the fund) or a named `event` flow. */
  from: string | { event: string }
  rate: string
  basis: 'commitments' | 'invested' | 'nav'
}

export interface ManagementFee {
  frequency: 'quarterly' | 'semiannual' | 'annual'
  start: string
  /** The fee stops on this date (exclusive). A last period that runs past it is prorated. */
  end?: string
  schedule: FeeStep[]
  /** Share of each kind of portfolio-company fee income that reduces the management fee. */
  offsets?: Partial<Record<'transaction' | 'monitoring' | 'directors' | 'other', string>>
  /** Organizational expenses above this amount reduce the fee, dollar for dollar. */
  organizationalExpenseCap?: string
  source?: Source
}

export interface Recycling {
  /** A fraction of `capBasis`. */
  cap: string
  capBasis?: 'commitments' | 'management-fees'
  /** No proceeds received after this date may be recycled. */
  until?: string
  /** What recycled proceeds may pay for. Recorded, not enforced. */
  uses?: Purpose[]
  defaultTreatment?: Treatment
  source?: Source
}

export type Treatment = 'never-distributed' | 'deemed'

export interface Terms {
  waterline: '0.1'
  fund: {
    id: string
    currency: string
    /** Decimal places in the currency's minor unit. Default 2. */
    minorUnits?: number
    investmentPeriodEnd?: string
  }
  partners: Partner[]
  waterfall: {
    basis?: 'whole-fund' | 'deal-by-deal'
    /** Which contributions count as capital to return (and to accrue the preferred return on). Default all. */
    returnOfCapital?: { includes?: Purpose[] }
    /** A named preset, expanded into `tiers` (§ presets). Give this or `tiers`. */
    preset?: string
    presetTerms?: { carry?: string; pref?: string }
    tiers?: Tier[]
    /** Who receives the GP's share. Default: the one partner whose role is `gp`. */
    carryRecipients?: { partner: string; share: string }[]
  }
  /** Default enabled. Evaluated at a `fund-end` flow. */
  clawback?: { enabled?: boolean; source?: Source }
  recycling?: Recycling
  managementFee?: ManagementFee
}

export type Flow =
  | { type: 'contribution'; date: string; partner: string; amount: string; purpose?: Purpose; recalled?: boolean }
  | { type: 'investment'; date: string; deal: string; amount: string }
  | {
      type: 'distributable'
      date: string
      amount: string
      deal?: string
      /** Cost basis this realization takes out of the deal. Default: all of what is left. */
      costExited?: string
      recycle?: { amount: string; treatment?: Treatment }
    }
  | { type: 'write-off'; date: string; deal: string; costExited?: string }
  | { type: 'nav'; date: string; amount: string }
  | { type: 'portfolio-fee'; date: string; kind: 'transaction' | 'monitoring' | 'directors' | 'other'; amount: string }
  | { type: 'organizational-expense'; date: string; amount: string }
  | { type: 'event'; date: string; name: string }
  | { type: 'fund-end'; date: string }

export interface Allocation {
  date: string
  /** A tier id, or `carry-free`, `recycled` or `clawback`. */
  tier: string
  partner: string
  amount: string
}

export interface Result {
  waterline: '0.1'
  allocations: Allocation[]
  recontributions: { date: string; partner: string; amount: string }[]
  recycled: { date: string; amount: string; treatment: Treatment }[]
  /** Present when the flows include a `fund-end` and clawback is enabled. */
  clawback?: { date: string; paid: string; entitlement: string; amount: string }
  accruedCarry: { date: string; nav: string; entitlement: string; paid: string; accrued: string }[]
  fees: { start: string; end: string; gross: string; offset: string; net: string }[]
  feesByPartner: Record<string, string>
  totals: Record<string, { contributed: string; distributed: string; net: string }>
  warnings: string[]
}
