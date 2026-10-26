// Run an engine against every vector and write results.json.
//
//   node runner/run.ts --engine ./path/to/adapter.ts --name "My engine" [--version 1.2.0] [--out results/my-engine.json]
//
// The adapter is any module that exports `run(terms, flows)` and returns the result shape in
// schema/result.schema.json (or the parts of it the engine supports). To refuse a vector the
// engine can't express, throw an error whose `code` is "unsupported"; it is reported as such
// rather than as a failure.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compare } from './compare.ts'
import { loadVectors } from './vectors.ts'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const enginePath = args.get('engine')
if (!enginePath) {
  console.error('usage: node runner/run.ts --engine <module> --name <name> [--version <v>] [--out <file>]')
  process.exit(2)
}
const mod = await import(pathToFileURL(resolve(enginePath)).href)
const name = args.get('name') ?? mod.ENGINE?.name ?? enginePath
const version = args.get('version') ?? mod.ENGINE?.version ?? ''

const results = loadVectors().map((v) => {
  const o = compare(v, () => mod.run(structuredClone(v.terms), structuredClone(v.flows)))
  return { id: v.id, file: v.file, tags: v.tags, status: o.status, ...(o.problems.length ? { problems: o.problems } : {}) }
})
const count = (s: string) => results.filter((r) => r.status === s).length
const report = {
  waterline: '0.1',
  engine: { name, version },
  summary: { vectors: results.length, pass: count('pass'), fail: count('fail'), unsupported: count('unsupported') },
  results,
}
const out = args.get('out')
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
for (const r of results) if (r.status !== 'pass') console.log(`${r.status === 'fail' ? '✗' : '–'} ${r.id}${r.problems ? `\n    ${r.problems.join('\n    ')}` : ''}`)
console.log(`${name}: ${report.summary.pass} of ${results.length} pass, ${report.summary.fail} fail, ${report.summary.unsupported} unsupported`)
if (report.summary.fail > 0 && !out) process.exitCode = 1
