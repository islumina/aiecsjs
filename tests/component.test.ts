import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  defineComponent,
  defineTag,
  defineObjectComponent,
  addComponent,
  removeComponent,
  hasComponent,
  getComponent,
  setComponent,
  Types,
} from '../src/index.js'

describe('component definition', () => {
  it('defineComponent SoA with scalars', () => {
    const Position = defineComponent({ x: Types.f32, y: Types.f32 })
    expect(Position.__kind).toBe('soa')
    expect(typeof Position.__id).toBe('number')
  })

  it('defineComponent SoA with vector field', () => {
    const T = defineComponent({ pos: [Types.f32, 3], scale: Types.f32 })
    expect(T.__kind).toBe('soa')
  })

  it('defineTag returns a distinct tag', () => {
    const A = defineTag()
    const B = defineTag()
    expect(A.__id).not.toBe(B.__id)
  })

  it('defineObjectComponent stores a factory', () => {
    const Mesh = defineObjectComponent<{ mesh: null }>(() => ({ mesh: null }))
    expect(Mesh.__kind).toBe('aos')
  })

  it('Types map exposes all 10 entries', () => {
    expect(Object.keys(Types).sort()).toEqual(
      ['bool', 'eid', 'f32', 'f64', 'i16', 'i32', 'i8', 'u16', 'u32', 'u8'].sort(),
    )
  })
})

describe('component ops (SoA)', () => {
  const Position = defineComponent({ x: Types.f32, y: Types.f32 })
  const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

  it('addComponent then hasComponent is true', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 10, y: 20 })
    expect(hasComponent(w, e, Position)).toBe(true)
    expect(hasComponent(w, e, Velocity)).toBe(false)
  })

  it('addComponent stores initial values in the SoA column', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 3.5, y: -1.5 })
    const view = getComponent(w, e, Position) as any
    expect(view.x[e]).toBeCloseTo(3.5)
    expect(view.y[e]).toBeCloseTo(-1.5)
  })

  it('removeComponent flips hasComponent to false', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    removeComponent(w, e, Position)
    expect(hasComponent(w, e, Position)).toBe(false)
  })

  it('setComponent updates fields, or adds if absent', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    setComponent(w, e, Position, { x: 99 })
    const view = getComponent(w, e, Position) as any
    expect(view.x[e]).toBe(99)
    expect(view.y[e]).toBe(2)
  })

  it('addComponent twice is idempotent (no double-migration)', () => {
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    expect(() => addComponent(w, e, Position, { x: 3, y: 4 })).not.toThrow()
    const view = getComponent(w, e, Position) as any
    expect(view.x[e]).toBe(3) // updated value
  })

  it('removeComponent on missing component is a no-op', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(() => removeComponent(w, e, Position)).not.toThrow()
  })
})

describe('component ops (AoS)', () => {
  it('AoS get/set stores per-entity object', () => {
    const MeshRef = defineObjectComponent<{ id: number }>(() => ({ id: 0 }))
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, MeshRef, { id: 42 })
    const inst = getComponent(w, e, MeshRef) as any
    expect(inst.id).toBe(42)
  })
})

describe('component ops (Tag)', () => {
  it('Tag presence-only', () => {
    const Player = defineTag()
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Player)
    expect(hasComponent(w, e, Player)).toBe(true)
    removeComponent(w, e, Player)
    expect(hasComponent(w, e, Player)).toBe(false)
  })
})
