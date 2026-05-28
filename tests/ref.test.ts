import { describe, expect, it } from 'vitest'
import {
  createEntity,
  createWorld,
  destroyEntity,
  entityExists,
  getEntityGeneration,
  getEntityIndex,
  packEntity,
  resetWorld,
} from '../src/index.js'
import { EntityNotAliveError, aliveRef, deref, refOf } from '../src/index.js'
import type { EntityRef } from '../src/index.js'
import { deserializeWorld, serializeWorld } from '../src/serialize.js'
import { adoptSnapshot, transferableSnapshot } from '../src/worker.js'

describe('refOf', () => {
  it('creates ref for alive entity', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(ref).toBeDefined()
    expect(ref.id).toBe(e)
  })

  it('ref.id equals the entity packed value', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(ref.id).toBe(e)
  })

  it('ref.worldId equals world.id', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(ref.worldId).toBe(w.id)
  })

  it('throws EntityNotAliveError for destroyed entity', () => {
    const w = createWorld()
    const e = createEntity(w)
    destroyEntity(w, e)
    expect(() => refOf(w, e)).toThrow(EntityNotAliveError)
    expect(() => refOf(w, e)).toThrow(`entity ${e} is not alive`)
  })

  it('throws EntityNotAliveError for entity that never existed', () => {
    const w = createWorld()
    expect(() => refOf(w, 999 as any)).toThrow(EntityNotAliveError)
  })

  it('throws EntityNotAliveError for eid === 0', () => {
    const w = createWorld()
    expect(() => refOf(w, 0 as any)).toThrow(EntityNotAliveError)
  })

  it('phantom T does not affect runtime behaviour', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref1 = refOf<'bullet'>(w, e)
    const ref2 = refOf<'player'>(w, e)
    // Same underlying data, different phantom types — deref both work
    expect(deref(w, ref1)).toBe(e)
    expect(deref(w, ref2)).toBe(e)
  })
})

describe('deref', () => {
  it('returns packed EntityId when ref is alive', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(deref(w, ref)).toBe(e)
  })

  it('returns null when entity was destroyed (no slot reuse)', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    destroyEntity(w, e)
    expect(deref(w, ref)).toBeNull()
  })

  it('returns null when slot was destroyed and recycled (ABA protection)', () => {
    const w = createWorld()
    const a = createEntity(w)
    const oldRef = refOf(w, a)
    destroyEntity(w, a)
    const b = createEntity(w) // same slot, new generation
    // oldRef still has the old generation — must deref to null
    expect(deref(w, oldRef)).toBeNull()
    // New entity is valid
    const newRef = refOf(w, b)
    expect(deref(w, newRef)).toBe(b)
  })

  it('returns null when ref.worldId mismatches world.id (cross-world)', () => {
    const wA = createWorld()
    const wB = createWorld()
    const eA = createEntity(wA)
    const refA = refOf(wA, eA)
    // deref against worldB — worldId mismatch → null
    expect(deref(wB, refA)).toBeNull()
  })

  it('returns null when getEntityIndex(ref.id) >= state.capacity', () => {
    const w = createWorld({ initialCapacity: 8, maxEntities: 8 })
    const e = createEntity(w)
    const ref = refOf(w, e)
    // Forge a ref with a huge index
    const fakeRef: EntityRef = { id: 9999 as any, worldId: w.id }
    expect(deref(w, fakeRef)).toBeNull()
    // Legitimate ref still works
    expect(deref(w, ref)).toBe(e)
  })

  it('returns null after resetWorld (generations all 0, ref generations != 0)', () => {
    const w = createWorld()
    const e = createEntity(w)
    destroyEntity(w, e) // bump generation to 1
    const e2 = createEntity(w) // gen=1
    const ref = refOf(w, e2)
    resetWorld(w)
    // After reset, generation at that slot is 0; ref has gen 1
    expect(deref(w, ref)).toBeNull()
  })

  it('does not throw', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    destroyEntity(w, e)
    expect(() => deref(w, ref)).not.toThrow()
  })
})

describe('aliveRef', () => {
  it('returns true for alive ref', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(aliveRef(w, ref)).toBe(true)
  })

  it('returns false for stale ref', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    destroyEntity(w, e)
    expect(aliveRef(w, ref)).toBe(false)
  })

  it('returns false for cross-world ref', () => {
    const wA = createWorld()
    const wB = createWorld()
    const eA = createEntity(wA)
    const ref = refOf(wA, eA)
    expect(aliveRef(wB, ref)).toBe(false)
  })

  it('does not throw', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    destroyEntity(w, e)
    expect(() => aliveRef(w, ref)).not.toThrow()
  })
})

describe('generation wrap (8-bit default)', () => {
  it('destroy + create same slot 255 times → old ref still derefs to null (generation mismatch)', () => {
    const w = createWorld()
    const first = createEntity(w)
    const oldRef = refOf(w, first)
    // Cycle 255 times: slot gen goes 0→1→2→...→255 (still alive at gen=255)
    let current = first
    for (let i = 0; i < 255; i++) {
      destroyEntity(w, current)
      current = createEntity(w)
    }
    // oldRef has generation=0; current entity has generation=255 → mismatch → null
    expect(getEntityGeneration(current)).toBe(255)
    expect(deref(w, oldRef)).toBeNull()
    // Current entity is alive via its own ref
    const newRef = refOf(w, current)
    expect(deref(w, newRef)).toBe(current)
  })

  it('destroy + create same slot 257 times → 257th eid has different packed value than the 1st', () => {
    const w = createWorld()
    const first = createEntity(w)
    let current = first
    for (let i = 0; i < 257; i++) {
      destroyEntity(w, current)
      current = createEntity(w)
    }
    // After 257 cycles (256 wrap + 1 more), generation = 1
    expect(current).not.toBe(first)
    expect(getEntityIndex(current)).toBe(getEntityIndex(first))
    expect(getEntityGeneration(current)).toBe(1)
    expect(getEntityGeneration(first)).toBe(0)
  })
})

describe('multi-world', () => {
  it('refOf(worldA, eA) then deref(worldB, ref) returns null', () => {
    const wA = createWorld()
    const wB = createWorld()
    const eA = createEntity(wA)
    const ref = refOf(wA, eA)
    expect(deref(wB, ref)).toBeNull()
  })

  it('same idx in two worlds yields different worldId in ref', () => {
    const wA = createWorld()
    const wB = createWorld()
    const eA = createEntity(wA)
    const eB = createEntity(wB)
    const refA = refOf(wA, eA)
    const refB = refOf(wB, eB)
    expect(refA.worldId).toBe(wA.id)
    expect(refB.worldId).toBe(wB.id)
    expect(refA.worldId).not.toBe(refB.worldId)
  })
})

describe('ref as Map key (bullet-pool use case)', () => {
  it('Map<EntityId, V> with ref.id as key works for borrow/return', () => {
    const w = createWorld()
    const pool = new Map<number, string>()
    const e = createEntity(w)
    const ref = refOf(w, e)
    pool.set(ref.id as number, 'bullet-data')
    expect(pool.get(ref.id as number)).toBe('bullet-data')
    pool.delete(ref.id as number)
    expect(pool.has(ref.id as number)).toBe(false)
  })

  it('after destroy + recreate same slot, old ref.id is different from new ref.id', () => {
    const w = createWorld()
    const e = createEntity(w)
    const oldRef = refOf(w, e)
    destroyEntity(w, e)
    const e2 = createEntity(w)
    const newRef = refOf(w, e2)
    expect(oldRef.id).not.toBe(newRef.id)
    expect(getEntityIndex(oldRef.id)).toBe(getEntityIndex(newRef.id))
  })
})

describe('onRemove handler dispatch timing', () => {
  it('onRemove handler in destroyEntity sees old entity still alive via deref (generation bump happens after handlers)', async () => {
    // Import observers dynamically to avoid top-level side effects
    const { onRemove } = await import('../src/observers.js')
    const { addComponent, defineComponent, Types } = await import('../src/index.js')
    const Tag = defineComponent({ x: Types.f32 })
    const w = createWorld()
    let derefResult: number | null = undefined as any
    onRemove(w, Tag, (eid) => {
      // During onRemove dispatch, entity should still be alive by deref
      // (generation bump happens after all handlers complete)
      const ref: EntityRef = { id: eid, worldId: w.id }
      derefResult = deref(w, ref)
    })
    const e = createEntity(w)
    addComponent(w, e, Tag, { x: 1 })
    destroyEntity(w, e)
    // Handler should have fired and entity was alive during handler
    expect(derefResult).toBe(e)
  })
})

describe('serialize / worker round-trip semantics', () => {
  it('serializeWorld → deserializeWorld → old ref derefs to null (generations reset)', () => {
    const w = createWorld()
    const e = createEntity(w)
    // Bump generation so it's non-zero
    destroyEntity(w, e)
    const e2 = createEntity(w)
    const ref = refOf(w, e2)
    // Round-trip through serialize
    const bytes = serializeWorld(w)
    const w2 = deserializeWorld(bytes)
    // ref.worldId !== w2.id → null (cross-world check)
    expect(deref(w2, ref)).toBeNull()
  })

  it('transferableSnapshot → adoptSnapshot → old ref derefs to null', () => {
    const w = createWorld()
    const e = createEntity(w)
    const ref = refOf(w, e)
    const snap = transferableSnapshot(w)
    const w2 = adoptSnapshot(snap)
    // cross-world check
    expect(deref(w2, ref)).toBeNull()
  })
})

describe('generationBits = 0 degenerate mode', () => {
  it('createWorld({ generationBits: 0 }) — refOf / deref degenerates to alive check', () => {
    const w = createWorld({ generationBits: 0 })
    const e = createEntity(w)
    const ref = refOf(w, e)
    expect(deref(w, ref)).toBe(e)
  })

  it('destroy + create same slot → old ref still derefs to new eid (no ABA protection in generationBits=0)', () => {
    const w = createWorld({ generationBits: 0 })
    const e = createEntity(w)
    const oldRef = refOf(w, e)
    destroyEntity(w, e)
    const e2 = createEntity(w)
    // generationMask=0 → generation always 0 → packed eid is same for same idx
    // so oldRef.id === e2 and entityRow.has(oldRef.id) is true
    // This is the documented degenerate: no ABA protection
    expect(e2).toBe(oldRef.id)
    expect(deref(w, oldRef)).toBe(e2)
  })
})

describe('packEntity / getEntityGeneration', () => {
  it('round-trip: getEntityIndex(packEntity(idx, gen)) === idx', () => {
    expect(getEntityIndex(packEntity(100, 5))).toBe(100)
    expect(getEntityIndex(packEntity(1, 0))).toBe(1)
  })

  it('round-trip: getEntityGeneration(packEntity(idx, gen)) === gen', () => {
    expect(getEntityGeneration(packEntity(100, 5))).toBe(5)
    expect(getEntityGeneration(packEntity(1, 0))).toBe(0)
    expect(getEntityGeneration(packEntity(42, 255))).toBe(255)
  })

  it('packEntity uses default 24/8 bits (documented limitation)', () => {
    // With default 24-bit index + 8-bit generation:
    // packed = (gen << 24) | idx
    const packed = packEntity(1, 1)
    expect(getEntityIndex(packed)).toBe(1)
    expect(getEntityGeneration(packed)).toBe(1)
    // If someone uses non-default indexBits, getEntityGeneration would be wrong —
    // that is the documented limitation; EntityRef / deref should be used instead.
  })
})
