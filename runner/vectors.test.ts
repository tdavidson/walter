// The suite checks itself: every vector is well formed, the reference engine passes every one,
// and its output matches the result schema.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { test } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { run } from '../engine/src/index.ts'
import { compare } from './compare.ts'
import { loadVectors } from './vectors.ts'

const schema = (name: string) => JSON.parse(readFileSync(new URL(`../schema/${name}.schema.json`, import.meta.url), 'utf8'))
const ajv = new Ajv2020.default({ allErrors: true, strict: false })
for (const s of ['terms', 'flows', 'result', 'vector']) ajv.addSchema(schema(s))
const validVector = ajv.getSchema('https://hemrock.com/walter/0.3/vector.schema.json')!
const validResult = ajv.getSchema('https://hemrock.com/walter/0.3/result.schema.json')!

const vectors = loadVectors()

test('vector ids are unique and match their file names', () => {
  const ids = vectors.map((v) => v.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const v of vectors) assert.equal(basename(v.file, '.json'), v.id)
})

for (const v of vectors) {
  test(`vector ${v.id}`, () => {
    const { file: _file, ...doc } = v
    assert.ok(validVector(doc), JSON.stringify(validVector.errors, null, 2))
    const outcome = compare(v, () => run(structuredClone(v.terms) as any, structuredClone(v.flows) as any))
    assert.equal(outcome.status, 'pass', outcome.problems.join('\n'))
    if (!v.expected.error) {
      const res = run(structuredClone(v.terms) as any, structuredClone(v.flows) as any)
      assert.ok(validResult(res), JSON.stringify(validResult.errors, null, 2))
    }
  })
}

test('every distribution\'s lines add up to the distribution', () => {
  for (const v of vectors) {
    if (v.expected.error) continue
    const res = run(structuredClone(v.terms) as any, structuredClone(v.flows) as any)
    const byDate = new Map<string, number>()
    for (const a of res.allocations) {
      if (a.tier === 'recycled' || a.tier === 'clawback') continue
      byDate.set(a.date, Math.round(((byDate.get(a.date) ?? 0) + Number(a.amount)) * 100) / 100)
    }
    const want = new Map<string, number>()
    for (const f of v.flows as any[]) {
      if (f.type !== 'distributable') continue
      const cash = Number(f.amount) - Number(f.recycle?.amount ?? 0)
      want.set(f.date, Math.round(((want.get(f.date) ?? 0) + Math.round(cash * 100) / 100) * 100) / 100)
    }
    for (const [date, amount] of byDate) assert.equal(amount, want.get(date), `${v.id} on ${date}`)
  }
})

test('a full catch-up leaves the GP holding its target share of profit', () => {
  // Whole-fund vectors with one catch-up to the split rate, a gpShare of 1, profit past the
  // catch-up, no carry-free partner and no clawback: the GP ends with exactly the split rate.
  for (const v of vectors) {
    const t = v.terms as any
    const tiers = t.waterfall.tiers
    if (!tiers || v.expected.error || t.waterfall.basis === 'deal-by-deal') continue
    const cus = tiers.filter((x: any) => x.type === 'catch-up')
    const splits = tiers.filter((x: any) => x.type === 'split')
    if (cus.length !== 1 || splits.length !== 1 || (cus[0].gpShare ?? '1') !== '1' || cus[0].target !== splits[0].gpShare) continue
    if (t.partners.some((p: any) => p.role === 'gp' && Number(p.commitment) > 0)) continue
    const res = run(structuredClone(t), structuredClone(v.flows) as any)
    if (!res.allocations.some((a) => a.tier === 'split' && a.partner === 'gp')) continue
    const gps = new Set(t.partners.filter((p: any) => p.role === 'gp').map((p: any) => p.id))
    const gp = res.allocations.filter((a) => gps.has(a.partner)).reduce((s, a) => s + Number(a.amount), 0)
    const profit = res.allocations.filter((a) => a.tier !== 'return-of-capital' && a.tier !== 'recycled').reduce((s, a) => s + Number(a.amount), 0)
    assert.ok(Math.abs(gp - profit * Number(splits[0].gpShare)) <= 0.011, `${v.id}: GP ${gp} of ${profit}`)
  }
})

test('carry lines add up to zero on every date, and credit only carry recipients', () => {
  for (const v of vectors) {
    if (v.expected.error) continue
    const t = v.terms as any
    const res = run(structuredClone(t), structuredClone(v.flows) as any)
    const recipients = new Set<string>(
      t.waterfall?.carryRecipients?.map((r: any) => r.partner) ?? t.partners.filter((p: any) => p.role === 'gp').map((p: any) => p.id),
    )
    const byDate = new Map<string, number>()
    for (const c of res.carry) {
      byDate.set(c.date, Math.round(((byDate.get(c.date) ?? 0) + Number(c.amount)) * 100) / 100)
      if (Number(c.amount) > 0) assert.ok(recipients.has(c.partner), `${v.id}: ${c.partner} credited carry on ${c.date}`)
    }
    for (const [date, total] of byDate) assert.equal(total, 0, `${v.id} on ${date}`)
  }
})
