import assert from 'node:assert/strict'
import { test } from 'node:test'
import { D } from '../src/decimal.ts'
import { addMonths, yearFraction } from '../src/dates.ts'
import { accruedPreferred } from '../src/hurdle.ts'
import { largestRemainder } from '../src/rounding.ts'
import { WalterError, normalizeTerms, run, type Terms } from '../src/index.ts'

const d = (s: string) => new D(s)
const terms = (tiers: any[], extra: Partial<Terms> = {}): Terms => ({
  walter: '0.1',
  fund: { id: 'example-fund-i', currency: 'USD' },
  partners: [
    { id: 'gp', role: 'gp', commitment: '0' },
    { id: 'lp-a', role: 'lp', commitment: '1000' },
  ],
  waterfall: { tiers },
  ...extra,
})
const refuses = (code: string, fn: () => unknown) =>
  assert.throws(fn, (e: unknown) => e instanceof WalterError && e.code === code)

test('30/360 moves the 31st to the 30th, and the end date only when the start is the 30th or 31st', () => {
  assert.equal(yearFraction('2025-01-31', '2025-07-31', '30/360').toString(), '0.5')
  assert.equal(yearFraction('2025-01-15', '2025-03-31', '30/360').mul(360).toDecimalPlaces(20).toString(), '76')
  assert.equal(yearFraction('2024-01-01', '2025-01-01', 'act/365').mul(365).toDecimalPlaces(20).toString(), '366')
})

test('adding months clamps to the end of the month', () => {
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28')
  assert.equal(addMonths('2024-11-30', 3), '2025-02-28')
  assert.equal(addMonths('2025-10-01', 3), '2026-01-01')
})

test('largest remainder ties go to the earlier item, and negatives round too', () => {
  const third = d('100').div(3)
  assert.deepEqual(largestRemainder([third, third, third], d('100'), 2).map(String), ['33.34', '33.33', '33.33'])
  const neg = d('-100').div(3)
  assert.deepEqual(largestRemainder([neg, neg, neg], d('-100'), 2).map(String), ['-33.33', '-33.33', '-33.34'])
})

test('on the unreturned base a same-day call and return net to nothing', () => {
  const h = { rate: d('0.08'), compounding: 'annual' as const, base: 'unreturned' as const, dayCount: 'act/365' as const }
  const plain = accruedPreferred(h, [{ date: '2025-01-01', amount: d('1000') }], [], '2026-01-01')
  const netted = accruedPreferred(
    h,
    [{ date: '2025-01-01', amount: d('1000') }, { date: '2025-06-01', amount: d('100') }],
    [{ date: '2025-06-01', capital: d('100'), preferred: d('0') }],
    '2026-01-01',
  )
  assert.equal(plain.toFixed(10), netted.toFixed(10))
})

test('an IRR split ends exactly where the LPs reach the IRR', () => {
  const t = terms([
    { type: 'return-of-capital' },
    { type: 'split', gpShare: '0.20', until: { lpIrr: '0.15' } },
    { type: 'split', gpShare: '0.40' },
  ])
  const flows: any[] = [
    { type: 'contribution', date: '2025-01-01', partner: 'lp-a', amount: '1000' },
    { type: 'distributable', date: '2029-01-01', amount: '3000' },
  ]
  const res = run(t, flows)
  const lp = res.allocations.filter((a) => a.partner === 'lp-a' && a.tier !== 'split-2').reduce((s, a) => s + Number(a.amount), 0)
  // 1,000 grown at 15% for 1,461 days.
  const want = 1000 * Math.pow(1.15, 1461 / 365)
  assert.ok(Math.abs(lp - want) < 0.01, `${lp} vs ${want}`)
})

test('terms are refused when the tiers cannot be computed', () => {
  refuses('invalid-terms', () => normalizeTerms(terms([{ type: 'split', gpShare: '0.2' }, { type: 'return-of-capital' }])))
  refuses('invalid-terms', () => normalizeTerms(terms([{ type: 'return-of-capital' }, { type: 'catch-up', target: '0.2' }])))
  refuses('invalid-terms', () =>
    normalizeTerms(terms([{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2', until: { lpMultiple: '2' } }])),
  )
  refuses('invalid-terms', () =>
    normalizeTerms(terms([{ type: 'return-of-capital' }, { type: 'preferred-return', rate: '0.08', multiple: '1.1' }, { type: 'split', gpShare: '0.2' }])),
  )
  refuses('no-carry-recipient', () =>
    normalizeTerms({ ...terms([{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2' }]), partners: [{ id: 'lp-a', role: 'lp', commitment: '1' }] }),
  )
  refuses('invalid-terms', () =>
    normalizeTerms(
      terms([{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2' }], {
        waterfall: { tiers: [{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2' }], carryRecipients: [{ partner: 'gp', share: '0.5' }] },
      }),
    ),
  )
})

test('the american-standard preset runs deal by deal', () => {
  const nt = normalizeTerms({ ...terms([]), waterfall: { preset: 'american-standard', presetTerms: { carry: '0.25' } } })
  assert.equal(nt.basis, 'deal-by-deal')
  assert.equal(nt.tiers.map((t) => t.id).join(','), 'return-of-capital,preferred-return,catch-up,split')
  assert.equal(nt.tiers[3].gpShare.toString(), '0.25')
})

test('a recycle larger than the proceeds is refused', () => {
  const t = terms([{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2' }], { recycling: { cap: '1' } })
  refuses('recycle-exceeds-proceeds', () =>
    run(t, [
      { type: 'contribution', date: '2025-01-01', partner: 'lp-a', amount: '1000' },
      { type: 'distributable', date: '2026-01-01', amount: '100', recycle: { amount: '150' } },
    ]),
  )
})

test('carry accrued is the entitlement less what has been paid', () => {
  const t = terms([{ type: 'return-of-capital' }, { type: 'split', gpShare: '0.2' }])
  const res = run(t, [
    { type: 'contribution', date: '2025-01-01', partner: 'lp-a', amount: '1000' },
    { type: 'distributable', date: '2026-01-01', amount: '1500' },
    { type: 'nav', date: '2027-01-01', amount: '500' },
  ])
  assert.deepEqual(res.accruedCarry, [
    { date: '2027-01-01', nav: '500.00', entitlement: '200.00', paid: '100.00', accrued: '100.00', byPartner: { 'lp-a': '-100.00', gp: '100.00' } },
  ])
})

test('putting every partner in one class with no terms of its own changes no 0.1 answer', async () => {
  const { loadVectors } = await import('../../runner/vectors.ts')
  for (const v of loadVectors()) {
    if (v.walter !== '0.1' || v.expected.error) continue
    const terms = structuredClone(v.terms) as any
    const plain = run(structuredClone(terms), structuredClone(v.flows) as any)
    terms.walter = '0.2'
    terms.classes = [{ id: 'everyone' }]
    for (const p of terms.partners) p.class = 'everyone'
    const classed = run(terms, structuredClone(v.flows) as any)
    assert.deepEqual(classed.allocations, plain.allocations, v.id)
    assert.deepEqual(classed.fees, plain.fees, v.id)
    assert.deepEqual(classed.feesByPartner, plain.feesByPartner, v.id)
    assert.deepEqual(classed.clawback, plain.clawback, v.id)
  }
})
