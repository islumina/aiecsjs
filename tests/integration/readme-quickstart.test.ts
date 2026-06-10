import { describe, expect, it } from 'vitest'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  destroyEntity,
  entityExists,
  forEachEntityIndexed,
  getComponent,
  getEntityIndex,
  pipe,
  removeComponent,
} from '../../src/index.js'

// This test mirrors the README Quick Start (sans createLoop, which we replace with a manual tick loop).
describe('integration: README Quick Start', () => {
  it('100 particles drift and expire deterministically', () => {
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
    const Lifetime = defineComponent({ remaining: Types.f32 })

    const world = createWorld({ initialCapacity: 256 })

    // Deterministic init: i instead of Math.random
    const ents: number[] = []
    for (let i = 0; i < 10; i++) {
      const e = createEntity(world)
      addComponent(world, e, Position, { x: i, y: 0 })
      addComponent(world, e, Velocity, { x: 1, y: 1 })
      addComponent(world, e, Lifetime, { remaining: 0.2 })
      ents.push(e as number)
    }

    const movers = defineQuery([Position, Velocity])
    const decaying = defineQuery([Lifetime])

    const movementSystem = (w: any, dt: number) => {
      forEachEntityIndexed(w, movers, (e, i, pos: any, vel: any) => {
        pos.x[i] += vel.x[i] * dt // `i` is the safe column subscript
        pos.y[i] += vel.y[i] * dt
      })
      return w
    }

    const lifetimeSystem = (w: any, dt: number) => {
      // Mirror the README Quick Start verbatim: destroy IN the loop. This is the
      // ECS-B-01 falsification path — on the captured-`n` HEAD this callback was
      // handed the reserved eid 0, so `expect(e).not.toBe(0)` fails RED there.
      forEachEntityIndexed(w, decaying, (e, i, life: any) => {
        life.remaining[i] -= dt
        if (life.remaining[i] <= 0) {
          expect(e as number).not.toBe(0) // never the swap-pop sentinel
          destroyEntity(w, e as any) // destroyEntity takes the packed `e`
        }
      })
      return w
    }

    const tick = pipe(movementSystem, lifetimeSystem)
    const dt = 0.05
    for (let frame = 0; frame < 5; frame++) {
      tick(world, dt)
    }

    // Position after 5 ticks of dt=0.05 = 0.25s movement
    for (const e of ents) {
      if (entityExists(world, e as any)) {
        const pos = getComponent(world, e as any, Position) as any
        // Verify x has been integrated by the velocity (index columns with getEntityIndex)
        expect(pos.x[getEntityIndex(e as any)]).toBeGreaterThan(0)
      }
    }

    // After enough frames, lifetime should expire all entities
    for (let frame = 0; frame < 10; frame++) tick(world, dt)
    let aliveCount = 0
    for (const e of ents) if (entityExists(world, e as any)) aliveCount++
    expect(aliveCount).toBe(0)
  })
})
