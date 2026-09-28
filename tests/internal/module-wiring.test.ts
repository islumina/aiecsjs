// Regression: the package declares `sideEffects: false`, so a bundler may drop
// dist/index.js when a consumer imports only names re-exported from shared
// chunks. The cross-module wiring (component lookup for queries, mask-change →
// reactive buffers) must therefore not live in index.ts. This file never
// imports src/index.ts, mirroring such a bundle.

import { describe, expect, it } from 'vitest'
import { addComponent, defineComponent } from '../../src/internal/component.js'
import { createEntity } from '../../src/internal/entity.js'
import { defineQuery, enterQuery, forEachEntity, runQuery } from '../../src/internal/query.js'
import { createWorld } from '../../src/internal/world.js'

describe('module wiring without the root entry', () => {
  it('queries and reactive buffers work when index.ts is never loaded', () => {
    const P = defineComponent({ x: 'f32' })
    const w = createWorld()
    const e = createEntity(w)
    const q = defineQuery([P])
    const en = enterQuery(q)
    addComponent(w, e, P, { x: 1 })
    let visited = 0
    forEachEntity(w, en, () => {
      visited++
    })
    expect(visited).toBe(1)
    expect(runQuery(w, q)).toEqual([e])
  })
})
