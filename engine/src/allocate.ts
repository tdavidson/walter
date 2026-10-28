// The distribution engine: every flow in order, every distribution through the tiers, every line
// rounded and booked. See spec/03-distributions.md for the rules this follows.

import { D, ONE, ZERO, dec, min, money, pos, sum, type Dec } from './decimal.ts'
import { compareDates } from './dates.ts'
import { fail } from './errors.ts'
import { orderFlows } from './flows.ts'
import { accruedPreferred, type Dated, type Reduction } from './hurdle.ts'
import { apportion, largestRemainder, roundByPartner } from './rounding.ts'
import { normalizeTerms, type NormalizedClass, type NormalizedTerms } from './terms.ts'
import type { TierContext, WaterfallState } from './tiers/context.ts'
import type { AccruedCarry, Allocation, ClawbackResult, Flow, Purpose, Terms, Treatment } from './types.ts'
import { cloneState, emptyState, runTiers, type TierResult } from './waterfall.ts'

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
  clawback?: ClawbackResult
  accruedCarry: AccruedCarry[]
  /** Carry paid in each distribution: credited to its recipients, charged to the partners who bore it. */
  carry: { date: string; partner: string; amount: string }[]
  /** Carry escrow by recipient: held (negative), released (positive). */
  escrow: { date: string; partner: string; amount: string }[]
  totals: Record<string, { contributed: string; distributed: string; net: string }>
  warnings: string[]
  /** The GP's share received through the tiers, before any clawback. */
  gpPaid: Dec
  /** The same, class by class. */
  gpPaidByClass: Map<string, Dec>
}

interface PartnerBook {
  /** Capital that counts for the waterfall: included contributions plus recontributions. */
  capital: Dec
  /** Return of capital paid to a carry-free partner. */
  returned: Dec
  contributed: Dec
  distributed: Dec
}

/**
 * One class's side of the waterfall: its carry-bearing partners and the cumulative state its tiers
 * see. Without classes there is one, the fund's own, and it is the whole carry-bearing side.
 */
interface ClassBook {
  cls: NormalizedClass
  /** Indexes into the partners of its carry-bearing members. */
  members: number[]
  ws: WaterfallState
  reductions: Reduction[]
  lpDistributions: Dated[]
  /** Capital, dated: cash contributions that count, and recontributions. */
  contributions: Dated[]
  cash: Dec
  deemed: Dec
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
  /** The carry-bearing side, class by class: only classes with a carry-bearing member. */
  private readonly classBooks: ClassBook[]
  private readonly classOf = new Map<string, ClassBook>()
  private cashAll = ZERO
  private feesAndExpenses = ZERO
  private feesPaid = ZERO
  private investedCost = ZERO
  private readonly deals = new Map<string, Deal>()
  private recycledTotal = ZERO
  /** Carry held in escrow, by recipient, and whether it has been released for good. */
  private readonly escrowBalance = new Map<string, Dec>()
  private escrowReleased = false
  private readonly out: AllocateOutput

  constructor(nt: NormalizedTerms, flows: Flow[], opts: AllocateOptions) {
    this.nt = nt
    this.flows = flows
    this.lifetime = opts.lifetime ?? false
    this.mu = nt.minorUnits
    for (const p of nt.partners) this.books.set(p.id, { capital: ZERO, returned: ZERO, contributed: ZERO, distributed: ZERO })
    this.classBooks = nt.classes
      .map((cls): ClassBook => ({
        cls,
        members: nt.partners.map((p, i) => (p.carryBearing && p.class === cls.id ? i : -1)).filter((i) => i >= 0),
        ws: emptyState(this.lifetime ? lifetimeCapital(nt, flows, cls.id) : ZERO),
        reductions: [],
        lpDistributions: [],
        contributions: [],
        cash: ZERO,
        deemed: ZERO,
      }))
      .filter((c) => c.members.length > 0)
    for (const c of this.classBooks) for (const i of c.members) this.classOf.set(nt.partners[i].id, c)
    this.out = {
      allocations: [],
      recontributions: [],
      recycled: [],
      accruedCarry: [],
      carry: [],
      escrow: [],
      totals: {},
      warnings: [],
      gpPaid: ZERO,
      gpPaidByClass: new Map(),
    }
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
          if (this.lifetime) break
          if (this.nt.clawback) this.clawback(terms, rawFlows, f.date)
          this.releaseEscrow(f.date)
          break
        default:
          break
      }
    }
    this.out.gpPaid = this.gpPaid()
    for (const c of this.classBooks) this.out.gpPaidByClass.set(c.cls.id, c.ws.gp)
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
    const c = this.classOf.get(partner)
    if (c) {
      c.cash = c.cash.plus(amount)
      c.contributions.push({ date, amount })
    }
  }

  private gpPaid(): Dec {
    return sum(this.classBooks.map((c) => c.ws.gp))
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
   * Deal by deal, the first tier owes a class the capital in deals realized so far: realized
   * cost × (the class's capital ÷ all capital) × (1 + fees and expenses ÷ invested cost), never
   * more than the class's capital contributed. The hurdle accrues on each realized slice from
   * the date it was invested.
   */
  private dealByDealBase(c: ClassBook): { capital: Dec; contributions: Dated[] } {
    const factor =
      this.cashAll.gt(0) && this.investedCost.gt(0)
        ? c.cash.div(this.cashAll).times(ONE.plus(this.feesAndExpenses.div(this.investedCost)))
        : ZERO
    const slices: Dated[] = []
    for (const d of this.deals.values()) {
      if (d.cost.lte(0) || d.exited.lte(0)) continue
      const share = min(ONE, d.exited.div(d.cost))
      for (const inv of d.investments) slices.push({ date: inv.date, amount: inv.amount.times(share).times(factor) })
    }
    let realized = sum(slices.map((s) => s.amount))
    if (realized.gt(c.cash) && realized.gt(0)) {
      const scale = c.cash.div(realized)
      for (const s of slices) s.amount = s.amount.times(scale)
      realized = c.cash
    }
    const deemed = c.contributions.filter((x) => x.deemed)
    return {
      capital: realized.plus(c.deemed),
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
    const cbShare = new Map<ClassBook, Dec>()
    ids.forEach((id, i) => {
      const a = shares[i]
      if (a.isZero()) return
      const b = this.books.get(id)!
      b.capital = b.capital.plus(a)
      b.contributed = b.contributed.plus(a)
      b.distributed = b.distributed.plus(a)
      this.out.recontributions.push({ date, partner: id, amount: money(a, this.mu) })
      this.out.allocations.push({ date, tier: 'recycled', partner: id, amount: money(a, this.mu) })
      const c = this.classOf.get(id)
      if (c) cbShare.set(c, (cbShare.get(c) ?? ZERO).plus(a))
      else b.returned = b.returned.plus(a)
    })
    for (const [c, share] of cbShare) {
      c.contributions.push({ date, amount: share, deemed: true })
      c.deemed = c.deemed.plus(share)
      if (!this.lifetime) c.ws.capital = c.ws.capital.plus(share)
      c.ws.returned = c.ws.returned.plus(share)
      c.ws.lp = c.ws.lp.plus(share)
      c.reductions.push({ date, capital: share, preferred: ZERO })
      c.lpDistributions.push({ date, amount: share })
    }
  }

  private distributeCash(date: string, total: Dec, isRealization: boolean) {
    const partners = this.nt.partners
    const weights = partners.map((p) => this.books.get(p.id)!.capital)
    const anyCapital = weights.some((w) => w.gt(0))
    const w = anyCapital ? weights : partners.map((p) => p.commitment)
    const wTotal = sum(w)

    type Line = {
      tier: string
      partner: string
      exact: Dec
      kind: 'roc' | 'pref' | 'profit' | 'carry-free-roc' | 'carry-free'
      tierId?: string
      gp: boolean
      book?: ClassBook
    }
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

    if (pool.gt(0) && this.classBooks.length > 0) {
      for (const r of this.runClasses(date, pool, w, isRealization)) {
        const kind = r.tier.type === 'return-of-capital' ? 'roc' : r.tier.type === 'preferred-return' ? 'pref' : 'profit'
        const members = r.book.members
        const weight = sum(members.map((i) => w[i]))
        for (const i of members) {
          const share = weight.isZero() ? r.lp.div(members.length) : r.lp.times(w[i]).div(weight)
          lines.push({ tier: r.tier.id, partner: partners[i].id, exact: share, kind, tierId: r.tier.id, gp: false, book: r.book })
        }
        for (const rec of this.nt.recipients) {
          lines.push({ tier: r.tier.id, partner: rec.partner, exact: r.gp.times(rec.share), kind, tierId: r.tier.id, gp: true, book: r.book })
        }
      }
    }

    const rounded = roundByPartner(lines, partners.map((p) => p.id), total, this.mu)

    // Book what was actually paid, class by class.
    const today = new Map<ClassBook, { lp: Dec; roc: Dec; pref: Dec }>()
    lines.forEach((l, i) => {
      const a = rounded[i]
      if (!a.isZero()) this.out.allocations.push({ date, tier: l.tier, partner: l.partner, amount: money(a, this.mu) })
      const b = this.books.get(l.partner)!
      b.distributed = b.distributed.plus(a)
      if (l.kind === 'carry-free-roc') b.returned = b.returned.plus(a)
      if (l.kind === 'carry-free' || l.kind === 'carry-free-roc' || !l.book) return
      const s = l.book.ws
      if (l.gp) {
        s.gp = s.gp.plus(a)
        s.profit = s.profit.plus(a)
        const tier = l.book.cls.tiers.find((t) => t.id === l.tierId)!
        if (tier.type === 'catch-up') s.catchUp.set(tier.id, (s.catchUp.get(tier.id) ?? ZERO).plus(a))
        return
      }
      const t = today.get(l.book) ?? { lp: ZERO, roc: ZERO, pref: ZERO }
      t.lp = t.lp.plus(a)
      if (l.kind === 'roc') t.roc = t.roc.plus(a)
      else s.profit = s.profit.plus(a)
      if (l.kind === 'pref') t.pref = t.pref.plus(a)
      today.set(l.book, t)
    })
    this.bookCarry(date, lines, rounded, w)
    this.holdEscrow(date, lines, rounded)
    for (const [c, t] of today) {
      c.ws.returned = c.ws.returned.plus(t.roc)
      c.ws.preferredPaid = c.ws.preferredPaid.plus(t.pref)
      c.ws.lp = c.ws.lp.plus(t.lp)
      if (t.lp.gt(0)) c.lpDistributions.push({ date, amount: t.lp })
      if (t.roc.gt(0) || t.pref.gt(0)) c.reductions.push({ date, capital: t.roc, preferred: t.pref })
    }
  }

  /**
   * The carry in one distribution, from both sides: each recipient is credited what it received
   * through the tiers' GP share, and each class's carry is charged to that class's carry-bearing
   * partners by the same weights their own lines were split by. A partner on both sides is shown
   * net, so the lines for a distribution add up to zero.
   */
  private bookCarry(date: string, lines: { partner: string; gp: boolean; book?: ClassBook }[], rounded: Dec[], w: Dec[]) {
    const net = new Map<string, Dec>()
    const add = (id: string, x: Dec) => net.set(id, (net.get(id) ?? ZERO).plus(x))
    const byBook = new Map<ClassBook, Dec>()
    lines.forEach((l, i) => {
      if (!l.gp || !l.book || rounded[i].isZero()) return
      add(l.partner, rounded[i])
      byBook.set(l.book, (byBook.get(l.book) ?? ZERO).plus(rounded[i]))
    })
    for (const [book, total] of byBook) {
      const shares = apportion(total, book.members.map((i) => w[i]), this.mu)
      book.members.forEach((i, k) => add(this.nt.partners[i].id, shares[k].neg()))
    }
    for (const p of this.nt.partners) {
      const x = net.get(p.id)
      if (x && !x.isZero()) this.out.carry.push({ date, partner: p.id, amount: money(x, this.mu) })
    }
  }

  /**
   * Carry escrow: of what each recipient received through the tiers' GP share in this distribution,
   * the escrow share is held instead of paid. Under an `lpMultiple` release, once the carry-bearing
   * LPs have received that multiple of what they contributed, the balance is released and nothing
   * more is held.
   */
  private holdEscrow(date: string, lines: { partner: string; gp: boolean }[], rounded: Dec[]) {
    const e = this.nt.escrow
    if (!e || this.lifetime || this.escrowReleased) return
    const net = new Map<string, Dec>()
    for (const r of this.nt.recipients) {
      const carry = sum(lines.map((l, i) => (l.gp && l.partner === r.partner ? rounded[i] : ZERO)))
      const held = carry.times(e.share).toDecimalPlaces(this.mu, D.ROUND_HALF_EVEN)
      if (held.isZero()) continue
      this.escrowBalance.set(r.partner, (this.escrowBalance.get(r.partner) ?? ZERO).plus(held))
      net.set(r.partner, held.neg())
    }
    if (e.lpMultiple) {
      const lps = this.nt.partners.filter((p) => p.carryBearing && p.role === 'lp').map((p) => this.books.get(p.id)!)
      const contributed = sum(lps.map((b) => b.contributed))
      const distributed = sum(lps.map((b) => b.distributed))
      if (contributed.gt(0) && distributed.gte(contributed.times(e.lpMultiple))) {
        for (const [id, x] of this.takeEscrow()) net.set(id, (net.get(id) ?? ZERO).plus(x))
        this.escrowReleased = true
      }
    }
    this.bookEscrow(date, net)
  }

  /** Every recipient's escrow balance, emptied. */
  private takeEscrow(): Map<string, Dec> {
    const out = new Map<string, Dec>()
    for (const [id, x] of this.escrowBalance) if (!x.isZero()) out.set(id, x)
    this.escrowBalance.clear()
    return out
  }

  /** Release what is still held, at fund end. The clawback has already been measured. */
  private releaseEscrow(date: string) {
    if (!this.nt.escrow) return
    this.bookEscrow(date, this.takeEscrow())
    this.escrowReleased = true
  }

  private bookEscrow(date: string, net: Map<string, Dec>) {
    for (const r of this.nt.recipients) {
      const x = net.get(r.partner)
      if (!x || x.isZero()) continue
      this.out.escrow.push({ date, partner: r.partner, amount: money(x, this.mu) })
      const b = this.books.get(r.partner)!
      b.distributed = b.distributed.plus(x)
    }
  }

  /**
   * The carry-bearing pool through the classes. Return of capital comes first and is shared across
   * classes: the senior classes are repaid before a subordinated (first-loss) class, each level in
   * proportion to what it is owed. What's left goes to every class pro rata by capital, and each runs
   * its own tiers on its share. With one class this is the fund's waterfall, unchanged.
   */
  private runClasses(date: string, pool: Dec, w: Dec[], isRealization: boolean): (TierResult & { book: ClassBook })[] {
    const dealByDeal = !this.lifetime && this.nt.basis === 'deal-by-deal'
    if (dealByDeal && this.investedCost.isZero()) {
      this.out.warnings.push(`${date}: deal-by-deal terms with no investment flows run whole-fund`)
    }
    const ctxs = new Map<ClassBook, TierContext>()
    for (const c of this.classBooks) {
      // The capital the first tier owes the class, and the dated capital its hurdle accrues on.
      let contributions: Dated[] = c.contributions
      if (dealByDeal && this.investedCost.gt(0)) {
        const base = this.dealByDealBase(c)
        c.ws.capital = base.capital
        contributions = base.contributions
      } else if (!this.lifetime) {
        c.ws.capital = c.cash.plus(c.deemed)
      }
      const pref = c.cls.tiers.find((t) => t.type === 'preferred-return')
      const reductions = c.reductions
      let accrued: Dec | undefined
      ctxs.set(c, {
        date,
        state: cloneState(c.ws),
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
        lpDistributions: c.lpDistributions,
        remaining: ZERO,
      })
    }
    if (dealByDeal && this.investedCost.gt(0) && !isRealization) {
      const owed = this.classBooks.every((c) => c.ws.capital.lte(c.ws.returned))
      if (owed) this.out.warnings.push(`${date}: a distribution with no deal returns no capital deal by deal`)
    }

    const out: (TierResult & { book: ClassBook })[] = []
    let rest = pool
    // Return of capital, senior classes first.
    for (const subordinated of [false, true]) {
      const level = this.classBooks.filter((c) => c.cls.subordinated === subordinated)
      const owed = level.map((c) => pos(c.ws.capital.minus(c.ws.returned)))
      const owedTotal = sum(owed)
      if (owedTotal.isZero() || rest.lte(0)) continue
      const paid = min(rest, owedTotal)
      rest = rest.minus(paid)
      level.forEach((c, i) => {
        const ctx = ctxs.get(c)!
        ctx.remaining = paid.times(owed[i]).div(owedTotal)
        const roc = c.cls.tiers[0]
        for (const r of runTiers([roc], ctx)) out.push({ ...r, book: c })
      })
    }
    // Everything after return of capital, each class on its own tiers.
    if (rest.gt(0)) {
      const weights = this.classBooks.map((c) => sum(c.members.map((i) => w[i])))
      const wTotal = sum(weights)
      this.classBooks.forEach((c, i) => {
        const ctx = ctxs.get(c)!
        ctx.remaining = wTotal.isZero() ? rest.div(this.classBooks.length) : rest.times(weights[i]).div(wTotal)
        for (const r of runTiers(c.cls.tiers, ctx)) out.push({ ...r, book: c })
      })
    }
    return out
  }

  // ── The GP's entitlement on the fund-end view ───────────────────────────

  private entitlement(terms: Terms, rawFlows: Flow[], date: string, nav?: Dec): { total: Dec; byClass: Map<string, Dec> } {
    const upTo = rawFlows.filter((f) => compareDates(f.date, date) <= 0 && f.type !== 'nav' && f.type !== 'fund-end')
    const extra: Flow[] = nav && nav.gt(0) ? [{ type: 'distributable', date, amount: nav.toFixed() }] : []
    const run = allocate(terms, [...upTo, ...extra], { lifetime: true })
    return { total: run.gpPaid, byClass: run.gpPaidByClass }
  }

  /** Carry accrued at a NAV: what the GP would be entitled to if the fund liquidated at it today. */
  private accrue(terms: Terms, rawFlows: Flow[], date: string, nav: Dec) {
    const ent = this.entitlement(terms, rawFlows, date, nav)
    const entitlement = ent.total.toDecimalPlaces(this.mu)
    const paid = this.gpPaid()
    const accrued = entitlement.minus(paid)
    this.out.accruedCarry.push({
      date,
      nav: money(nav, this.mu),
      entitlement: money(entitlement, this.mu),
      paid: money(paid, this.mu),
      accrued: money(accrued, this.mu),
      byPartner: this.accruedByPartner(accrued, ent.byClass),
    })
  }

  /**
   * The accrued carry from both sides, the way `carry` shows carry paid: the recipients are credited
   * it by their shares, and each class's accrual (its entitlement less what its tiers have paid the
   * GP) is charged to its carry-bearing partners by capital. A partner on both sides is shown net.
   */
  private accruedByPartner(accrued: Dec, byClass: Map<string, Dec>): Record<string, string> {
    const net = new Map<string, Dec>()
    const add = (id: string, x: Dec) => net.set(id, (net.get(id) ?? ZERO).plus(x))
    const recips = this.nt.recipients
    apportion(accrued, recips.map((r) => r.share), this.mu).forEach((x, i) => add(recips[i].partner, x))
    const members: string[] = []
    const exact: Dec[] = []
    for (const c of this.classBooks) {
      const classAccrued = (byClass.get(c.cls.id) ?? ZERO).minus(c.ws.gp)
      const capital = c.members.map((i) => this.books.get(this.nt.partners[i].id)!.capital)
      const classCapital = sum(capital)
      c.members.forEach((i, k) => {
        members.push(this.nt.partners[i].id)
        exact.push(classCapital.isZero() ? classAccrued.div(c.members.length) : classAccrued.times(capital[k]).div(classCapital))
      })
    }
    largestRemainder(exact, accrued, this.mu).forEach((x, i) => add(members[i], x.neg()))
    const out: Record<string, string> = {}
    for (const p of this.nt.partners) {
      const x = net.get(p.id)
      if (x && !x.isZero()) out[p.id] = money(x, this.mu)
    }
    return out
  }

  /**
   * At fund end the GP gives back what it was paid beyond its entitlement on the fund-end view,
   * measured class by class and netted across the fund. Each class that paid too much gets back its
   * share of the excess, its LPs pro rata to their capital, and the GP's recipients repay it by
   * their shares.
   */
  private clawback(terms: Terms, rawFlows: Flow[], date: string) {
    const ent = this.entitlement(terms, rawFlows, date)
    const entitlement = ent.total.toDecimalPlaces(this.mu)
    const paid = this.gpPaid()
    // Net of tax, the GP never gives back more than it kept after tax on what it was paid.
    const cap = this.nt.netOfTaxRate ? paid.times(ONE.minus(this.nt.netOfTaxRate)).toDecimalPlaces(this.mu, D.ROUND_HALF_EVEN) : undefined
    const amount = cap ? min(cap, pos(paid.minus(entitlement))) : pos(paid.minus(entitlement))
    const recips = this.nt.recipients
    const repay = apportion(amount, recips.map((r) => r.share), this.mu)
    this.out.clawback = {
      date,
      paid: money(paid, this.mu),
      entitlement: money(entitlement, this.mu),
      amount: money(amount, this.mu),
      ...(cap ? { cap: money(cap, this.mu) } : {}),
      // The escrow covers each recipient's repayment as far as its balance goes.
      ...(this.nt.escrow
        ? { fromEscrow: money(sum(recips.map((r, i) => min(repay[i], this.escrowBalance.get(r.partner) ?? ZERO))), this.mu) }
        : {}),
    }
    if (amount.isZero()) return
    recips.forEach((r, i) => {
      this.out.allocations.push({ date, tier: 'clawback', partner: r.partner, amount: money(repay[i].neg(), this.mu) })
      const b = this.books.get(r.partner)!
      b.distributed = b.distributed.minus(repay[i])
    })
    const excess = this.classBooks.map((c) => pos(c.ws.gp.minus(ent.byClass.get(c.cls.id) ?? ZERO)))
    const excessTotal = sum(excess)
    // Each LP's weight: its class's share of the excess, then its share of the class's capital.
    const lps = this.classBooks.flatMap((c) => c.members.map((i) => this.nt.partners[i]))
    const weights = this.classBooks.flatMap((c, k) => {
      const capital = c.members.map((i) => this.books.get(this.nt.partners[i].id)!.capital)
      const classCapital = sum(capital)
      return capital.map((cap) =>
        excessTotal.isZero() || classCapital.isZero() ? ZERO : excess[k].div(excessTotal).times(cap).div(classCapital),
      )
    })
    const back = apportion(amount, weights, this.mu)
    lps.forEach((p, i) => {
      if (back[i].isZero()) return
      this.out.allocations.push({ date, tier: 'clawback', partner: p.id, amount: money(back[i], this.mu) })
      const b = this.books.get(p.id)!
      b.distributed = b.distributed.plus(back[i])
    })
  }
}

/**
 * A class's lifetime capital: every included contribution from its carry-bearing partners, plus
 * their share of every deemed recycle.
 */
function lifetimeCapital(nt: NormalizedTerms, flows: Flow[], classId: string): Dec {
  const inClass = (p: { carryBearing: boolean; class: string }) => p.carryBearing && p.class === classId
  const cb = new Set(nt.partners.filter(inClass).map((p) => p.id))
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
        if (inClass(p)) total = total.plus(shares[i])
      })
    }
  }
  return total
}
