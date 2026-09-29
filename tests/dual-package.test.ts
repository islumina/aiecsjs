// Dual-package hazard: the ESM and CJS builds (or duplicated bundles) can load
// two copies of aiecsjs into one process. `vi.resetModules()` + a dynamic
// import gives this file a second, independent module instance of the package,
// standing in for the second copy.

import { describe, expect, it, vi } from 'vitest'
import * as a from '../src/index.js'
import * as aRel from '../src/relations.js'

async function loadSecondCopy() {
  vi.resetModules()
  const b = await import('../src/index.js')
  const bObs = await import('../src/observers.js')
  const bRel = await import('../src/relations.js')
  return { b, bObs, bRel }
}

describe('two copies of the package in one process', () => {
  it('component ids never collide and handles resolve across copies', async () => {
    const { b } = await loadSecondCopy()
    expect(b).not.toBe(a)
    const PluginHealth = b.defineComponent({ hp: b.Types.i32 })
    const AppPosition = a.defineComponent({ x: a.Types.f32 })
    expect(PluginHealth.__id).not.toBe(AppPosition.__id)

    const w = a.createWorld()
    const e = a.createEntity(w)
    a.addComponent(w, e, PluginHealth, { hp: 100 })
    expect(a.hasComponent(w, e, AppPosition)).toBe(false)
    expect(a.hasComponent(w, e, PluginHealth)).toBe(true)
    const cols = a.getComponent(w, e, PluginHealth) as { hp: Int32Array }
    expect(cols.hp[a.getEntityIndex(e)]).toBe(100)
  })

  it('a world, query and observer from one copy work through the other', async () => {
    const { b, bObs } = await loadSecondCopy()
    const P = a.defineComponent({ x: a.Types.f32 })
    const w = a.createWorld()
    const seen: number[] = []
    bObs.onAdd(w, P, (eid) => seen.push(eid as number))
    const e = b.createEntity(w)
    b.addComponent(w, e, P, { x: 1 })
    expect(seen).toEqual([e])
    expect(a.runQuery(w, b.defineQuery([P]))).toEqual([e])
  })

  it('ChildOf is the same relation in both copies', async () => {
    const { bRel } = await loadSecondCopy()
    expect(bRel.ChildOf).toBe(aRel.ChildOf)
    expect(bRel.defineRelation().__id).not.toBe(aRel.defineRelation().__id)
  })
})
