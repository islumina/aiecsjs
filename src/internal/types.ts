// Shared type definitions for aiecsjs internals.
// Public-facing types are re-exported from src/index.ts.

export type EntityId = number & { readonly __brand: 'EntityId' }

export const Types = {
  i8: 'i8',
  u8: 'u8',
  i16: 'i16',
  u16: 'u16',
  i32: 'i32',
  u32: 'u32',
  f32: 'f32',
  f64: 'f64',
  eid: 'eid',
  bool: 'bool',
} as const

export type SoAFieldType =
  | 'i8'
  | 'u8'
  | 'i16'
  | 'u16'
  | 'i32'
  | 'u32'
  | 'f32'
  | 'f64'
  | 'eid'
  | 'bool'

export type SoAFieldDecl = SoAFieldType | readonly [SoAFieldType, number]
export type SoASchema = Readonly<Record<string, SoAFieldDecl>>

export interface SoAComponent<S extends SoASchema = SoASchema> {
  readonly __kind: 'soa'
  readonly __id: number
  readonly __schema: S
}

export interface AoSComponent<T = unknown> {
  readonly __kind: 'aos'
  readonly __id: number
  readonly __factory: () => T
}

export interface TagComponent {
  readonly __kind: 'tag'
  readonly __id: number
}

export type ComponentLike = SoAComponent<any> | AoSComponent<any> | TagComponent

export type ColumnArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array

export interface SoAColumns {
  [field: string]: ColumnArray
}

export type ComponentView<C extends ComponentLike> = C extends SoAComponent<infer _S>
  ? SoAColumns
  : C extends AoSComponent<infer T>
    ? T | undefined
    : C extends TagComponent
      ? boolean
      : never

export type ComponentInit<C extends ComponentLike> = C extends SoAComponent<infer _S>
  ? Record<string, unknown>
  : C extends AoSComponent<infer T>
    ? Partial<T>
    : undefined

export interface QueryDescriptor {
  all?: ComponentLike[]
  any?: ComponentLike[]
  none?: ComponentLike[]
}

export interface Query {
  readonly id: number
  readonly mask: ReadonlyArray<number>
}

export interface Archetype {
  readonly id: number
  readonly mask: ReadonlyArray<number>
  readonly size: number
}

export interface WorldOptions {
  initialCapacity?: number
  maxEntities?: number
  indexBits?: number
  generationBits?: number
  buffer?: SharedArrayBuffer
  bufferByteOffset?: number
}

export interface World {
  readonly id: number
  readonly capacity: number
  readonly version: string
}

export type System<W extends World = World, Ctx = unknown> = (world: W, ctx: Ctx) => W

// --- Internal-only types ---

export interface ResolvedWorldOptions {
  initialCapacity: number
  maxEntities: number
  indexBits: number
  generationBits: number
  indexMask: number
  generationMask: number
  maxComponents: number
  maskWordCount: number
  buffer: SharedArrayBuffer | null
  bufferByteOffset: number
}

export interface FieldInfo {
  name: string
  type: SoAFieldType
  vectorLen: number // 1 for scalar
  ctor: TypedArrayConstructor
  bytesPerElement: number
}

export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor

export interface ComponentInfo {
  id: number
  kind: 'soa' | 'aos' | 'tag'
  schema: SoASchema | null
  fields: FieldInfo[]
  factory: (() => unknown) | null
}

export interface WorldComponentStorage {
  // For each component bit in this world: storage backed by a column map (SoA), object array (AoS), or null (tag)
  kind: 'soa' | 'aos' | 'tag'
  componentId: number
  bit: number
  // SoA: field name → TypedArray of size `worldCapacity`
  soa?: SoAColumns
  // AoS: per-entity object array, sparse, indexed by eid; undefined for unowned
  aos?: (unknown | undefined)[]
}

export interface ArchetypeState {
  id: number
  mask: Uint32Array
  size: number
  capacity: number
  entities: Uint32Array // packed eids in row order
  entityRow: Map<number, number> // eid → row (small archetype-local lookup)
  componentBits: number[] // sorted
  edgeAdd: Int32Array // [bit] → archetype id; -1 unknown
  edgeRemove: Int32Array // [bit] → archetype id; -1 unknown
}

export interface QueryInternal extends Query {
  id: number
  all: number[]
  any: number[]
  none: number[]
  // Cache of column references per matched archetype (per query-call)
  columnViewCache: ComponentLike[] // the requested components in their declared order
  reactiveKind: 'normal' | 'enter' | 'exit'
  sourceQueryId: number // -1 for normal
  sourceQuery: QueryInternal | null // back-ref for reactive registration
}

// Per-world resolved bitmasks for a query. Component bits are assigned per
// world, so the masks must live in WorldState — keeping them on the shared
// QueryInternal would silently cross-contaminate worlds whose component
// registration order differs.
export interface QueryMaskBundle {
  withMask: Uint32Array
  anyMask: Uint32Array
  noneMask: Uint32Array
  anyHasBits: boolean
}

export interface ReactiveBuffer {
  entered: number[]
  exited: number[]
}

export type ObserverEvent = 'add' | 'remove' | 'set'

export interface ObserverEntry {
  event: ObserverEvent
  componentBit: number // -1 means "any component" (used by query observe)
  queryId: number // -1 means component-only
  handler: (eid: EntityId, value?: unknown) => void
}

export interface CommandBufferState {
  worldId: number
  ops: CommandOp[]
  nextPlaceholder: number
  flushing: boolean
}

export type CommandOp =
  | { kind: 'create'; placeholder: number }
  | { kind: 'add'; eid: EntityId; component: ComponentLike; initial?: unknown }
  | { kind: 'remove'; eid: EntityId; component: ComponentLike }
  | { kind: 'destroy'; eid: EntityId }

export interface CommandBuffer {
  add<C extends ComponentLike>(eid: EntityId, component: C, initial?: ComponentInit<C>): void
  remove<C extends ComponentLike>(eid: EntityId, component: C): void
  destroy(eid: EntityId): void
  create(): EntityId
}

export interface WorldMeta {
  magic: number
  formatVersion: number
  aiecsjsVersion: string
  indexBits: number
  generationBits: number
  maxComponents: number
  maskWordCount: number
  capacity: number
  componentSchemas: Array<{ id: number; kind: 'soa' | 'aos' | 'tag'; schema: SoASchema | null }>
}

export interface TransferableSnapshot {
  buffer: SharedArrayBuffer
  meta: WorldMeta
}

export interface SerializeOptions {
  components?: ComponentLike[]
}

export interface DeserializeOptions {
  components?: ComponentLike[]
  onUnknownVersion?: 'throw' | 'best-effort'
}

export interface WorldSnapshot {
  version: string
  capacity: number
  entities: Array<{
    eid: number
    components: Array<{
      kind: 'soa' | 'aos' | 'tag'
      id: number
      data: unknown
    }>
  }>
}

export interface DeltaSerializer {
  capture(): Uint8Array
  apply(world: World, delta: Uint8Array): void
  reset(): void
}

export interface Relation<T = void> {
  readonly __kind: 'relation'
  readonly __id: number
  readonly __exclusive: boolean
  readonly __hasData: boolean
}

export interface RelationStorage {
  rel: Relation<any>
  exclusive: Int32Array | null // [srcEid] → tgtEid; -1 means none
  outgoing: Map<number, number[]> // srcEid → tgtEid[]
  data: Map<number, Map<number, unknown>> // srcEid → (tgtEid → data); nested to stay correct across capacity growth
}

export interface WorldState {
  // --- public view ---
  readonly id: number
  capacity: number
  readonly version: string

  // --- options ---
  options: ResolvedWorldOptions

  // --- entity allocation ---
  size: number // alive count
  nextFreshIndex: number // never-used index
  freeList: number[] // recycled indices
  generations: Uint8Array | Uint16Array // [eid] → version
  destroyed: boolean

  // --- component registry (per-world) ---
  componentBitFor: Map<number, number> // global component id → bit pos in this world
  componentInfoByBit: (ComponentInfo | null)[] // bit pos → ComponentInfo
  componentStorageByBit: (WorldComponentStorage | null)[]
  nextComponentBit: number

  // --- sparse entity state ---
  entityArchetype: Uint32Array // [eid] → archetype id (0 = unattached)
  // entityMask flattened: word w of mask of eid is at entityMask[eid * maskWordCount + w]
  entityMask: Uint32Array

  // --- archetype registry ---
  archetypes: ArchetypeState[]
  archetypeByMaskHash: Map<string, number>
  queryVersion: number

  // --- query cache ---
  queries: QueryInternal[] // by id
  queryMasks: Map<number, QueryMaskBundle> // queryId → per-world resolved bitmasks
  queryArchetypeCache: (number[] | null)[]
  queryArchetypeStamp: number[]
  bitToQueries: Map<number, Set<number>> // bit → queryIds that mention this bit

  // --- reactive query state ---
  reactiveBuffers: Map<number, ReactiveBuffer> // queryId → { entered, exited }

  // --- observers ---
  observers: ObserverEntry[]

  // --- relations ---
  relationStorage: Map<number, RelationStorage> // relation id → storage

  // --- worker / SAB ---
  sab: SharedArrayBuffer | null
  readOnly: boolean
}
