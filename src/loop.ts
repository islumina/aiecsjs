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

  function tick(t: number): void {
    if (!running) return
    const dtMs = t - lastT
    lastT = t
    accumulator += Math.min(dtMs / 1000, fixed * maxSubSteps)
    let steps = 0
    while (accumulator >= fixed && steps < maxSubSteps) {
      onUpdate(fixed)
      accumulator -= fixed
      steps++
    }
    if (onRender) {
      const alpha = accumulator / fixed
      onRender(alpha)
    }
    handle = raf(tick)
  }

  return {
    start() {
      if (running) return
      running = true
      lastT = now()
      accumulator = 0
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
