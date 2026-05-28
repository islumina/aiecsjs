import { describe, it, expect } from 'vitest'
import {
  createWorld,
  createEntity,
  destroyEntity,
  defineComponent,
  defineTag,
  defineQuery,
  addComponent,
  removeComponent,
  setComponent,
  Types,
} from '../src/index.js'
import { onAdd, onRemove, onSet, observe } from '../src/observers.js'

describe('component observers', () => {
  const Position = defineComponent({ x: Types.f32, y: Types.f32 })
  const Player = defineTag()

  it('onAdd fires when component is added', () => {
    const w = createWorld()
    const seen: number[] = []
    onAdd(w, Position, (eid) => seen.push(eid as number))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    expect(seen).toContain(e)
  })

  it('onRemove fires on removeComponent', () => {
    const w = createWorld()
    const seen: number[] = []
    onRemove(w, Player, (eid) => seen.push(eid as number))
    const e = createEntity(w)
    addComponent(w, e, Player)
    removeComponent(w, e, Player)
    expect(seen).toContain(e)
  })

  it('onRemove fires on destroyEntity for every component', () => {
    const w = createWorld()
    const seen: number[] = []
    onRemove(w, Position, (eid) => seen.push(eid as number))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 1, y: 2 })
    destroyEntity(w, e)
    expect(seen).toContain(e)
  })

  it('onSet fires on setComponent', () => {
    const w = createWorld()
    const seen: any[] = []
    onSet(w, Position, (eid, v) => seen.push({ eid, v }))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    setComponent(w, e, Position, { x: 42 })
    expect(seen.length).toBe(1)
    expect(seen[0].eid).toBe(e)
    expect((seen[0].v as any).x).toBe(42)
  })

  it('disposer stops further events', () => {
    const w = createWorld()
    const seen: number[] = []
    const dispose = onAdd(w, Position, (eid) => seen.push(eid as number))
    addComponent(w, createEntity(w), Position, { x: 0, y: 0 })
    dispose()
    addComponent(w, createEntity(w), Position, { x: 0, y: 0 })
    expect(seen.length).toBe(1)
  })

  it('observe(query, "add") fires when entity becomes matched', () => {
    const w = createWorld()
    const q = defineQuery([Position])
    const seen: number[] = []
    observe(w, q, 'add', (eid) => seen.push(eid as number))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    expect(seen).toContain(e)
  })

  it('destroyEntity fires onRemove once per component the entity owned', () => {
    const w = createWorld()
    const Health = defineComponent({ hp: Types.i32 })
    const seen: string[] = []
    onRemove(w, Position, (eid) => seen.push(`pos:${eid}`))
    onRemove(w, Health, (eid) => seen.push(`hp:${eid}`))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    addComponent(w, e, Health, { hp: 5 })
    destroyEntity(w, e)
    expect(seen).toContain(`pos:${e}`)
    expect(seen).toContain(`hp:${e}`)
  })

  it('onSet receives the value passed to setComponent', () => {
    const w = createWorld()
    const captured: Array<{ eid: number; v: any }> = []
    onSet(w, Position, (eid, v) => captured.push({ eid: eid as number, v }))
    const e = createEntity(w)
    addComponent(w, e, Position, { x: 0, y: 0 })
    setComponent(w, e, Position, { x: 17, y: 25 })
    expect(captured.length).toBe(1)
    const c0 = captured[0]!
    expect(c0.eid).toBe(e)
    expect(c0.v.x).toBe(17)
    expect(c0.v.y).toBe(25)
  })

  it('unrelated component mutation does not fire a query observer', () => {
    const w = createWorld()
    const Unrelated = defineTag()
    const q = defineQuery([Position])
    const seen: number[] = []
    observe(w, q, 'add', (eid) => seen.push(eid as number))
    const e = createEntity(w)
    addComponent(w, e, Unrelated) // not Position
    expect(seen.length).toBe(0)
  })
})
