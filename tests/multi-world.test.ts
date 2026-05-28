import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  defineComponent,
  addComponent,
  hasComponent,
  defineQuery,
  runQuery,
  Types,
} from '../src/index.js'

const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })

describe('multiple worlds', () => {
  it('two worlds receive distinct ids', () => {
    const a = createWorld()
    const b = createWorld()
    expect(a.id).not.toBe(b.id)
  })

  it('component data is isolated between worlds even when both register the same component', () => {
    const wa = createWorld()
    const wb = createWorld()

    const ea = createEntity(wa)
    addComponent(wa, ea, Position, { x: 1, y: 1 })

    const eb = createEntity(wb)
    addComponent(wb, eb, Velocity, { x: 2, y: 2 })

    // Cross-world membership: ea has Position only, eb has Velocity only
    expect(hasComponent(wa, ea, Position)).toBe(true)
    expect(hasComponent(wa, ea, Velocity)).toBe(false)
    expect(hasComponent(wb, eb, Position)).toBe(false)
    expect(hasComponent(wb, eb, Velocity)).toBe(true)
  })

  it('each world independently allocates archetypes for the same query signature', () => {
    const wa = createWorld()
    const wb = createWorld()
    const ea = createEntity(wa)
    addComponent(wa, ea, Position, { x: 0, y: 0 })
    const eb = createEntity(wb)
    addComponent(wb, eb, Position, { x: 0, y: 0 })

    const q = defineQuery([Position])
    const ra = [...runQuery(wa, q)]
    const rb = [...runQuery(wb, q)]
    expect(ra).toEqual([ea])
    expect(rb).toEqual([eb])
  })

  it('a component registered in one world does not consume a bit in another world that never uses it', () => {
    const wa = createWorld()
    const Tag1 = defineComponent({ v: Types.i32 })
    const Tag2 = defineComponent({ v: Types.i32 })
    const ea = createEntity(wa)
    addComponent(wa, ea, Tag1, { v: 0 })
    addComponent(wa, ea, Tag2, { v: 0 })

    // wb registers Tag2 first; its bit allocation should start at 0, not after Tag1
    const wb = createWorld()
    const eb = createEntity(wb)
    addComponent(wb, eb, Tag2, { v: 0 })
    expect(hasComponent(wb, eb, Tag2)).toBe(true)
    expect(hasComponent(wb, eb, Tag1)).toBe(false)
  })
})
