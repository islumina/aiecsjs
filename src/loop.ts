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

export function createLoop(options: LoopOptions): Loop {
  const fixed = options.fixed ?? 1 / 60
  const maxSubSteps = options.maxSubSteps ?? 5
  const onUpdate = options.onUpdate
  const onRender = options.onRender

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
