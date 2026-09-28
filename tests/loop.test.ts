import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoop } from '../src/loop.js'

// Loop runs on RAF when available, falling back to setTimeout(16). In Node
// (vitest default), RAF is undefined so we mock setTimeout via fake timers.
// This makes the previous wall-clock setTimeout(50) tests deterministic.

describe('loop (fake-timer driven)', () => {
  beforeEach(() => {
    // Fake everything that loop.ts touches for time. `now()` uses
    // `performance.now()` when available, so it must be mocked too.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start / stop is idempotent', () => {
    const loop = createLoop({ fixed: 1 / 60, onUpdate: () => {} })
    loop.start()
    loop.start()
    loop.stop()
    loop.stop()
    expect(true).toBe(true)
  })

  it('onUpdate fires with the configured fixed dt across multiple ticks', () => {
    let count = 0
    let totalDt = 0
    const loop = createLoop({
      fixed: 0.05, // 50 ms per step
      maxSubSteps: 50,
      onUpdate: (dt) => {
        count++
        totalDt += dt
      },
    })
    loop.start()
    // Advance ~250 ms of simulated time. Each setTimeout fires every 16 ms.
    vi.advanceTimersByTime(250)
    loop.stop()
    expect(count).toBeGreaterThan(0)
    // dt is always the fixed step
    expect(totalDt).toBeCloseTo(count * 0.05, 5)
  })

  it('onRender receives an alpha in [0, 1)', () => {
    const seen: number[] = []
    const loop = createLoop({
      fixed: 0.05,
      onUpdate: () => {},
      onRender: (alpha) => seen.push(alpha),
    })
    loop.start()
    vi.advanceTimersByTime(200)
    loop.stop()
    expect(seen.length).toBeGreaterThan(0)
    for (const a of seen) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
    }
  })

  it('maxSubSteps caps the catch-up steps per frame', () => {
    let count = 0
    const loop = createLoop({
      fixed: 0.001,
      maxSubSteps: 5,
      onUpdate: () => {
        count++
      },
    })
    loop.start()
    // 500 ms of simulated time at 1 ms steps would call onUpdate 500 times if uncapped.
    // With maxSubSteps=5 per frame and ~31 frames in 500 ms (16 ms each), expect ~155 max.
    vi.advanceTimersByTime(500)
    loop.stop()
    expect(count).toBeLessThan(500)
  })

  it('stop halts further onUpdate even with more time advancement', () => {
    let count = 0
    const loop = createLoop({
      fixed: 0.05,
      onUpdate: () => {
        count++
      },
    })
    loop.start()
    vi.advanceTimersByTime(200)
    const snapshot = count
    loop.stop()
    vi.advanceTimersByTime(500)
    expect(count).toBe(snapshot)
  })

  it('stop() inside onRender then start() leaves a single tick chain', () => {
    let renders = 0
    let first = true
    const loop = createLoop({
      fixed: 1 / 60,
      onUpdate() {},
      onRender() {
        renders++
        if (first) {
          first = false
          loop.stop()
        }
      },
    })
    loop.start()
    vi.advanceTimersByTime(16)
    expect(renders).toBe(1)
    loop.start()
    renders = 0
    vi.advanceTimersByTime(160)
    expect(renders).toBeLessThanOrEqual(11)
    loop.stop()
  })

  it('stop() inside onUpdate halts the remaining substeps and the render', () => {
    let updates = 0
    let renders = 0
    const loop = createLoop({
      fixed: 0.01,
      maxSubSteps: 5,
      onUpdate() {
        updates++
        loop.stop()
      },
      onRender() {
        renders++
      },
    })
    loop.start()
    vi.advanceTimersByTime(100)
    expect(updates).toBe(1)
    expect(renders).toBe(0)
  })

  it('stop() + start() inside onUpdate never yields a negative alpha', () => {
    const alphas: number[] = []
    let restarted = false
    const loop = createLoop({
      fixed: 0.01,
      maxSubSteps: 5,
      onUpdate() {
        if (!restarted) {
          restarted = true
          loop.stop()
          loop.start()
        }
      },
      onRender(a) {
        alphas.push(a)
      },
    })
    loop.start()
    vi.advanceTimersByTime(100)
    loop.stop()
    expect(alphas.length).toBeGreaterThan(0)
    expect(alphas.every((a) => a >= 0)).toBe(true)
  })
})
