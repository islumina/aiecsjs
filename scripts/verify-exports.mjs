#!/usr/bin/env node
// Verify that every entry declared in package.json#exports has a real file in dist/.
// Run after `npm run build`; fails the publish if entries are missing.
// Handles both object-condition form ({ types, import, require }) and string form
// (e.g. "./package.json": "./package.json").

import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

const failures = []
let entryCount = 0

for (const [subpath, value] of Object.entries(pkg.exports)) {
  entryCount += 1
  if (typeof value === 'string') {
    // String shorthand: "./package.json": "./package.json"
    const abs = resolve(root, value)
    try {
      await access(abs)
    } catch {
      failures.push(`${subpath} → ${value} (missing)`)
    }
    continue
  }
  if (value && typeof value === 'object') {
    for (const [condition, relPath] of Object.entries(value)) {
      if (typeof relPath !== 'string') continue
      const abs = resolve(root, relPath)
      try {
        await access(abs)
      } catch {
        failures.push(`${subpath} → ${condition} → ${relPath} (missing)`)
      }
    }
    continue
  }
  failures.push(`${subpath}: unsupported exports value (${typeof value})`)
}

if (failures.length > 0) {
  console.error('verify-exports: missing files declared in package.json#exports:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`verify-exports: all ${entryCount} subpaths resolved.`)
