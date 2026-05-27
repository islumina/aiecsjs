import type { System, World } from './types.js'

export function pipe<W extends World = World, Ctx = unknown>(
  ...systems: System<W, Ctx>[]
): System<W, Ctx> {
  if (systems.length === 0) return (w: W) => w
  if (systems.length === 1) return systems[0]!
  return (world: W, ctx: Ctx) => {
    let w = world
    for (const s of systems) w = s(w, ctx)
    return w
  }
}
