#!/usr/bin/env node
// Verify gzip-compressed bundle size per ESM entry stays under budget.
//
// WHY THIS DIVERGES FROM THE VANILLA FAMILY SCRIPT (aieventjs/check-size.mjs):
//   aiecsjs is the only package in the ai*js family that builds with tsup
//   `splitting: true`. Under code-splitting each entry file is a thin re-export
//   shell that immediately imports one or more shared `chunk-*.js` files.
//   Measuring only the entry file itself (the vanilla approach) produces a
//   grotesquely wrong number — e.g. index.js reports ~899 B when its true
//   transitive closure is ~7295 B (the entry shell plus chunk-L5CMKMIP.js
//   + chunk-FDXCXNZK.js). Without chunk closure the gate is hollow.
//   This script therefore resolves each entry's full reachable set via BFS
//   over relative imports, sums per-file gzip sizes over that set, and uses
//   the result as the effective bundle size.
//
// ESM-ONLY SCOPE:
//   Only `dist/*.js` (ESM) files are measured. The `dist/*.cjs` files are a
//   compatibility shim for CommonJS consumers; they share the same logic but
//   are not the canonical size contract. Measuring CJS would double-count
//   the shared chunk code. This is pre-existing design, not introduced in this
//   cycle.

import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

// Budgets are per-entry transitive-closure gzip size (bytes).
// Actuals from pre-flight measurement (2026-05-29) shown in comments.
const budgets = {
  'index.js':     8500,  // actual ~7295 B
  'loop.js':       700,  // actual  ~424 B
  'commands.js':  6000,  // actual ~5193 B
  'observers.js': 8500,  // actual ~7381 B
  'serialize.js': 7500,  // actual ~6357 B
  'worker.js':    8000,  // actual ~6836 B
  'relations.js': 6500,  // actual ~5494 B
}

// Relative-import regex that matches both `from './foo'` and `import('./foo')`
// forms. Minified output has no space after `from`, so the regex uses `\s*`.
const IMPORT_RE = /(?:from|import)\s*['\"](\.\/[^'\"]+)['"]/g

/**
 * BFS over relative imports starting from `entryFile`.
 * Returns the Set of absolute file paths reachable from that entry,
 * including the entry itself. Only files that exist inside `dist/` are kept.
 */
function resolveChunkClosure(entryFile) {
  const visited = new Set()
  const queue = [entryFile]
  while (queue.length > 0) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)
    if (!existsSync(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(IMPORT_RE)) {
      const rel = match[1]
      if (!rel) continue
      // Strip any query string / hash (shouldn't exist in dist, but be safe)
      const base = rel.split('?')[0].split('#')[0]
      // Resolve relative to the importing file's directory
      const candidate = resolve(dirname(file), base)
      // Accept as-is if the file exists, or try appending .js
      const resolved = existsSync(candidate)
        ? candidate
        : existsSync(candidate + '.js')
          ? candidate + '.js'
          : null
      if (resolved && resolved.startsWith(dist) && !visited.has(resolved)) {
        queue.push(resolved)
      }
    }
  }
  return visited
}

const failures = []
for (const [name, max] of Object.entries(budgets)) {
  const entryPath = resolve(dist, name)
  if (!existsSync(entryPath)) {
    failures.push(`${name}: missing (did you run pnpm build?)`)
    continue
  }
  const reachable = resolveChunkClosure(entryPath)
  let totalGz = 0
  for (const file of reachable) {
    if (!existsSync(file)) continue
    const buf = readFileSync(file)
    totalGz += gzipSync(buf).length
  }
  const pct = ((totalGz / max) * 100).toFixed(0)
  const tag = totalGz > max ? 'FAIL' : 'ok  '
  const chunkCount = reachable.size - 1 // exclude the entry itself
  console.log(
    `[${tag}] ${name.padEnd(14)} gz ${String(totalGz).padStart(6)} B / ${max} B (${pct}%)` +
    (chunkCount > 0 ? `  [+${chunkCount} chunk${chunkCount === 1 ? '' : 's'}]` : ''),
  )
  if (totalGz > max) failures.push(`${name}: ${totalGz} B > ${max} B budget`)
}

if (failures.length > 0) {
  console.error('\ncheck-size: bundle budget exceeded:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`\ncheck-size: all ${Object.keys(budgets).length} entries within budget.`)
