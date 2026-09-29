// aiecsjs/commands — deferred structural mutations during iteration.

import { addComponent, removeComponent } from './internal/component.js'
import { createEntity, destroyEntity } from './internal/entity.js'
import { EcsError } from './internal/errors.js'
import type {
  CommandBuffer,
  CommandBufferState,
  CommandOp,
  ComponentInit,
  ComponentLike,
  EntityId,
  World,
} from './internal/types.js'
import { getWorldState } from './internal/world.js'

export function createCommandBuffer(world: World): CommandBuffer {
  const state = getWorldState(world)
  const buf: CommandBufferState = {
    worldId: state.id,
    ops: [],
    nextPlaceholder: -1,
    flushing: false,
  }
  return makeApi(buf)
}

// Applies the queued ops, then empties the queue. Each round detaches the
// queue before any op runs, so if an op throws midway the ops already applied
// stay applied and the rest are dropped — a retried flush never replays Phase 1
// (duplicate entities) or the already-applied prefix. Ops queued on this buffer
// while a round runs (e.g. from onAdd / onRemove handlers) form the next round
// of the same flush, so their creates are resolved before their add/remove.
export function flush(cb: CommandBuffer): void {
  const state = stateOf(cb)
  if (state.flushing) return
  state.flushing = true
  try {
    // Every op resolves the world by id; resolving it up front makes a flush
    // on a disposed world throw EcsError even when the queue is empty.
    const world = { id: state.worldId } as World
    getWorldState(world)
    // Flush-wide: placeholders keep counting down across rounds, so an id
    // minted mid-flush never collides with one from an earlier round.
    const placeholders = new Map<number, EntityId>()

    const resolve = (eid: EntityId): EntityId => {
      const num = eid as number
      if (num < 0) {
        const real = placeholders.get(num)
        if (real === undefined) throw new EcsError(`aiecsjs: unresolved placeholder ${num}`)
        return real
      }
      return eid
    }

    while (state.ops.length > 0) {
      const ops = state.ops
      state.ops = []

      // Phase 1: resolve placeholders by creating real entities first
      for (const op of ops) {
        if (op.kind === 'create') {
          placeholders.set(op.placeholder, createEntity(world))
        }
      }

      // Phase 2: add/remove in queue order
      for (const op of ops) {
        if (op.kind === 'add') {
          addComponent(
            world,
            resolve(op.eid),
            op.component,
            op.initial as ComponentInit<ComponentLike>,
          )
        } else if (op.kind === 'remove') {
          removeComponent(world, resolve(op.eid), op.component)
        }
      }

      // Phase 3: destroy last
      for (const op of ops) {
        if (op.kind === 'destroy') {
          destroyEntity(world, resolve(op.eid))
        }
      }
    }
  } finally {
    // Ops a handler queued in a round that then threw stay queued; keep the
    // counter running so the next create cannot reuse their placeholder ids.
    if (state.ops.length === 0) state.nextPlaceholder = -1
    state.flushing = false
  }
}

export function withCommandBuffer<R>(world: World, fn: (cb: CommandBuffer) => R): R {
  if (typeof fn !== 'function') throw new EcsError('aiecsjs: fn must be a function')
  const cb = createCommandBuffer(world)
  const result = fn(cb)
  flush(cb)
  return result
}

// --- Internals ---

const cbStateMap = new WeakMap<object, CommandBufferState>()

function makeApi(state: CommandBufferState): CommandBuffer {
  const api: CommandBuffer = {
    add(eid, component, initial) {
      state.ops.push({ kind: 'add', eid, component, initial })
    },
    remove(eid, component) {
      state.ops.push({ kind: 'remove', eid, component })
    },
    destroy(eid) {
      state.ops.push({ kind: 'destroy', eid })
    },
    create() {
      const ph = state.nextPlaceholder--
      state.ops.push({ kind: 'create', placeholder: ph })
      return ph as EntityId
    },
  }
  cbStateMap.set(api, state)
  return api
}

function stateOf(cb: CommandBuffer): CommandBufferState {
  const s = cbStateMap.get(cb)
  if (!s) throw new EcsError('aiecsjs: unknown CommandBuffer')
  return s
}
