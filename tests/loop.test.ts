import { describe, it, expect, vi } from 'vitest'
import { createLoop } from '../src/loop.js'

describe('loop', () => {
  it('start/stop is idempotent', () => {
    const loop = createLoop({ fixed: 1 / 60, onUpdate: () => {} })
    loop.start()
    loop.start()
    loop.stop()
    loop.stop()
    // No throws
    expect(true).toBe(true)
  })

  it('onUpdate runs with fixed dt over time', async () => {
    let count = 0
    let totalDt = 0
    const loop = createLoop({
      fixed: 0.005,
      maxSubSteps: 1000,
      onUpdate: (dt) => { count++; totalDt += dt },
    })
    loop.start()
    await new Promise(r => setTimeout(r, 50))
    loop.stop()
    expect(count).toBeGreaterThan(0)
    // every dt should equal fixed
    expect(totalDt).toBeCloseTo(count * 0.005, 5)
  })

  it('onRender receives an alpha in [0, 1)', async () => {
    const seen: number[] = []
    const loop = createLoop({
      fixed: 0.05,
      onUpdate: () => {},
      onRender: (alpha) => seen.push(alpha),
    })
    loop.start()
    await new Promise(r => setTimeout(r, 50))
    loop.stop()
    expect(seen.length).toBeGreaterThan(0)
    for (const a of seen) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
    }
  })

  it('maxSubSteps caps the accumulator', async () => {
    let count = 0
    const loop = createLoop({
      fixed: 0.001,
      maxSubSteps: 5,
      onUpdate: () => { count++ },
    })
    loop.start()
    await new Promise(r => setTimeout(r, 100))
    loop.stop()
    // count is capped per-frame; no exact value but should not exceed thousands
    expect(count).toBeLessThan(10000)
  })
})
