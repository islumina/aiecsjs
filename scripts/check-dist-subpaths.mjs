#!/usr/bin/env node
// Regression guard for P0-B (tsup splitting): verify that dist ESM + CJS subpaths
// share the same internal module registry so cross-subpath usage does not throw.
//
// Smoke test: createWorld(index) + createEntity → serializeWorld(serialize)
//             + addRelation/getRelationTargets(relations)
//             + transferableSnapshot(worker)
// Any throw → exit(1). Success → print OK.

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

async function smokeESM() {
  const { createWorld, createEntity } = await import(resolve(root, 'dist/index.js'))
  const { serializeWorld } = await import(resolve(root, 'dist/serialize.js'))
  const { addRelation, defineRelation, getRelationTargets } = await import(
    resolve(root, 'dist/relations.js')
  )
  const { transferableSnapshot } = await import(resolve(root, 'dist/worker.js'))

  const world = createWorld()
  const e1 = createEntity(world)
  const e2 = createEntity(world)

  // serializeWorld must not throw "world N is destroyed or unknown"
  const bytes = serializeWorld(world)
  if (!(bytes instanceof Uint8Array)) throw new Error('ESM: serializeWorld did not return Uint8Array')

  // relations cross-subpath
  const Rel = defineRelation()
  addRelation(world, e1, Rel, e2)
  const targets = getRelationTargets(world, e1, Rel)
  if (targets.length !== 1) throw new Error(`ESM: getRelationTargets length=${targets.length}, expected 1`)

  // worker cross-subpath
  const snap = transferableSnapshot(world)
  if (!snap) throw new Error('ESM: transferableSnapshot returned falsy')

  const size = bytes.byteLength
  process.stdout.write(`ESM: SHARED-OK bytes=${size}\n`)
}

function smokeCJS() {
  const { createWorld, createEntity } = require(resolve(root, 'dist/index.cjs'))
  const { serializeWorld } = require(resolve(root, 'dist/serialize.cjs'))
  const { addRelation, defineRelation, getRelationTargets } = require(
    resolve(root, 'dist/relations.cjs')
  )
  const { transferableSnapshot } = require(resolve(root, 'dist/worker.cjs'))

  const world = createWorld()
  const e1 = createEntity(world)
  const e2 = createEntity(world)

  const bytes = serializeWorld(world)
  if (!(bytes instanceof Uint8Array)) throw new Error('CJS: serializeWorld did not return Uint8Array')

  const Rel = defineRelation()
  addRelation(world, e1, Rel, e2)
  const targets = getRelationTargets(world, e1, Rel)
  if (targets.length !== 1) throw new Error(`CJS: getRelationTargets length=${targets.length}, expected 1`)

  const snap = transferableSnapshot(world)
  if (!snap) throw new Error('CJS: transferableSnapshot returned falsy')

  const size = bytes.byteLength
  process.stdout.write(`CJS: SHARED-OK bytes=${size}\n`)
}

try {
  await smokeESM()
  smokeCJS()
} catch (err) {
  process.stderr.write(`check-dist-subpaths FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
  process.exit(1)
}
