#!/usr/bin/env node
// Verify that every entry declared in package.json#exports has a real file in dist/.
// Run after `pnpm build`; fails the publish if entries are missing.
// Condition entries may nest (e.g. "import": { "types": ..., "default": ... }),
// so each subpath's conditions are walked recursively rather than assuming one
// level; the string shorthand ("./package.json": "./package.json") is a leaf.

import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const failures = []
let entryCount = 0

async function walk(subpath, node, trail) {
  if (typeof node === 'string') {
    entryCount += 1
    try {
      await access(resolve(root, node))
    } catch {
      failures.push(`${[subpath, ...trail].join(' → ')} → ${node} (missing)`)
    }
    return
  }
  if (!node || typeof node !== 'object') {
    failures.push(`${[subpath, ...trail].join(' → ')}: unsupported exports value (${typeof node})`)
    return
  }
  for (const [condition, value] of Object.entries(node)) {
    await walk(subpath, value, [...trail, condition])
  }
}

for (const [subpath, conditions] of Object.entries(pkg.exports)) {
  await walk(subpath, conditions, [])
}

if (failures.length > 0) {
  console.error('verify-exports: missing files declared in package.json#exports:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `verify-exports: all ${entryCount} condition entries across ${Object.keys(pkg.exports).length} subpaths resolved.`,
)
