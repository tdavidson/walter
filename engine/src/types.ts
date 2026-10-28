// The shapes the spec defines. Amounts and rates are decimal strings everywhere ("0.08", "1250.00").

import type { DayCount } from './dates.ts'

export type Purpose = 'investments' | 'fees' | 'expenses' | 'other'

/**
 * Fee income from a portfolio company, in the ILPA Reporting Template's categories. 0.1 and 0.2
 * have the first four only (transaction, monitoring, directors, other).
 */
export type PortfolioFeeKind = 'advisory' | 'broken-deal' | 'transaction' | 'directors' | 'monitoring' | 'capital-markets' | 'arrangement' | 'origination' | 'reimbursement' | 'other'

export const PORTFOLIO_FEE_KINDS: PortfolioFeeKind[] = [
  'advisory', 'broken-deal', 'transaction', 'directors', 'monitoring',
  'capital-markets', 'arrangement', 'origination', 'reimbursement', 'other',
]
export const PORTFOLIO_FEE_KINDS_0_2: PortfolioFeeKind[] = ['transaction', 'monitoring', 'directors', 'other']

/** What a period's offsets were earned from: each kind of portfolio-company fee, and expenses over the cap. */
export type OffsetSource = PortfolioFeeKind | 'organizational'

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
  /** The LP class the partner belongs to (`classes`). Absent: the fund's own terms. */
  class?: string
}

/**
 * A class of LPs with terms of its own. Anything it leaves out is the fund's: a class with no
 * `waterfall` runs the fund's tiers, and one with no `managementFee` pays the fund's rates.
 */
export interface LpClass {
  id: string
  /** Its own tiers or preset. Basis, what counts as capital and the carry recipients stay the fund's. */
  waterfall?: { preset?: string; presetTerms?: { carry?: string; pref?: string }; tiers?: Tier[] }
  /** Its own fee rates. The frequency, dates, offsets and expense cap stay the fund's. */
  managementFee?: { schedule: FeeStep[] }
  /** First loss: every senior class has its capital back before this class gets any. */
  subordinated?: boolean
  source?: Source
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
   * The two agree whenever gpShare is 1 and nothing comes between the pref and the catch-up.
   * Default `preferred`.
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
  offsets?: Partial<Record<PortfolioFeeKind, string>>
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

/**
 * 0.3: carry escrow (a holdback). Of each carry payment, `share` is held rather than paid. It is
 * released at fund end, after the clawback is taken from it, or earlier once the carry-bearing LPs
 * have received `lpMultiple` times what they contributed.
 */
export interface CarryEscrow {
  share: string
  release?: 'fund-end' | { lpMultiple: string }
  source?: Source
}

export interface Terms {
  walter: '0.1' | '0.2' | '0.3'
  fund: {
    id: string
    currency: string
    /** Decimal places in the currency's minor unit. Default 2. */
    minorUnits?: number
    investmentPeriodEnd?: string
  }
  partners: Partner[]
  /** LP classes (0.2). Partners name theirs; a partner with none is on the fund's terms. */
  classes?: LpClass[]
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
  clawback?: {
    enabled?: boolean
    /** 0.3: a share of each carry payment held back, to secure the clawback. */
    escrow?: CarryEscrow
    /** 0.3: the clawback is capped at the carry paid less tax at this assumed rate. */
    netOfTax?: { rate: string }
    source?: Source
  }
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
  | { type: 'portfolio-fee'; date: string; kind: PortfolioFeeKind; amount: string }
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

export interface FeePeriodResult {
  start: string
  end: string
  gross: string
  /** The offset applied: what reduced this period's fee. */
  offset: string
  net: string
  /** 0.3: the offset earned in the period, by source, before any is applied. */
  recognized?: Partial<Record<OffsetSource, string>>
  /** 0.3: offset earned but not yet applied, carried to the next period. */
  unapplied?: string
  /** 0.3: the period's net fee by fee-bearing partner. */
  byPartner?: Record<string, string>
}

export interface ClawbackResult {
  date: string
  paid: string
  entitlement: string
  amount: string
  /** 0.3, with `netOfTax`: the cap, the carry paid less the assumed tax on it. */
  cap?: string
  /** 0.3, with an escrow: how much of the clawback the escrow covered. */
  fromEscrow?: string
}

export interface AccruedCarry {
  date: string
  nav: string
  entitlement: string
  paid: string
  accrued: string
  /** 0.3: the accrued carry by partner: recipients credited (positive), the partners who bear it charged (negative). */
  byPartner?: Record<string, string>
}

export interface Result {
  walter: '0.1' | '0.2' | '0.3'
  allocations: Allocation[]
  recontributions: { date: string; partner: string; amount: string }[]
  recycled: { date: string; amount: string; treatment: Treatment }[]
  /** Present when the flows include a `fund-end` and clawback is enabled. */
  clawback?: ClawbackResult
  accruedCarry: AccruedCarry[]
  /** 0.3: carry in each distribution, credited to recipients (positive) and charged to the partners who bore it (negative). */
  carry: { date: string; partner: string; amount: string }[]
  /** 0.3: carry escrow, by recipient: held (negative) when carry is paid, released (positive). */
  escrow: { date: string; partner: string; amount: string }[]
  fees: FeePeriodResult[]
  feesByPartner: Record<string, string>
  totals: Record<string, { contributed: string; distributed: string; net: string }>
  warnings: string[]
}
