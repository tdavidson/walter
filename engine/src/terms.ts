// Reading terms: fill the defaults, expand a preset, and refuse what the spec can't compute.

import { D, ONE, ZERO, dec, type Dec } from './decimal.ts'
import { fail } from './errors.ts'
import { PORTFOLIO_FEE_KINDS_0_2, type FeeStep, type LpClass, type Partner, type PortfolioFeeKind, type Purpose, type Terms, type Tier } from './types.ts'

export interface NormalizedTier {
  type: Tier['type']
  id: string
  rate?: Dec
  compounding: 'annual' | 'none'
  base: 'contributed' | 'unreturned'
  dayCount: 'act/365' | '30/360'
  multiple?: Dec
  target: Dec
  gpShare: Dec
  measure: 'profit' | 'preferred'
  untilMultiple?: Dec
  untilIrr?: Dec
}

export interface NormalizedPartner {
  id: string
  role: 'lp' | 'gp'
  commitment: Dec
  carryBearing: boolean
  feeBearing: boolean
  /** The class id, '' for the fund's own terms. */
  class: string
}

/** A class with its terms filled in. The fund's own terms are the class with id ''. */
export interface NormalizedClass {
  id: string
  tiers: NormalizedTier[]
  subordinated: boolean
  /** Its own fee steps, or undefined for the fund's. */
  feeSchedule?: FeeStep[]
}

export interface NormalizedTerms {
  raw: Terms
  minorUnits: number
  partners: NormalizedPartner[]
  basis: 'whole-fund' | 'deal-by-deal'
  includes: Set<Purpose>
  /** The fund's own tiers (the class with id ''). */
  tiers: NormalizedTier[]
  /** Every class, the fund's own first; each partner's `class` names one. */
  classes: NormalizedClass[]
  recipients: { partner: string; share: Dec }[]
  clawback: boolean
  /** Carry escrow (0.3). */
  escrow?: { share: Dec; lpMultiple?: Dec }
  /** The assumed tax rate a net-of-tax clawback cap deducts (0.3). */
  netOfTaxRate?: Dec
}

export const FUND_CLASS = ''

const ALL_PURPOSES: Purpose[] = ['investments', 'fees', 'expenses', 'other']

/** Named presets. Each expands into a tier list; `presetTerms` sets the carry and pref rates. */
export function expandPreset(name: string, carry = '0.20', pref = '0.08'): { basis: 'whole-fund' | 'deal-by-deal'; tiers: Tier[] } {
  const tiers: Tier[] = [
    { type: 'return-of-capital' },
    { type: 'preferred-return', rate: pref, compounding: 'annual', base: 'unreturned', dayCount: 'act/365' },
    { type: 'catch-up', target: carry, gpShare: '1' },
    { type: 'split', gpShare: carry },
  ]
  if (name === 'european-standard') return { basis: 'whole-fund', tiers }
  if (name === 'american-standard') return { basis: 'deal-by-deal', tiers }
  return fail('invalid-terms', `unknown preset: ${name}`)
}

const fraction = (v: string | undefined, what: string, opts: { allowOne?: boolean } = {}): Dec => {
  if (v === undefined) return fail('invalid-terms', `${what} is required`)
  let d: Dec
  try {
    d = new D(v)
  } catch {
    return fail('invalid-terms', `${what} is not a decimal: ${v}`)
  }
  if (d.lt(0) || d.gt(1) || (!opts.allowOne && d.eq(1))) fail('invalid-terms', `${what} must be a fraction: ${v}`)
  return d
}

export function normalizeTerms(terms: Terms): NormalizedTerms {
  if (!terms || !['0.1', '0.2', '0.3'].includes(terms.walter)) fail('invalid-terms', 'terms.walter must be "0.1", "0.2" or "0.3"')
  if (terms.classes && terms.walter === '0.1') fail('invalid-terms', 'LP classes need walter "0.2" or later')
  for (const kind of Object.keys(terms.managementFee?.offsets ?? {})) {
    if (terms.walter !== '0.3' && !PORTFOLIO_FEE_KINDS_0_2.includes(kind as PortfolioFeeKind)) {
      fail('invalid-terms', `managementFee.offsets.${kind} needs walter "0.3"`)
    }
  }
  const minorUnits = terms.fund?.minorUnits ?? 2
  if (!Array.isArray(terms.partners) || terms.partners.length === 0) fail('invalid-terms', 'at least one partner is required')

  const seen = new Set<string>()
  const partners = terms.partners.map((p: Partner): NormalizedPartner => {
    if (seen.has(p.id)) fail('invalid-terms', `duplicate partner: ${p.id}`)
    seen.add(p.id)
    if (p.role !== 'lp' && p.role !== 'gp') fail('invalid-terms', `partner ${p.id} role must be lp or gp`)
    return {
      id: p.id,
      role: p.role,
      commitment: dec(p.commitment),
      carryBearing: p.carryBearing ?? p.role === 'lp',
      feeBearing: p.feeBearing ?? p.role === 'lp',
      class: p.class ?? FUND_CLASS,
    }
  })

  const wf = terms.waterfall ?? {}
  const fundWf = tierList(wf, 'waterfall')
  const tiers = fundWf.tiers
  const basis = wf.basis ?? fundWf.basis

  const classIds = new Set<string>()
  const classes: NormalizedClass[] = [{ id: FUND_CLASS, tiers, subordinated: false }]
  for (const c of terms.classes ?? []) {
    if (!c.id) fail('invalid-terms', 'every class needs an id')
    if (classIds.has(c.id)) fail('invalid-terms', `duplicate class: ${c.id}`)
    classIds.add(c.id)
    classes.push({
      id: c.id,
      tiers: c.waterfall ? tierList(c.waterfall, `class ${c.id}`).tiers : tiers,
      subordinated: c.subordinated ?? false,
      ...(c.managementFee ? { feeSchedule: classFeeSchedule(c) } : {}),
    })
  }
  for (const p of partners) {
    if (p.class !== FUND_CLASS && !classIds.has(p.class)) fail('unknown-class', `partner ${p.id} names a class that isn't defined: ${p.class}`)
  }

  let recipients: { partner: string; share: Dec }[]
  if (wf.carryRecipients && wf.carryRecipients.length > 0) {
    recipients = wf.carryRecipients.map((r) => {
      if (!seen.has(r.partner)) fail('unknown-partner', `carry recipient is not a partner: ${r.partner}`)
      return { partner: r.partner, share: dec(r.share) }
    })
    const total = recipients.reduce((s, r) => s.plus(r.share), ZERO)
    if (!total.eq(1)) fail('invalid-terms', 'carry recipient shares must total 1')
  } else {
    const gps = partners.filter((p) => p.role === 'gp')
    recipients = gps.length === 1 ? [{ partner: gps[0].id, share: ONE }] : []
  }
  const paysGp = classes.some((c) => c.tiers.some((t) => t.type === 'catch-up' || (t.type === 'split' && t.gpShare.gt(0))))
  if (paysGp && recipients.length === 0) fail('no-carry-recipient', 'name carryRecipients, or list exactly one gp partner')

  const cb = terms.clawback ?? {}
  if ((cb.escrow || cb.netOfTax) && terms.walter !== '0.3') fail('invalid-terms', 'a carry escrow or a net-of-tax clawback needs walter "0.3"')
  let escrow: NormalizedTerms['escrow']
  if (cb.escrow) {
    const release = cb.escrow.release ?? 'fund-end'
    if (release !== 'fund-end' && (typeof release !== 'object' || release.lpMultiple === undefined)) {
      fail('invalid-terms', 'clawback.escrow.release must be "fund-end" or { lpMultiple }')
    }
    const lpMultiple = typeof release === 'object' ? dec(release.lpMultiple) : undefined
    if (lpMultiple && lpMultiple.lte(0)) fail('invalid-terms', 'clawback.escrow.release.lpMultiple must be above 0')
    escrow = { share: fraction(cb.escrow.share, 'clawback.escrow.share', { allowOne: true }), ...(lpMultiple ? { lpMultiple } : {}) }
  }
  const netOfTaxRate = cb.netOfTax ? fraction(cb.netOfTax.rate, 'clawback.netOfTax.rate') : undefined

  return {
    raw: terms,
    minorUnits,
    partners,
    basis: basis ?? 'whole-fund',
    includes: new Set(wf.returnOfCapital?.includes ?? ALL_PURPOSES),
    tiers,
    classes,
    recipients,
    clawback: cb.enabled ?? true,
    ...(escrow ? { escrow } : {}),
    ...(netOfTaxRate ? { netOfTaxRate } : {}),
  }
}

/** A tier list, from tiers or a preset, with each tier's defaults filled and the list's rules checked. */
function tierList(
  wf: { preset?: string; presetTerms?: { carry?: string; pref?: string }; tiers?: Tier[] },
  where: string,
): { tiers: NormalizedTier[]; basis?: 'whole-fund' | 'deal-by-deal' } {
  let rawTiers = wf.tiers
  let basis: 'whole-fund' | 'deal-by-deal' | undefined
  if (wf.preset) {
    if (wf.tiers) fail('invalid-terms', `${where}: give a preset or tiers, not both`)
    const ex = expandPreset(wf.preset, wf.presetTerms?.carry, wf.presetTerms?.pref)
    rawTiers = ex.tiers
    basis = ex.basis
  }
  if (!rawTiers || rawTiers.length === 0) fail('invalid-terms', `${where} needs tiers or a preset`)

  const counts = new Map<string, number>()
  const tiers = rawTiers!.map((t: Tier, i): NormalizedTier => {
    const n = (counts.get(t.type) ?? 0) + 1
    counts.set(t.type, n)
    const id = t.id ?? (n === 1 ? t.type : `${t.type}-${n}`)
    const base: NormalizedTier = {
      type: t.type,
      id,
      compounding: 'annual',
      base: 'contributed',
      dayCount: 'act/365',
      target: ZERO,
      gpShare: ZERO,
      measure: 'preferred',
    }
    switch (t.type) {
      case 'return-of-capital':
        if (i !== 0) fail('invalid-terms', `${where}: return-of-capital must be the first tier`)
        return base
      case 'preferred-return': {
        if ((t.rate === undefined) === (t.multiple === undefined)) fail('invalid-terms', `${id}: give rate or multiple`)
        if (t.multiple !== undefined) {
          const m = dec(t.multiple)
          if (m.lt(1)) fail('invalid-terms', `${id}: multiple must be at least 1`)
          return { ...base, multiple: m }
        }
        const rate = dec(t.rate)
        if (rate.lt(0)) fail('invalid-terms', `${id}: rate must not be negative`)
        return {
          ...base,
          rate,
          compounding: t.compounding ?? 'annual',
          base: t.base ?? 'contributed',
          dayCount: t.dayCount ?? 'act/365',
        }
      }
      case 'catch-up': {
        const target = fraction(t.target, `${id}.target`)
        const gpShare = t.gpShare === undefined ? ONE : fraction(t.gpShare, `${id}.gpShare`, { allowOne: true })
        const measure = t.measure ?? 'preferred'
        if (gpShare.isZero()) fail('invalid-terms', `${id}: gpShare must be above 0`)
        if (measure === 'profit' && gpShare.lte(target)) {
          fail('invalid-terms', `${id}: with measure "profit" the GP never catches up unless gpShare is above the target`)
        }
        return { ...base, target, gpShare, measure }
      }
      case 'split': {
        const gpShare = fraction(t.gpShare, `${id}.gpShare`, { allowOne: true })
        const out: NormalizedTier = { ...base, gpShare }
        if (t.until) {
          if ((t.until.lpMultiple === undefined) === (t.until.lpIrr === undefined)) {
            fail('invalid-terms', `${id}.until: give lpMultiple or lpIrr`)
          }
          if (gpShare.eq(1)) fail('invalid-terms', `${id}: a split with until must leave the LPs a share`)
          if (t.until.lpMultiple !== undefined) out.untilMultiple = dec(t.until.lpMultiple)
          if (t.until.lpIrr !== undefined) out.untilIrr = dec(t.until.lpIrr)
        }
        return out
      }
      default:
        return fail('invalid-terms', `unknown tier type: ${(t as { type: string }).type}`)
    }
  })
  if (tiers[0].type !== 'return-of-capital') fail('invalid-terms', `${where}: the first tier must be return-of-capital`)
  const last = tiers[tiers.length - 1]
  if (last.type !== 'split' || last.untilMultiple || last.untilIrr) {
    fail('invalid-terms', `${where}: the last tier must be a split with no until`)
  }
  if (tiers.filter((t) => t.type === 'preferred-return').length > 1) fail('invalid-terms', `${where}: at most one preferred-return tier`)
  if (tiers.filter((t) => t.type === 'return-of-capital').length > 1) fail('invalid-terms', `${where}: at most one return-of-capital tier`)

  return { tiers, basis }
}

function classFeeSchedule(c: LpClass): FeeStep[] {
  const schedule = c.managementFee?.schedule
  if (!Array.isArray(schedule) || schedule.length === 0) fail('invalid-terms', `class ${c.id}: managementFee.schedule needs at least one step`)
  return schedule!
}
