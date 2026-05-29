// Tests the _FOR_TESTS_ONLY reset helpers in isolation.
// This file is intentionally isolated from other test files to prevent
// module registry corruption. The reset functions clear global module-level
// Maps, so they must run in their own module scope.

import { describe, expect, it } from 'vitest'

describe('internal reset helpers', () => {
  it('_resetComponentRegistry_FOR_TESTS_ONLY clears the registry', async () => {
    const { _resetComponentRegistry_FOR_TESTS_ONLY, defineComponent } = await import(
      '../../src/internal/component.js'
    )
    const { Types } = await import('../../src/index.js')
    const Pos = defineComponent({ x: Types.f32 })
    expect(Pos.__id).toBeGreaterThan(0)
    _resetComponentRegistry_FOR_TESTS_ONLY()
    // Registry cleared — a new defineComponent should start at id=1
    const Vel = defineComponent({ vx: Types.f32 })
    expect(Vel.__id).toBe(1)
  })

  it('_resetQueryRegistry_FOR_TESTS_ONLY clears the query cache', async () => {
    const { _resetQueryRegistry_FOR_TESTS_ONLY, defineQuery } = await import(
      '../../src/internal/query.js'
    )
    const { defineComponent, Types } = await import('../../src/index.js')
    const C = defineComponent({ a: Types.f32 })
    const q1 = defineQuery([C])
    _resetQueryRegistry_FOR_TESTS_ONLY()
    const q2 = defineQuery([C])
    // After reset, new query gets id=1
    expect(q2.id).toBe(1)
  })
})
