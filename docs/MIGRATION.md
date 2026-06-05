# Migration Guide

[English](MIGRATION.md) | [繁體中文](MIGRATION_ZHTW.md)

Concrete name-mapping tables and mental-model notes for switching to `aiecsjs` from other JavaScript ECS libraries.

## From bitECS 0.4

bitECS and aiecsjs share the most DNA: both are functional, both use TypedArray columns, both compose systems with `pipe`. The differences are real but small.

### Name mappings

| bitECS 0.4 | aiecsjs 0.1 |
|---|---|
| `createWorld()` | `createWorld()` |
| `defineComponent({ x: Types.f32 })` | `defineComponent({ x: Types.f32 })` |
| `addComponent(world, Comp, eid)` | `addComponent(world, eid, Comp, init?)` ← **arg order!** |
| `removeComponent(world, Comp, eid)` | `removeComponent(world, eid, Comp)` |
| `hasComponent(world, Comp, eid)` | `hasComponent(world, eid, Comp)` |
| `addEntity(world)` | `createEntity(world)` |
| `removeEntity(world, eid)` | `destroyEntity(world, eid)` |
| `defineQuery([Comp])(world)` | `forEachEntity(world, defineQuery([Comp]), fn)` |
| `enterQuery(query)` | `enterQuery(defineQuery([...]))` (no `world` arg) |
| `exitQuery(query)` | `exitQuery(defineQuery([...]))` |
| `Not(Comp)` | `defineQuery({ all: [...], none: [Comp] })` |
| `pipe(s1, s2)(world)` | `pipe(s1, s2)(world, ctx)` (ctx threaded through) |
| `defineSerializer(...)` | `createDeltaSerializer(world, { components })` |
| `createRelation(...)` | `defineRelation(...)` (target 0.2) |
| `withVersioning(bits)` | `createWorld({ indexBits, generationBits })` |
| `observe(world, query, ...)` | `observe(world, query, event, handler)` |

### Mental shifts

**Storage model.** bitECS uses per-component SparseSet + bitmask. aiecsjs uses archetype tables. The performance characteristics differ:

- Adding/removing a tag every frame is **cheaper in bitECS** (sparse set has O(1) toggle).
- Iterating a hot query over 10k entities is **cheaper in aiecsjs** (contiguous archetype columns).
- For tags you toggle often, store a `boolean` field in a stable component instead of `add`/`removeComponent`.

**Argument order.** This is the #1 source of bugs when porting:

```ts
// bitECS:
addComponent(world, Position, eid)

// aiecsjs:
addComponent(world, eid, Position, { x: 0, y: 0 })
```

The aiecsjs order is `(world, eid, component, init)` — entity first because it's the subject of the operation.

**Query iteration.** bitECS returns the entity array from the query function call. aiecsjs separates query definition from execution:

```ts
// bitECS:
const movers = defineQuery([Position, Velocity])
const eids = movers(world)
for (let i = 0; i < eids.length; i++) {
  const e = eids[i]
  Position.x[e] += Velocity.x[e]
}

// aiecsjs:
const movers = defineQuery([Position, Velocity])
forEachEntity(world, movers, (e, pos, vel) => {
  const i = getEntityIndex(e)   // `e` is a packed EntityId, not a column index
  pos.x[i] += vel.x[i]
})
```

The aiecsjs version is shorter and gets column views as callback arguments. Note the key difference from bitECS: there, the query yields a bare entity index and `Position.x[eid]` indexes the column directly. In aiecsjs the callback `e` is a **packed `EntityId`** (index + generation), so index columns with `getEntityIndex(e)` — the packed id only equals the index until a slot is recycled.

**Entity versioning.** Both support it. bitECS exposes `withVersioning(bits)`; aiecsjs takes `indexBits` and `generationBits` directly in `WorldOptions`.

```ts
// bitECS:
const world = createWorld(withVersioning(8))

// aiecsjs:
const world = createWorld({ indexBits: 24, generationBits: 8 })
```

### Porting a system

bitECS:
```ts
const movementSystem = (world) => {
  const ents = movers(world)
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i]
    Position.x[eid] += Velocity.x[eid]
    Position.y[eid] += Velocity.y[eid]
  }
  return world
}
```

aiecsjs:
```ts
const movementSystem = (world, dt = 1) => {
  forEachEntityIndexed(world, movers, (e, i, pos, vel) => {
    pos.x[i] += vel.x[i] * dt   // `i` is the safe column subscript
    pos.y[i] += vel.y[i] * dt
  })
  return world
}
```

## From miniplex

miniplex is object-oriented and entity-shape-driven; aiecsjs is functional and component-declaration-driven. The port is a small mental adjustment but worthwhile if you need TypedArray performance or multi-thread support.

### Name mappings

| miniplex 2.0 | aiecsjs 0.1 |
|---|---|
| `const world = new World<Entity>()` | `const world = createWorld()` |
| `world.add({ position: {x, y}, velocity: {x, y} })` | `createEntity` + multiple `addComponent` calls |
| `world.with('position', 'velocity')` | `defineQuery([Position, Velocity])` |
| `world.archetype('position', 'velocity')` | `defineQuery([Position, Velocity])` |
| `query.entities` | `runQuery(world, query)` |
| `for (const e of query)` | `forEachEntity(world, query, fn)` |
| `query.onEntityAdded.add(fn)` | `enterQuery(query)` + observe in a system |
| `query.onEntityRemoved.add(fn)` | `exitQuery(query)` |
| `world.remove(entity)` | `destroyEntity(world, eid)` |
| `world.queue.add(...)`, `world.queue.flush()` | `withCommandBuffer(world, cb => cb.create() ...)` |
| `world.where(predicate)` | (filter inside `forEachEntity` callback) |
| `<Entities of={query}>` (miniplex-react) | (not yet — see roadmap) |

### Mental shifts

**Component declaration up front.** In miniplex, components are object property names that exist if you assign them. In aiecsjs, components must be declared:

```ts
// miniplex:
const e = world.add({ position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 } })

// aiecsjs:
const Position = defineComponent({ x: Types.f32, y: Types.f32 })
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 })
const e = createEntity(world)
addComponent(world, e, Position, { x: 0, y: 0 })
addComponent(world, e, Velocity, { x: 1, y: 0 })
```

The win is TypedArray-backed columns (fast iteration) and SAB-safe storage. The cost is the upfront component declarations.

**Heterogeneous references.** If your miniplex entities have `mesh: THREE.Mesh` properties, use `defineObjectComponent` in aiecsjs:

```ts
const MeshRef = defineObjectComponent<{ mesh: THREE.Mesh | null }>(() => ({ mesh: null }))
addComponent(world, e, MeshRef, { mesh: someMesh })
```

But remember: AoS components are main-thread only.

**Iteration callbacks vs. iterators.** miniplex's `for (const e of query)` is convenient but allocates the iterator each frame. `forEachEntityIndexed(world, query, fn)` is the hot path (and yields the safe column index `i`); use `forEachEntity` when you only need the `EntityId`, and reach for `iterQuery` only when you need `for...of` semantics.

### Porting a system

miniplex:
```ts
const movement = (dt: number) => {
  for (const e of world.with('position', 'velocity')) {
    e.position.x += e.velocity.x * dt
    e.position.y += e.velocity.y * dt
  }
}
```

aiecsjs:
```ts
const movers = defineQuery([Position, Velocity])
const movement = (world, dt) => {
  forEachEntityIndexed(world, movers, (e, i, pos, vel) => {
    pos.x[i] += vel.x[i] * dt   // `i` is the safe column subscript
    pos.y[i] += vel.y[i] * dt
  })
  return world
}
```

## From ECSY

ECSY is [archived](https://github.com/ecsyjs/ecsy) (April 2025). Migration to aiecsjs is straightforward because both are archetype-style ECS. ECSY's OO ergonomics map cleanly to aiecsjs's functional API.

### Name mappings

| ECSY | aiecsjs 0.1 |
|---|---|
| `class C extends Component { static schema = { x: { type: Types.Number } } }` | `defineComponent({ x: Types.f64 })` |
| `class Tag extends TagComponent {}` | `defineTag()` |
| `class S extends System { static queries = { foo: { components: [...] } }; execute(dt) { this.queries.foo.results.forEach(...) } }` | `const fooQ = defineQuery([...])`; `const S = (world, dt) => { forEachEntity(world, fooQ, fn); return world }` |
| `world.registerComponent(C)` | (implicit on `defineComponent`) |
| `world.registerSystem(S)` | (none — `pipe` orders systems) |
| `world.execute(dt, time)` | `tick(world, dt)` where `tick = pipe(S1, S2, ...)` |
| `world.createEntity()` | `createEntity(world)` |
| `entity.addComponent(C, data)` | `addComponent(world, eid, C, data)` |
| `entity.removeComponent(C)` | `removeComponent(world, eid, C)` |
| `entity.getComponent(C)` | `getComponent(world, eid, C)` |
| `entity.getMutableComponent(C)` | `getComponent(world, eid, C)` (always mutable in aiecsjs) |
| `queries.foo.added` | `enterQuery(fooQ)` |
| `queries.foo.removed` | `exitQuery(fooQ)` |
| `queries.foo.changed` | (use `onSet` observer or own change tracking) |

### Mental shifts

**No `class System`.** Systems are functions, not classes. Drop `extends System`, `execute`, and `static queries` — define a query at module top-level and pass it to `forEachEntity`.

```ts
// ECSY:
class MovementSystem extends System {
  static queries = { movers: { components: [Position, Velocity] } }
  execute(dt: number) {
    this.queries.movers.results.forEach((e) => {
      const pos = e.getMutableComponent(Position)
      const vel = e.getComponent(Velocity)
      pos.x += vel.x * dt
      pos.y += vel.y * dt
    })
  }
}
world.registerSystem(MovementSystem)
world.execute(1/60)
```

```ts
// aiecsjs:
const movers = defineQuery([Position, Velocity])
const movement = (world, dt) => {
  forEachEntityIndexed(world, movers, (e, i, pos, vel) => {
    pos.x[i] += vel.x[i] * dt   // `i` is the safe column subscript
    pos.y[i] += vel.y[i] * dt
  })
  return world
}
const tick = pipe(movement)
tick(world, 1/60)
```

**SoA columns vs. component instances.** ECSY components are class instances with fields like `pos.x`. aiecsjs SoA components are column maps indexed by the entity **index**. Prefer `forEachEntityIndexed`, whose `(e, i, ...cols)` callback hands you the correct subscript `i` directly (`pos.x[i]`) — the packed `e` is not a column offset and diverges from the index once a slot is recycled. With the raw `forEachEntity` form, derive it via `getEntityIndex(e)`: `pos.x[getEntityIndex(e)]`.

**No `priority` or scheduling DSL.** aiecsjs systems run in `pipe()` order. If you depended on ECSY's `priority` for ordering, just write the pipe in the right order.

**`Types.Number` → `Types.f64` (or `f32`).** ECSY's numeric type is double-precision; aiecsjs lets you pick the width. Use `f32` for game data, `f64` only if you genuinely need it.

## Common pitfalls when migrating (from any library)

1. **Forgetting to `pipe(...)` system function** — calling each system manually and forgetting to thread the world reference. Compose with `pipe` once and call `tick(world, ctx)`.
2. **Calling `defineComponent` inside a system** — components are identity-based and must be module-level constants.
3. **Caching `getComponent()` return value** — after an entity's archetype changes, the view is stale. Re-fetch each frame.
4. **Iterating with `for...of` on `runQuery` result** — `runQuery` allocates an array each call. Use `forEachEntityIndexed` in hot paths (or `forEachEntity` when you only need the `EntityId`).
   - **Indexing columns with the packed `EntityId`** — `pos.x[e]` corrupts after a slot is recycled. `forEachEntityIndexed`'s `(e, i, ...cols)` callback hands you the safe subscript `i`; with `forEachEntity`, use `getEntityIndex(e)`.
5. **Trying to share AoS components across Workers** — only SoA components live in SharedArrayBuffer. Replace AoS with SoA before going multi-thread.
