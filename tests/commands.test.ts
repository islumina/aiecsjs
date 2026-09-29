import { describe, expect, it } from 'vitest'
import { createCommandBuffer, flush, withCommandBuffer } from '../src/commands.js'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineQuery,
  defineTag,
  destroyEntity,
  entityExists,
  getWorldSize,
  hasComponent,
  runQuery,
} from '../src/index.js'
import { onAdd } from '../src/observers.js'

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

  it('cb.create() resolves so the new entity appears in subsequent queries', async () => {
    const { defineQuery, runQuery } = await import('../src/index.js')
    const w = createWorld()
    const cb = createCommandBuffer(w)
    const before = runQuery(w, defineQuery([Position]))
    expect(before.length).toBe(0)
    const placeholder = cb.create()
    cb.add(placeholder, Position, { x: 11, y: 22 })
    flush(cb)
    const after = runQuery(w, defineQuery([Position]))
    expect(after.length).toBe(1)
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

  it('retrying a failed flush does not replay already-applied ops', () => {
    const A = defineTag()
    const B = defineTag()
    const w = createWorld()
    const cb = createCommandBuffer(w)
    const stale = createEntity(w)
    cb.add(cb.create(), A)
    cb.add(stale, B)
    destroyEntity(w, stale)
    expect(() => flush(cb)).toThrow(/dead entity/)
    expect(getWorldSize(w)).toBe(1)
    expect(() => flush(cb)).not.toThrow()
    expect(getWorldSize(w)).toBe(1)
    expect(runQuery(w, defineQuery([A])).length).toBe(1)
  })

  it('create + add queued on the same buffer during flush are resolved in that flush', () => {
    const A = defineTag()
    const B = defineTag()
    const w = createWorld()
    const cb = createCommandBuffer(w)
    onAdd(w, A, () => {
      const ph = cb.create()
      cb.add(ph, B)
    })
    const e = createEntity(w)
    cb.add(e, A)
    expect(() => flush(cb)).not.toThrow()
    expect(getWorldSize(w)).toBe(2)
    expect(runQuery(w, defineQuery([B])).length).toBe(1)
  })

  it('lone create queued during flush is not dropped', () => {
    const A = defineTag()
    const w = createWorld()
    const cb = createCommandBuffer(w)
    onAdd(w, A, () => {
      cb.create()
    })
    const e = createEntity(w)
    cb.add(e, A)
    flush(cb)
    expect(getWorldSize(w)).toBe(2)
  })
})
