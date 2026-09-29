import { describe, expect, it } from 'vitest'
import {
  type EntityId,
  type SoAColumns,
  Types,
  type World,
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

describe('integration: README Quick Start', () => {
  // Verbatim copy of the README.md / README_ZHTW.md Quick Start block. The
  // 0.5.x block did `pos.x += vel.x` on the column objects returned by
  // getComponent, which replaced the Float32Array column with a string.
  it('runs verbatim and moves the entity by its velocity', () => {
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

    const world = createWorld({ initialCapacity: 1024 })
    const e = createEntity(world)
    addComponent(world, e, Position, { x: 0, y: 0 })
    addComponent(world, e, Velocity, { x: 1, y: 0 })

    // SoA columns are TypedArrays; index them with `i`, the entity's slot index.
    const movers = defineQuery([Position, Velocity])
    forEachEntityIndexed(world, movers, (entity, i, pos, vel) => {
      pos.x[i] += vel.x[i]
      pos.y[i] += vel.y[i]
    })

    const pos = getComponent(world, e, Position) as SoAColumns
    expect(pos.x).toBeInstanceOf(Float32Array)
    expect(pos.x?.[getEntityIndex(e)]).toBe(1)
    expect(pos.y?.[getEntityIndex(e)]).toBe(0)
  })

  // A longer system-pipeline scenario (createLoop replaced by a manual tick loop).
  it('100 particles drift and expire deterministically', () => {
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
    const Lifetime = defineComponent({ remaining: Types.f32 })

    const world = createWorld({ initialCapacity: 256 })

    // Deterministic init: i instead of Math.random
    const ents: EntityId[] = []
    for (let i = 0; i < 10; i++) {
      const e = createEntity(world)
      addComponent(world, e, Position, { x: i, y: 0 })
      addComponent(world, e, Velocity, { x: 1, y: 1 })
      addComponent(world, e, Lifetime, { remaining: 0.2 })
      ents.push(e)
    }

    const movers = defineQuery([Position, Velocity])
    const decaying = defineQuery([Lifetime])

    const movementSystem = (w: World, dt: number) => {
      forEachEntityIndexed(w, movers, (_e, i, pos: SoAColumns, vel: SoAColumns) => {
        pos.x![i]! += vel.x![i]! * dt // `i` is the safe column subscript
        pos.y![i]! += vel.y![i]! * dt
      })
      return w
    }

    const lifetimeSystem = (w: World, dt: number) => {
      // Mirror the README Quick Start verbatim: destroy IN the loop. This is the
      // ECS-B-01 falsification path — on the captured-`n` HEAD this callback was
      // handed the reserved eid 0, so `expect(e).not.toBe(0)` fails RED there.
      forEachEntityIndexed(w, decaying, (e, i, life: SoAColumns) => {
        const remaining = life.remaining!
        remaining[i]! -= dt
        if (remaining[i]! <= 0) {
          expect(e as number).not.toBe(0) // never the swap-pop sentinel
          destroyEntity(w, e) // destroyEntity takes the packed `e`
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
      if (entityExists(world, e)) {
        const pos = getComponent(world, e, Position) as SoAColumns
        // Verify x has been integrated by the velocity (index columns with getEntityIndex)
        expect(pos.x?.[getEntityIndex(e)]).toBeGreaterThan(0)
      }
    }

    // After enough frames, lifetime should expire all entities
    for (let frame = 0; frame < 10; frame++) tick(world, dt)
    let aliveCount = 0
    for (const e of ents) if (entityExists(world, e)) aliveCount++
    expect(aliveCount).toBe(0)
  })
})
