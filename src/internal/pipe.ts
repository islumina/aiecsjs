import { EcsError } from './errors.js'
import type { System, World } from './types.js'

/**
 * Compose systems left to right: the returned system threads the world through
 * each one with the same `ctx`. Every system must be a function (`EcsError`
 * otherwise, checked here rather than on the first tick).
 */
export function pipe<W extends World = World, Ctx = unknown>(
  ...systems: System<W, Ctx>[]
): System<W, Ctx> {
  for (const s of systems) {
    if (typeof s !== 'function') throw new EcsError('aiecsjs: every system must be a function')
  }
  if (systems.length === 0) return (w: W) => w
  if (systems.length === 1) return systems[0]!
  return (world: W, ctx: Ctx) => {
    let w = world
    for (const s of systems) w = s(w, ctx)
    return w
  }
}
