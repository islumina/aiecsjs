import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import {
  IS_SAB_SUPPORTED,
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  hasComponent,
} from '../src/index.js'
import { adoptSnapshot, attachWorld, detachWorld, transferableSnapshot } from '../src/worker.js'

describe('worker / SAB', () => {
  const Position = defineComponent({ x: Types.f32, y: Types.f32 })

  it('IS_SAB_SUPPORTED is a boolean', () => {
    expect(typeof IS_SAB_SUPPORTED).toBe('boolean')
  })

  it.skipIf(!IS_SAB_SUPPORTED)('transferableSnapshot produces a SAB + meta', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    const snap = transferableSnapshot(w)
    expect(snap.buffer).toBeDefined()
    expect(snap.meta.magic).toBe(0x41494543)
    expect(snap.meta.aiecsjsVersion).toBe(pkg.version)
  })

  it.skipIf(!IS_SAB_SUPPORTED)('adoptSnapshot rebuilds a usable world', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 5, y: 6 })
    const snap = transferableSnapshot(w)
    const w2 = adoptSnapshot(snap)
    expect(hasComponent(w2, e as any, Position)).toBe(true)
  })

  it.skipIf(!IS_SAB_SUPPORTED)('attachWorld + readOnly prevents mutations', async () => {
    const { removeComponent, destroyEntity } = await import('../src/index.js')
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    const snap = transferableSnapshot(w)
    const view = attachWorld(snap.buffer, { readOnly: true })
    // All three mutation paths are guarded.
    expect(() => createEntity(view)).toThrow(/read-only/)
    expect(() => addComponent(view, e as any, Position, { x: 1, y: 1 })).toThrow(/read-only/)
    expect(() => removeComponent(view, e as any, Position)).toThrow(/read-only/)
    expect(() => destroyEntity(view, e as any)).toThrow(/read-only/)
  })

  it.skipIf(!IS_SAB_SUPPORTED)('detachWorld removes the world from the registry', () => {
    const w = createWorld()
    const snap = transferableSnapshot(w)
    const view = attachWorld(snap.buffer)
    detachWorld(view)
    // Subsequent ops on `view` should fail since the world is destroyed.
    expect(() => createEntity(view)).toThrow()
  })

  // ECS-B-02: the rewritten Multi-threading Guide mirrors the working "For AI
  // Agents" §4 pattern. The old guide was doubly broken: it posted a
  // user-allocated SAB via createWorld({ buffer }) (inert — the world never
  // writes it) and imported adoptSnapshot from the root entry (which does not
  // export it). This test walks the corrected shape end to end:
  //   main:   worker.postMessage(transferableSnapshot(world))
  //   worker: const world = adoptSnapshot(e.data)
  // structuredClone stands in for the structured-clone step postMessage performs.
  it.skipIf(!IS_SAB_SUPPORTED)('guide postMessage shape: post transferableSnapshot, adopt e.data', () => {
    const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
    const world = createWorld()
    const e = createEntity(world)
    addComponent(world, e, Position, { x: 3, y: 4 })
    addComponent(world, e, Velocity, { x: 1, y: -1 })

    // main.ts side — post the snapshot object verbatim (NOT { buffer, meta: ... }).
    const messageData = transferableSnapshot(world)
    // The posted payload carries exactly the documented shape.
    expect(messageData).toHaveProperty('buffer')
    expect(messageData).toHaveProperty('meta')

    // The structured-clone boundary a real postMessage crosses.
    const received = structuredClone(messageData)

    // worker side — adoptSnapshot reads the whole received object (`e.data`).
    const workerWorld = adoptSnapshot(received)
    expect(hasComponent(workerWorld, e as any, Position)).toBe(true)
    expect(hasComponent(workerWorld, e as any, Velocity)).toBe(true)
  })
})
