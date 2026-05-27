import { describe, it, expect } from 'vitest'
import { VERSION, IS_SAB_SUPPORTED, isWorld, isEntity, createWorld, createEntity } from '../src/index.js'
import pkg from '../package.json' with { type: 'json' }

describe('utility', () => {
  it('VERSION matches package.json', () => {
    expect(VERSION).toBe(pkg.version)
  })

  it('IS_SAB_SUPPORTED is a boolean', () => {
    expect(typeof IS_SAB_SUPPORTED).toBe('boolean')
  })

  it('isWorld returns false for non-worlds', () => {
    expect(isWorld(null)).toBe(false)
    expect(isWorld(undefined)).toBe(false)
    expect(isWorld({})).toBe(false)
    expect(isWorld('world')).toBe(false)
  })

  it('isWorld returns true for a real world', () => {
    const w = createWorld()
    expect(isWorld(w)).toBe(true)
  })

  it('isEntity rejects 0 and unknowns', () => {
    const w = createWorld()
    const e = createEntity(w)
    expect(isEntity(w, e)).toBe(true)
    expect(isEntity(w, 0)).toBe(false)
    expect(isEntity(w, 'foo')).toBe(false)
    expect(isEntity(w, null)).toBe(false)
  })
})
