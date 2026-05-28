import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  defineComponent,
  addComponent,
  hasComponent,
  IS_SAB_SUPPORTED,
  Types,
} from '../src/index.js'
import {
  transferableSnapshot,
  adoptSnapshot,
  attachWorld,
  detachWorld,
} from '../src/worker.js'

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
    expect(snap.meta.aiecsjsVersion).toBe('0.1.4')
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
})
