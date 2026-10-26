// The distribution engine: every flow in order, every distribution through the tiers, every line
// rounded and booked. See spec/03-distributions.md for the rules this follows.

import { D, ONE, ZERO, dec, min, money, pos, sum, type Dec } from './decimal.ts'
import { compareDates } from './dates.ts'
import { fail } from './errors.ts'
import { orderFlows } from './flows.ts'
import { accruedPreferred, type Dated, type Reduction } from './hurdle.ts'
import { apportion, roundByPartner } from './rounding.ts'
import { normalizeTerms, type NormalizedTerms } from './terms.ts'
import type { WaterfallState } from './tiers/context.ts'
import type { Allocation, Flow, Purpose, Terms, Treatment } from './types.ts'
import { cloneState, emptyState, runTiers } from './waterfall.ts'

export interface AllocateOptions {
  /**
   * The fund-end view: return of capital owes every dollar contributed over the fund's life, and
   * the waterfall runs whole-fund. Clawback and accrued carry measure the GP's entitlement on it.
   */
  lifetime?: boolean
}

export interface AllocateOutput {
  allocations: Allocation[]
  recontributions: { date: string; partner: string; amount: string }[]
  recycled: { date: string; amount: string; treatment: Treatment }[]
  clawback?: { date: string; paid: string; entitlement: string; amount: string }
  accruedCarry: { date: string; nav: string; entitlement: string; paid: string; accrued: string }[]
  totals: Record<string, { contributed: string; distributed: string; net: string }>
  warnings: string[]
  /** The GP's share received through the tiers, before any clawback. */
  gpPaid: Dec
}

interface PartnerBook {
  /** Capital that counts for the waterfall: included contributions plus recontributions. */
  capital: Dec
  /** Return of capital paid to a carry-free partner. */
  returned: Dec
  contributed: Dec
  distributed: Dec
}

interface Deal {
  investments: Dated[]
  cost: Dec
  exits: { date: string; cost: Dec }[]
  exited: Dec
}

const FEE_PURPOSES: Purpose[] = ['fees', 'expenses']

export function allocate(terms: Terms, flows: Flow[], opts: AllocateOptions = {}): AllocateOutput {
  const nt = normalizeTerms(terms)
  const ordered = orderFlows(flows, new Set(nt.partners.map((p) => p.id)))
  return new Run(nt, ordered, opts).go(terms, flows)
}

class Run {
  private readonly nt: NormalizedTerms
  private readonly flows: Flow[]
  private readonly lifetime: boolean
  private readonly mu: number
  private readonly books = new Map<string, PartnerBook>()
  private readonly cb: Set<string>
  private ws: WaterfallState
  private readonly reductions: Reduction[] = []
  private readonly lpDistributions: Dated[] = []
  /** Carry-bearing capital, dated: cash contributions that count, and recontributions. */
  private readonly cbContributions: Dated[] = []
  private deemedCb = ZERO
  private cashCb = ZERO
  private cashAll = ZERO
  private feesAndExpenses = ZERO
  private feesPaid = ZERO
  private investedCost = ZERO
  private readonly deals = new Map<string, Deal>()
  private recycledTotal = ZERO
  private readonly out: AllocateOutput

  constructor(nt: NormalizedTerms, flows: Flow[], opts: AllocateOptions) {
    this.nt = nt
    this.flows = flows
    this.lifetime = opts.lifetime ?? false
    this.mu = nt.minorUnits
    for (const p of nt.partners) this.books.set(p.id, { capital: ZERO, returned: ZERO, contributed: ZERO, distributed: ZERO })
    this.cb = new Set(nt.partners.filter((p) => p.carryBearing).map((p) => p.id))
    this.ws = emptyState(this.lifetime ? lifetimeCapital(nt, flows) : ZERO)
    this.out = { allocations: [], recontributions: [], recycled: [], accruedCarry: [], totals: {}, warnings: [], gpPaid: ZERO }
  }

  go(terms: Terms, rawFlows: Flow[]): AllocateOutput {
    for (const f of this.flows) {
      switch (f.type) {
        case 'contribution':
          this.contribute(f.date, f.partner, dec(f.amount), f.purpose ?? 'investments')
          break
        case 'investment':
          this.invest(f.date, f.deal, dec(f.amount))
          break
        case 'write-off':
          this.realize(f.date, f.deal, f.costExited)
          break
        case 'distributable':
          this.distribute(f)
          break
        case 'nav':
          if (!this.lifetime) this.accrue(terms, rawFlows, f.date, dec(f.amount))
          break
        case 'fund-end':
          if (!this.lifetime && this.nt.clawback) this.clawback(terms, rawFlows, f.date)
          break
        default:
          break
      }
    }
    this.out.gpPaid = this.ws.gp
    for (const p of this.nt.partners) {
      const b = this.books.get(p.id)!
      this.out.totals[p.id] = {
        contributed: money(b.contributed, this.mu),
        distributed: money(b.distributed, this.mu),
        net: money(b.distributed.minus(b.contributed), this.mu),
      }
    }
    return this.out
  }

  // ── Capital in ────────────────────────────────────────────────────────

  private contribute(date: string, partner: string, amount: Dec, purpose: Purpose) {
    const b = this.books.get(partner)!
    b.contributed = b.contributed.plus(amount)
    if (purpose === 'fees') this.feesPaid = this.feesPaid.plus(amount)
    if (!this.nt.includes.has(purpose)) return
    b.capital = b.capital.plus(amount)
    this.cashAll = this.cashAll.plus(amount)
    if (FEE_PURPOSES.includes(purpose)) this.feesAndExpenses = this.feesAndExpenses.plus(amount)
    if (this.cb.has(partner)) {
      this.cashCb = this.cashCb.plus(amount)
      this.cbContributions.push({ date, amount })
    }
  }

  private invest(date: string, deal: string, amount: Dec) {
    const d = this.deal(deal)
    d.investments.push({ date, amount })
    d.cost = d.cost.plus(amount)
    this.investedCost = this.investedCost.plus(amount)
  }

  private deal(id: string): Deal {
    let d = this.deals.get(id)
    if (!d) {
      d = { investments: [], cost: ZERO, exits: [], exited: ZERO }
      this.deals.set(id, d)
    }
    return d
  }

  /** A sale, partial sale or write-off takes cost out of a deal: the stated amount, or all that is left. */
  private realize(date: string, deal: string, costExited?: string) {
    const d = this.deal(deal)
    const left = pos(d.cost.minus(d.exited))
    const cost = costExited === undefined ? left : min(left, dec(costExited))
    d.exits.push({ date, cost })
    d.exited = d.exited.plus(cost)
  }

  // ── The capital the first tier owes, and what the hurdle accrues on ───────

  /**
   * Deal by deal, the first tier owes the carry-bearing capital in deals realized so far: realized
   * cost × (carry-bearing capital ÷ all capital) × (1 + fees and expenses ÷ invested cost), never
   * more than the carry-bearing capital contributed. The hurdle accrues on each realized slice from
   * the date it was invested.
   */
  private dealByDealBase(): { capital: Dec; contributions: Dated[] } {
    const factor =
      this.cashAll.gt(0) && this.investedCost.gt(0)
        ? this.cashCb.div(this.cashAll).times(ONE.plus(this.feesAndExpenses.div(this.investedCost)))
        : ZERO
    const slices: Dated[] = []
    for (const d of this.deals.values()) {
      if (d.cost.lte(0) || d.exited.lte(0)) continue
      const share = min(ONE, d.exited.div(d.cost))
      for (const inv of d.investments) slices.push({ date: inv.date, amount: inv.amount.times(share).times(factor) })
    }
    let realized = sum(slices.map((s) => s.amount))
    if (realized.gt(this.cashCb) && realized.gt(0)) {
      const scale = this.cashCb.div(realized)
      for (const s of slices) s.amount = s.amount.times(scale)
      realized = this.cashCb
    }
    const deemed = this.cbContributions.filter((c) => c.deemed)
    return {
      capital: realized.plus(this.deemedCb),
      contributions: [...slices, ...deemed],
    }
  }

  // ── Distributions ─────────────────────────────────────────────────────

  private distribute(f: Extract<Flow, { type: 'distributable' }>) {
    const date = f.date
    let amount = dec(f.amount)
    if (f.deal) this.realize(date, f.deal, f.costExited)

    if (f.recycle && dec(f.recycle.amount).gt(0)) {
      const r = this.nt.raw.recycling
      if (!r) fail('recycling-not-permitted', `${date}: the terms do not permit recycling`)
      const recycle = dec(f.recycle.amount)
      if (recycle.gt(amount)) fail('recycle-exceeds-proceeds', `${date}: recycles more than the proceeds`)
      if (r!.until && compareDates(date, r!.until) > 0) fail('recycle-after-end', `${date}: recycling ended ${r!.until}`)
      const basis =
        (r!.capBasis ?? 'commitments') === 'commitments'
          ? sum(this.nt.partners.map((p) => p.commitment))
          : this.feesPaid
      const cap = dec(r!.cap).times(basis)
      this.recycledTotal = this.recycledTotal.plus(recycle)
      if (this.recycledTotal.gt(cap)) {
        fail('recycle-over-cap', `${date}: recycling would reach ${this.recycledTotal.toFixed()} against a cap of ${cap.toFixed()}`)
      }
      const treatment: Treatment = f.recycle.treatment ?? r!.defaultTreatment ?? 'never-distributed'
      this.out.recycled.push({ date, amount: money(recycle, this.mu), treatment })
      if (treatment === 'deemed') this.deem(date, recycle)
      amount = amount.minus(recycle)
    }

    const total = amount.toDecimalPlaces(this.mu, D.ROUND_HALF_EVEN)
    if (total.lte(0)) return
    this.distributeCash(date, total, Boolean(f.deal))
  }

  /**
   * Recycled proceeds deemed distributed and recontributed: each partner's share, by commitment, is
   * contributed and paid back the same day. Capital owed and capital returned both rise by it.
   */
  private deem(date: string, amount: Dec) {
    const ids = this.nt.partners.map((p) => p.id)
    const shares = apportion(amount, this.nt.partners.map((p) => p.commitment), this.mu)
    let cbShare = ZERO
    ids.forEach((id, i) => {
      const a = shares[i]
      if (a.isZero()) return
      const b = this.books.get(id)!
      b.capital = b.capital.plus(a)
      b.contributed = b.contributed.plus(a)
      b.distributed = b.distributed.plus(a)
      this.out.recontributions.push({ date, partner: id, amount: money(a, this.mu) })
      this.out.allocations.push({ date, tier: 'recycled', partner: id, amount: money(a, this.mu) })
      if (this.cb.has(id)) cbShare = cbShare.plus(a)
      else b.returned = b.returned.plus(a)
    })
    if (cbShare.isZero()) return
    this.cbContributions.push({ date, amount: cbShare, deemed: true })
    this.deemedCb = this.deemedCb.plus(cbShare)
    if (!this.lifetime) this.ws.capital = this.ws.capital.plus(cbShare)
    this.ws.returned = this.ws.returned.plus(cbShare)
    this.ws.lp = this.ws.lp.plus(cbShare)
    this.reductions.push({ date, capital: cbShare, preferred: ZERO })
    this.lpDistributions.push({ date, amount: cbShare })
  }

  private distributeCash(date: string, total: Dec, isRealization: boolean) {
    const partners = this.nt.partners
    const weights = partners.map((p) => this.books.get(p.id)!.capital)
    const anyCapital = weights.some((w) => w.gt(0))
    const w = anyCapital ? weights : partners.map((p) => p.commitment)
    const wTotal = sum(w)

    type Line = { tier: string; partner: string; exact: Dec; kind: 'roc' | 'pref' | 'profit' | 'carry-free-roc' | 'carry-free'; tierId?: string; gp: boolean }
    const lines: Line[] = []

    // Carry-free partners take their pro-rata slice outside the waterfall.
    let pool = total
    partners.forEach((p, i) => {
      if (p.carryBearing || wTotal.isZero()) return
      const slice = total.times(w[i]).div(wTotal)
      pool = pool.minus(slice)
      const b = this.books.get(p.id)!
      const roc = min(slice, pos(b.capital.minus(b.returned)))
      lines.push({ tier: 'return-of-capital', partner: p.id, exact: roc, kind: 'carry-free-roc', gp: false })
      lines.push({ tier: 'carry-free', partner: p.id, exact: slice.minus(roc), kind: 'carry-free', gp: false })
    })

    const cbIdx = partners.map((p, i) => (p.carryBearing ? i : -1)).filter((i) => i >= 0)
    const cbWeight = sum(cbIdx.map((i) => w[i]))
    if (pool.gt(0) && cbIdx.length > 0) {
      // The capital the first tier owes, and the dated capital the hurdle accrues on.
      let contributions: Dated[] = this.cbContributions
      const dealByDeal = !this.lifetime && this.nt.basis === 'deal-by-deal'
      if (dealByDeal && this.investedCost.isZero()) {
        this.out.warnings.push(`${date}: deal-by-deal terms with no investment flows run whole-fund`)
      }
      if (dealByDeal && this.investedCost.gt(0)) {
        const base = this.dealByDealBase()
        this.ws.capital = base.capital
        contributions = base.contributions
        if (!isRealization && base.capital.lte(this.ws.returned)) {
          this.out.warnings.push(`${date}: a distribution with no deal returns no capital deal by deal`)
        }
      } else if (!this.lifetime) {
        this.ws.capital = this.cashCb.plus(this.deemedCb)
      }

      const pref = this.nt.tiers.find((t) => t.type === 'preferred-return')
      const reductions = this.reductions
      let accrued: Dec | undefined
      const ctx = {
        date,
        state: cloneState(this.ws),
        preferredAccrued: () => {
          if (accrued === undefined) {
            accrued =
              pref && pref.rate
                ? accruedPreferred(
                    { rate: pref.rate, compounding: pref.compounding, base: pref.base, dayCount: pref.dayCount },
                    contributions,
                    reductions,
                    date,
                  )
                : ZERO
          }
          return accrued
        },
        lpContributions: contributions,
        lpDistributions: this.lpDistributions,
        remaining: pool,
      }
      const results = runTiers(this.nt.tiers, ctx)
      for (const r of results) {
        const kind = r.tier.type === 'return-of-capital' ? 'roc' : r.tier.type === 'preferred-return' ? 'pref' : 'profit'
        for (const i of cbIdx) {
          const share = cbWeight.isZero() ? r.lp.div(cbIdx.length) : r.lp.times(w[i]).div(cbWeight)
          lines.push({ tier: r.tier.id, partner: partners[i].id, exact: share, kind, tierId: r.tier.id, gp: false })
        }
        for (const rec of this.nt.recipients) {
          lines.push({ tier: r.tier.id, partner: rec.partner, exact: r.gp.times(rec.share), kind, tierId: r.tier.id, gp: true })
        }
      }
    }

    const rounded = roundByPartner(lines, partners.map((p) => p.id), total, this.mu)

    // Book what was actually paid.
    let lpToday = ZERO
    let roc = ZERO
    let prefPaid = ZERO
    const s = this.ws
    lines.forEach((l, i) => {
      const a = rounded[i]
      if (!a.isZero()) this.out.allocations.push({ date, tier: l.tier, partner: l.partner, amount: money(a, this.mu) })
      const b = this.books.get(l.partner)!
      b.distributed = b.distributed.plus(a)
      if (l.kind === 'carry-free-roc') b.returned = b.returned.plus(a)
      if (l.kind === 'carry-free' || l.kind === 'carry-free-roc') return
      if (l.gp) {
        s.gp = s.gp.plus(a)
        s.profit = s.profit.plus(a)
        const tier = this.nt.tiers.find((t) => t.id === l.tierId)!
        if (tier.type === 'catch-up') s.catchUp.set(tier.id, (s.catchUp.get(tier.id) ?? ZERO).plus(a))
        return
      }
      lpToday = lpToday.plus(a)
      if (l.kind === 'roc') roc = roc.plus(a)
      else s.profit = s.profit.plus(a)
      if (l.kind === 'pref') prefPaid = prefPaid.plus(a)
    })
    s.returned = s.returned.plus(roc)
    s.preferredPaid = s.preferredPaid.plus(prefPaid)
    s.lp = s.lp.plus(lpToday)
    if (lpToday.gt(0)) this.lpDistributions.push({ date, amount: lpToday })
    if (roc.gt(0) || prefPaid.gt(0)) this.reductions.push({ date, capital: roc, preferred: prefPaid })
  }

  // ── The GP's entitlement on the fund-end view ───────────────────────────

  private entitlement(terms: Terms, rawFlows: Flow[], date: string, nav?: Dec): Dec {
    const upTo = rawFlows.filter((f) => compareDates(f.date, date) <= 0 && f.type !== 'nav' && f.type !== 'fund-end')
    const extra: Flow[] = nav && nav.gt(0) ? [{ type: 'distributable', date, amount: nav.toFixed() }] : []
    return allocate(terms, [...upTo, ...extra], { lifetime: true }).gpPaid
  }

  /** Carry accrued at a NAV: what the GP would be entitled to if the fund liquidated at it today. */
  private accrue(terms: Terms, rawFlows: Flow[], date: string, nav: Dec) {
    const entitlement = this.entitlement(terms, rawFlows, date, nav).toDecimalPlaces(this.mu)
    const paid = this.ws.gp
    this.out.accruedCarry.push({
      date,
      nav: money(nav, this.mu),
      entitlement: money(entitlement, this.mu),
      paid: money(paid, this.mu),
      accrued: money(entitlement.minus(paid), this.mu),
    })
  }

  /**
   * At fund end the GP gives back what it was paid beyond its entitlement on the fund-end view. The
   * LPs receive it pro rata to their capital, and the GP's recipients repay it by their shares.
   */
  private clawback(terms: Terms, rawFlows: Flow[], date: string) {
    const entitlement = this.entitlement(terms, rawFlows, date).toDecimalPlaces(this.mu)
    const paid = this.ws.gp
    const amount = pos(paid.minus(entitlement))
    this.out.clawback = {
      date,
      paid: money(paid, this.mu),
      entitlement: money(entitlement, this.mu),
      amount: money(amount, this.mu),
    }
    if (amount.isZero()) return
    const recips = this.nt.recipients
    const repay = apportion(amount, recips.map((r) => r.share), this.mu)
    recips.forEach((r, i) => {
      this.out.allocations.push({ date, tier: 'clawback', partner: r.partner, amount: money(repay[i].neg(), this.mu) })
      const b = this.books.get(r.partner)!
      b.distributed = b.distributed.minus(repay[i])
    })
    const lps = this.nt.partners.filter((p) => p.carryBearing)
    const back = apportion(amount, lps.map((p) => this.books.get(p.id)!.capital), this.mu)
    lps.forEach((p, i) => {
      if (back[i].isZero()) return
      this.out.allocations.push({ date, tier: 'clawback', partner: p.id, amount: money(back[i], this.mu) })
      const b = this.books.get(p.id)!
      b.distributed = b.distributed.plus(back[i])
    })
  }
}

/**
 * Lifetime carry-bearing capital: every included contribution in the flows, plus the carry-bearing
 * share of every deemed recycle.
 */
function lifetimeCapital(nt: NormalizedTerms, flows: Flow[]): Dec {
  const cb = new Set(nt.partners.filter((p) => p.carryBearing).map((p) => p.id))
  let total = ZERO
  for (const f of flows) {
    if (f.type === 'contribution' && cb.has(f.partner) && nt.includes.has(f.purpose ?? 'investments')) {
      total = total.plus(dec(f.amount))
    }
    if (f.type === 'distributable' && f.recycle && dec(f.recycle.amount).gt(0)) {
      const treatment = f.recycle.treatment ?? nt.raw.recycling?.defaultTreatment ?? 'never-distributed'
      if (treatment !== 'deemed') continue
      const shares = apportion(dec(f.recycle.amount), nt.partners.map((p) => p.commitment), nt.minorUnits)
      nt.partners.forEach((p, i) => {
        if (p.carryBearing) total = total.plus(shares[i])
      })
    }
  }
  return total
}
