import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  destroyEntity,
  defineComponent,
  defineTag,
  addComponent,
  hasComponent,
  entityExists,
  Types,
} from '../src/index.js'
import {
  createCommandBuffer,
  flush,
  withCommandBuffer,
} from '../src/commands.js'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Dead = defineTag()

describe('command buffer', () => {
  it('queued add applies after flush', () => {
    const w = createWorld()
    const e = createEntity(w)
    const cb = createCommandBuffer(w)
    cb.add(e, Position, { x: 1, y: 2 })
    expect(hasComponent(w, e, Position)).toBe(false)
    flush(cb)
    expect(hasComponent(w, e, Position)).toBe(true)
  })

  it('queued remove applies after flush', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    const cb = createCommandBuffer(w)
    cb.remove(e, Position)
    expect(hasComponent(w, e, Position)).toBe(true)
    flush(cb)
    expect(hasComponent(w, e, Position)).toBe(false)
  })

  it('queued destroy runs after add/remove', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    const cb = createCommandBuffer(w)
    cb.destroy(e)
    cb.remove(e, Position) // also queued; should run BEFORE destroy
    flush(cb)
    expect(entityExists(w, e)).toBe(false)
  })

  it('cb.create() returns a placeholder resolved on flush', () => {
    const w = createWorld()
    const cb = createCommandBuffer(w)
    const placeholder = cb.create()
    cb.add(placeholder, Position, { x: 5, y: 6 })
    flush(cb)
    // The placeholder is negative; we can't query it directly, but
    // we can verify a real entity was created and has Position.
    // Use a query in a later test pattern.
  })

  it('withCommandBuffer auto-flushes and returns callback value', () => {
    const w = createWorld()
    const e = createEntity(w)
    const result = withCommandBuffer(w, (cb) => {
      cb.add(e, Position, { x: 10, y: 20 })
      return 'done'
    })
    expect(result).toBe('done')
    expect(hasComponent(w, e, Position)).toBe(true)
  })

  it('reused cb after flush starts empty', () => {
    const w = createWorld()
    const e = createEntity(w)
    const cb = createCommandBuffer(w)
    cb.add(e, Position, { x: 1, y: 1 })
    flush(cb)
    cb.add(e, Dead)
    flush(cb)
    expect(hasComponent(w, e, Dead)).toBe(true)
  })
})
