// aiecsjs/loop — fixed-timestep accumulator loop.

interface LoopOptions {
  fixed?: number
  maxSubSteps?: number
  onUpdate: (dt: number) => void
  onRender?: (alpha: number) => void
}

interface Loop {
  start(): void
  stop(): void
}

const hasRAF = typeof globalThis.requestAnimationFrame === 'function'
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function raf(cb: (t: number) => void): number {
  if (hasRAF) return globalThis.requestAnimationFrame(cb)
  return setTimeout(() => cb(now()), 16) as unknown as number
}
function cancelRaf(handle: number): void {
  if (hasRAF && typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle)
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
  }
}

/**
 * Create a fixed-timestep loop driven by `requestAnimationFrame` (a 16 ms
 * `setTimeout` outside browsers). `onUpdate(fixed)` runs up to `maxSubSteps`
 * times per frame; `onRender(alpha)` runs once per frame with the leftover
 * fraction of a step.
 *
 * Arguments are validated before anything is scheduled. This subpath exports
 * no error class, so misuse throws built-in errors with an `aiecsjs: ` prefix:
 * `TypeError` for a missing options object or a non-function `onUpdate` /
 * `onRender`, `RangeError` for a `fixed` that is not a finite number > 0 or a
 * `maxSubSteps` that is not a finite number >= 1.
 */
export function createLoop(options: LoopOptions): Loop {
  if (!options || typeof options !== 'object') {
    throw new TypeError('aiecsjs: options must be an object')
  }
  const fixed = options.fixed ?? 1 / 60
  const maxSubSteps = options.maxSubSteps ?? 5
  const onUpdate = options.onUpdate
  const onRender = options.onRender
  if (typeof onUpdate !== 'function') throw new TypeError('aiecsjs: onUpdate must be a function')
  if (onRender != null && typeof onRender !== 'function') {
    throw new TypeError('aiecsjs: onRender must be a function')
  }
  // NaN / Infinity / <= 0 would stall the loop, run zero-length steps every
  // frame, or disable the spiral-of-death clamp.
  if (!(Number.isFinite(fixed) && fixed > 0)) {
    throw new RangeError('aiecsjs: fixed must be a finite number > 0')
  }
  if (!(Number.isFinite(maxSubSteps) && maxSubSteps >= 1)) {
    throw new RangeError('aiecsjs: maxSubSteps must be a finite number >= 1')
  }

  let running = false
  let handle = 0
  let lastT = 0
  let accumulator = 0
  // Bumped by every start(). A tick chain belongs to the start() that created
  // it; it stops as soon as the loop is stopped or restarted — even from
  // inside onUpdate / onRender — so it never keeps stepping, renders after
  // stop(), or runs alongside a newer chain.
  let epoch = 0

  return {
    start() {
      if (running) return
      running = true
      const token = ++epoch
      lastT = now()
      accumulator = 0
      const live = (): boolean => running && token === epoch
      const tick = (t: number): void => {
        if (!live()) return
        const dtMs = t - lastT
        lastT = t
        // Clamp to non-negative: the first rAF callback can receive a
        // frame-begin timestamp earlier than the `performance.now()` sampled
        // by `start()`, which would otherwise drive the accumulator (and thus
        // `onRender`'s alpha) negative.
        accumulator += Math.min(Math.max(0, dtMs) / 1000, fixed * maxSubSteps)
        let steps = 0
        while (accumulator >= fixed && steps < maxSubSteps) {
          onUpdate(fixed)
          if (!live()) return
          accumulator -= fixed
          steps++
        }
        if (onRender) {
          const alpha = accumulator / fixed
          onRender(alpha)
          if (!live()) return
        }
        handle = raf(tick)
      }
      handle = raf(tick)
    },
    stop() {
      if (!running) return
      running = false
      if (handle) cancelRaf(handle)
      handle = 0
    },
  }
}
