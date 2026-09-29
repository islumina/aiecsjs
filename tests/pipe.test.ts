import { describe, expect, it } from 'vitest'
import { EcsError, type World, createWorld, pipe } from '../src/index.js'

describe('pipe', () => {
  it('empty pipe returns world unchanged', () => {
    const w = createWorld()
    const id = pipe()
    expect(id(w, undefined)).toBe(w)
  })

  it('single-system pipe equals the system', () => {
    const w = createWorld()
    const s = (world: World, _ctx: unknown) => world
    expect(pipe(s)(w, undefined)).toBe(w)
  })

  it('threads ctx through systems', () => {
    const w = createWorld()
    const order: string[] = []
    const s1 = (world: World, ctx: unknown) => {
      order.push(`1:${ctx}`)
      return world
    }
    const s2 = (world: World, ctx: unknown) => {
      order.push(`2:${ctx}`)
      return world
    }
    pipe(s1, s2)(w, 'hello')
    expect(order).toEqual(['1:hello', '2:hello'])
  })

  it('pipe is associative', () => {
    const w = createWorld()
    const s1 = (world: World) => world
    const s2 = (world: World) => world
    const s3 = (world: World) => world
    const a = pipe(pipe(s1, s2), s3)
    const b = pipe(s1, pipe(s2, s3))
    expect(a(w, undefined)).toBe(b(w, undefined))
  })

  it('returns the same world reference', () => {
    const w = createWorld()
    const s = (world: World) => world
    expect(pipe(s, s, s)(w, undefined)).toBe(w)
  })
})

describe('pipe argument validation', () => {
  it('rejects a non-function system with EcsError at composition time', () => {
    const ok = (world: ReturnType<typeof createWorld>) => world
    const bad = undefined as unknown as typeof ok
    expect(() => pipe(bad)).toThrow(EcsError)
    expect(() => pipe(ok, bad)).toThrow('aiecsjs: every system must be a function')
  })
})
