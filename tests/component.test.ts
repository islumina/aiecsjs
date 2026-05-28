import { describe, expect, it } from 'vitest'
import {
  Types,
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineObjectComponent,
  defineTag,
  destroyEntity,
  getComponent,
  hasComponent,
  removeComponent,
  setComponent,
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

  it('AoS writeInitial rejects __proto__ pollution from untrusted JSON', () => {
    // Simulates the deserialise / bridge-payload threat path.
    const Attr = defineObjectComponent<{ role: string }>(() => ({ role: 'guest' }))
    const w = createWorld()
    const e = createEntity(w)
    // Attacker-crafted JSON yields an OWN __proto__ key after JSON.parse.
    const malicious = JSON.parse('{"role":"user","__proto__":{"role":"admin","poisoned":true}}')
    addComponent(w, e, Attr, malicious)
    const inst = getComponent(w, e, Attr) as { role: string; poisoned?: boolean }
    // The legitimate field copies through.
    expect(inst.role).toBe('user')
    // The prototype was NOT replaced — no inherited `poisoned` property.
    expect((inst as { poisoned?: boolean }).poisoned).toBeUndefined()
    // Object.prototype was not polluted globally either.
    expect(({} as Record<string, unknown>).poisoned).toBeUndefined()
  })

  it('AoS writeInitial rejects constructor / prototype keys', () => {
    const Attr = defineObjectComponent<{ role: string }>(() => ({ role: 'guest' }))
    const w = createWorld()
    const e = createEntity(w)
    const evil = JSON.parse(
      '{"role":"x","constructor":{"prototype":{"evil":1}},"prototype":{"evil":2}}',
    )
    addComponent(w, e, Attr, evil)
    const inst = getComponent(w, e, Attr) as Record<string, unknown>
    expect(inst.role).toBe('x')
    // The dangerous keys are dropped at copy time.
    expect((inst as { constructor?: unknown }).constructor).toBe(Object)
    expect(inst.prototype).toBeUndefined()
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

describe('SoA field clear on remove / destroy', () => {
  const Position = defineComponent({ x: Types.f32, y: Types.f32 })

  it('removeComponent zeroes scalar SoA fields at the entity slot', () => {
    const w = createWorld()
    const survivor = createEntity(w)
    addComponent(w, survivor, Position, { x: 7, y: 8 })
    const removed = createEntity(w)
    addComponent(w, removed, Position, { x: 99, y: 88 })
    // Sanity: data was written
    const colsBefore = getComponent(w, survivor, Position) as any
    expect(colsBefore.x[removed]).toBeCloseTo(99)
    // Now remove and verify the slot is cleared
    removeComponent(w, removed, Position)
    const colsAfter = getComponent(w, survivor, Position) as any
    expect(colsAfter.x[removed]).toBe(0)
    expect(colsAfter.y[removed]).toBe(0)
    // Survivor's slot is untouched
    expect(colsAfter.x[survivor]).toBeCloseTo(7)
    expect(colsAfter.y[survivor]).toBeCloseTo(8)
  })

  it('destroyEntity zeroes the destroyed entity’s SoA slot for all its components', () => {
    const w = createWorld()
    const survivor = createEntity(w)
    addComponent(w, survivor, Position, { x: 1, y: 2 })
    const victim = createEntity(w)
    addComponent(w, victim, Position, { x: 50, y: 60 })

    destroyEntity(w, victim)
    const cols = getComponent(w, survivor, Position) as any
    expect(cols.x[victim]).toBe(0)
    expect(cols.y[victim]).toBe(0)
  })
})

describe('SoA vector-length round trip', () => {
  it('writes a fixed-length vector field at the correct offset', () => {
    const Transform = defineComponent({ pos: [Types.f32, 3], scale: Types.f32 })
    const w = createWorld()
    const e = createEntity(w)
    addComponent(w, e, Transform, { pos: [1, 2, 3], scale: 4 })
    const cols = getComponent(w, e, Transform) as any
    const base = (e as number) * 3
    expect(cols.pos[base]).toBeCloseTo(1)
    expect(cols.pos[base + 1]).toBeCloseTo(2)
    expect(cols.pos[base + 2]).toBeCloseTo(3)
    expect(cols.scale[e]).toBeCloseTo(4)
  })

  it('vector field round trips when the entity is the second one in its archetype', () => {
    const Vec3 = defineComponent({ v: [Types.f32, 3] })
    const w = createWorld()
    const e1 = createEntity(w)
    addComponent(w, e1, Vec3, { v: [10, 20, 30] })
    const e2 = createEntity(w)
    addComponent(w, e2, Vec3, { v: [11, 22, 33] })
    const cols = getComponent(w, e2, Vec3) as any
    const base = (e2 as number) * 3
    expect(cols.v[base]).toBeCloseTo(11)
    expect(cols.v[base + 1]).toBeCloseTo(22)
    expect(cols.v[base + 2]).toBeCloseTo(33)
  })
})

describe('component boundary errors', () => {
  it('throws once maxComponents is reached for a single world', () => {
    const w = createWorld()
    // Default maxComponents is 256. Allocate 256 distinct components into this
    // world (via addComponent so a bit is allocated). A fresh world starts at 0.
    const ents: number[] = []
    for (let i = 0; i < 256; i++) {
      const c = defineComponent({ v: Types.i32 })
      const e = createEntity(w)
      ents.push(e as number)
      addComponent(w, e, c, { v: i })
    }
    // The 257th should fail to register
    const overflow = defineComponent({ v: Types.i32 })
    const eo = createEntity(w)
    expect(() => addComponent(w, eo, overflow, { v: 0 })).toThrow(/maxComponents/)
  })
})
