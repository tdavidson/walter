#!/usr/bin/env node
// The `walter` command: run a fund's terms and flows and print who gets what.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { run, SPEC_VERSION, ENGINE } from './index.ts'
import { WalterError } from './errors.ts'
import type { Flow, Result, Terms } from './types.ts'

const USAGE = `walter ${ENGINE.version} (Walter spec ${SPEC_VERSION})

Usage:
  walter init                      write an example terms.json and flows.json here
  walter run <terms> <flows>       print each partner's distributions, fees and carry
  walter run <terms> <flows> --json
                                   print the full result as JSON
  walter serve [--port 3790] [--host 127.0.0.1]
                                   run a web API: POST {"terms", "flows"} to /run
                                   (PORT, HOST and WALTER_API_KEY can be set in the environment)

<terms> is a Walter terms document. <flows> is a JSON array of dated flows, or a
document with a "flows" array. The spec: https://github.com/tdavidson/walter`

const EXAMPLE_TERMS: Terms = {
  walter: '0.3',
  fund: { id: 'example-fund-i', currency: 'USD', investmentPeriodEnd: '2030-12-31' },
  partners: [
    { id: 'gp', role: 'gp', commitment: '1000000' },
    { id: 'lp-a', role: 'lp', commitment: '60000000' },
    { id: 'lp-b', role: 'lp', commitment: '39000000' },
  ],
  waterfall: {
    basis: 'whole-fund',
    tiers: [
      { type: 'return-of-capital' },
      { type: 'preferred-return', rate: '0.08', compounding: 'annual', base: 'unreturned' },
      { type: 'catch-up', target: '0.20' },
      { type: 'split', gpShare: '0.20' },
    ],
  },
  managementFee: {
    frequency: 'quarterly',
    start: '2026-01-01',
    end: '2036-01-01',
    schedule: [
      { from: '2026-01-01', rate: '0.02', basis: 'commitments' },
      { from: { event: 'investment-period-end' }, rate: '0.015', basis: 'invested' },
    ],
  },
} as Terms

const EXAMPLE_FLOWS: Flow[] = [
  { type: 'contribution', date: '2026-01-15', partner: 'gp', amount: '400000' },
  { type: 'contribution', date: '2026-01-15', partner: 'lp-a', amount: '24000000' },
  { type: 'contribution', date: '2026-01-15', partner: 'lp-b', amount: '15600000' },
  { type: 'investment', date: '2026-02-01', deal: 'company-a', amount: '20000000' },
  { type: 'investment', date: '2026-03-01', deal: 'company-b', amount: '20000000' },
  { type: 'write-off', date: '2029-06-30', deal: 'company-b' },
  { type: 'nav', date: '2030-12-31', amount: '70000000' },
  { type: 'distributable', date: '2032-09-30', deal: 'company-a', amount: '110000000' },
] as Flow[]

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`Can't read ${path}: ${(e as Error).message}`)
  }
}

function money(s: string): string {
  const n = Number(s)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows
    .map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  '))
    .join('\n')
}

function summary(result: Result): string {
  const out: string[] = []
  const partners = Object.keys(result.totals)

  out.push('Totals by partner')
  out.push(
    table([
      ['partner', 'contributed', 'distributed', 'net'],
      ...partners.map((p) => {
        const t = result.totals[p]
        return [p, money(t.contributed), money(t.distributed), money(t.net)]
      }),
    ]),
  )

  const byDate = new Map<string, Map<string, Map<string, string>>>()
  for (const a of result.allocations) {
    const tiers = byDate.get(a.date) ?? new Map()
    const row = tiers.get(a.tier) ?? new Map()
    row.set(a.partner, a.amount)
    tiers.set(a.tier, row)
    byDate.set(a.date, tiers)
  }
  for (const [date, tiers] of byDate) {
    out.push('', `Distribution on ${date}`)
    out.push(
      table([
        ['step', ...partners],
        ...[...tiers].map(([tier, row]) => [tier, ...partners.map((p) => money(row.get(p) ?? '0'))]),
      ]),
    )
  }

  if (result.fees.length) {
    const gross = result.fees.reduce((s, f) => s + Number(f.gross), 0)
    const net = result.fees.reduce((s, f) => s + Number(f.net), 0)
    out.push('', `Management fees: ${result.fees.length} periods, ${money(String(gross))} gross, ${money(String(net))} net`)
    const fp = Object.entries(result.feesByPartner)
    if (fp.length) out.push(table([['partner', 'net fee'], ...fp.map(([p, v]) => [p, money(v)])]))
  }

  for (const c of result.accruedCarry) {
    out.push('', `Carry accrued at NAV ${money(c.nav)} on ${c.date}: ${money(c.accrued)} (entitled ${money(c.entitlement)}, paid ${money(c.paid)})`)
  }

  if (result.clawback) {
    out.push('', `Clawback at fund end ${result.clawback.date}: ${money(result.clawback.amount)}`)
  }

  for (const w of result.warnings) out.push('', `Warning: ${w}`)
  return out.join('\n')
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const MAX_BODY = 10 * 1024 * 1024

const digest = (s: string) => createHash('sha256').update(s).digest()

function serve(port: number, host: string, apiKey: string | undefined): void {
  const keyDigest = apiKey ? digest(apiKey) : undefined
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const path = (req.url ?? '/').split('?')[0]
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return send(200, { engine: ENGINE.name, version: ENGINE.version, walter: SPEC_VERSION, run: 'POST /run' })
    }
    if (keyDigest) {
      const auth = req.headers.authorization ?? ''
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!timingSafeEqual(digest(given), keyDigest)) {
        return send(401, { error: 'unauthorized', message: 'Send the API key as "Authorization: Bearer <key>"' })
      }
    }
    if (path !== '/run') return send(404, { error: 'not-found', message: 'POST {"terms", "flows"} to /run' })
    if (req.method !== 'POST') return send(405, { error: 'method-not-allowed', message: 'Use POST' })

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        send(413, { error: 'too-large', message: 'The request body is over 10 MB' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      let body: { terms?: Terms; flows?: Flow[] }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { error: 'invalid-json', message: 'The body is not valid JSON' })
      }
      if (!body || typeof body.terms !== 'object' || !Array.isArray(body.flows)) {
        return send(400, { error: 'invalid-request', message: 'Send {"terms": {...}, "flows": [...]}' })
      }
      try {
        send(200, run(body.terms, body.flows))
      } catch (e) {
        if (e instanceof WalterError) send(422, { error: e.code, message: e.message })
        else send(500, { error: 'internal', message: (e as Error).message })
      }
    })
  })
  server.listen(port, host, () => {
    console.log(`Walter ${ENGINE.version} listening on http://${host}:${port}`)
    console.log(`POST {"terms": ..., "flows": [...]} to http://${host}:${port}/run`)
    if (!keyDigest && host !== '127.0.0.1' && host !== 'localhost') {
      console.log('Warning: no WALTER_API_KEY is set, so anyone who can reach this address can call /run')
    }
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)))
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE)
    return 0
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log(ENGINE.version)
    return 0
  }
  if (cmd === 'init') {
    for (const [file, body] of [['terms.json', EXAMPLE_TERMS], ['flows.json', EXAMPLE_FLOWS]] as const) {
      if (existsSync(file)) {
        console.error(`${file} already exists; not overwriting it.`)
        return 1
      }
      writeFileSync(file, JSON.stringify(body, null, 2) + '\n')
      console.log(`Wrote ${file}`)
    }
    console.log('Next: walter run terms.json flows.json')
    return 0
  }
  if (cmd === 'run') {
    const json = rest.includes('--json')
    const files = rest.filter((a) => !a.startsWith('--'))
    if (files.length !== 2) {
      console.error(USAGE)
      return 2
    }
    const terms = readJson(files[0]) as Terms
    const raw = readJson(files[1]) as Flow[] | { flows: Flow[] }
    const flows = Array.isArray(raw) ? raw : raw.flows
    const result = run(terms, flows)
    console.log(json ? JSON.stringify(result, null, 2) : summary(result))
    return 0
  }
  if (cmd === 'serve') {
    const env = process.env
    serve(
      Number(flag(rest, '--port') ?? env.PORT ?? 3790),
      flag(rest, '--host') ?? env.HOST ?? '127.0.0.1',
      env.WALTER_API_KEY || undefined,
    )
    return 0
  }
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`)
  return 2
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  if (e instanceof WalterError) console.error(`Walter refused these terms or flows (${e.code}): ${e.message}`)
  else console.error((e as Error).message)
  process.exitCode = 1
}
