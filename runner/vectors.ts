// Load every vector under vectors/, in a stable order.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Vector } from './compare.ts'

export const VECTORS_DIR = new URL('../vectors/', import.meta.url).pathname

export function loadVectors(dir = VECTORS_DIR): (Vector & { file: string })[] {
  const out: (Vector & { file: string })[] = []
  for (const group of readdirSync(dir).sort()) {
    const gdir = join(dir, group)
    for (const f of readdirSync(gdir).sort()) {
      if (!f.endsWith('.json')) continue
      const file = join(group, f)
      out.push({ ...JSON.parse(readFileSync(join(gdir, f), 'utf8')), file })
    }
  }
  return out
}
