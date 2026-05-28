import { describe, expect, it } from 'vitest'
import { createWorld, pipe } from '../src/index.js'

describe('pipe', () => {
  it('empty pipe returns world unchanged', () => {
    const w = createWorld()
    const id = pipe()
    expect(id(w, undefined)).toBe(w)
  })

  it('single-system pipe equals the system', () => {
    const w = createWorld()
    const s = (world: any, _ctx: any) => world
    expect(pipe(s)(w, undefined)).toBe(w)
  })

  it('threads ctx through systems', () => {
    const w = createWorld()
    const order: string[] = []
    const s1 = (world: any, ctx: any) => {
      order.push(`1:${ctx}`)
      return world
    }
    const s2 = (world: any, ctx: any) => {
      order.push(`2:${ctx}`)
      return world
    }
    pipe(s1, s2)(w, 'hello')
    expect(order).toEqual(['1:hello', '2:hello'])
  })

  it('pipe is associative', () => {
    const w = createWorld()
    const s1 = (world: any) => world
    const s2 = (world: any) => world
    const s3 = (world: any) => world
    const a = pipe(pipe(s1, s2), s3)
    const b = pipe(s1, pipe(s2, s3))
    expect(a(w, undefined)).toBe(b(w, undefined))
  })

  it('returns the same world reference', () => {
    const w = createWorld()
    const s = (world: any) => world
    expect(pipe(s, s, s)(w, undefined)).toBe(w)
  })
})
