// aiecsjs/internal/errors — named error types for the core.

/**
 * Thrown by aiecsjs for invariant violations and misuse, with an
 * `aiecsjs: `-prefixed message:
 *
 * - world: bad or non-integer world options, a destroyed/unknown/missing world,
 *   exhausted component slots, capacity overflow, `maxEntities` reached;
 * - read-only (worker-attached) worlds: every mutator — `createEntity`,
 *   `destroyEntity`, `addComponent`/`removeComponent`/`setComponent`,
 *   `resetWorld`, `addRelation`/`removeRelation`, delta `apply()`;
 * - entities/components: `addComponent`/`setComponent` on a dead entity, an
 *   unregistered component (or query component id), an invalid or duplicate
 *   component `key`, a non-function or nullish-returning AoS factory;
 * - relations: `addRelation` on a dead source or target, a value that is not a
 *   relation handle;
 * - callbacks: a non-function observer handler, `forEachEntity` /
 *   `forEachEntityIndexed` / `withCommandBuffer` callback or `pipe` system;
 * - command buffers: an unknown buffer or an unresolved placeholder;
 * - snapshots (`aiecsjs/serialize`, `aiecsjs/worker`): malformed binary
 *   headers or bodies, invalid worker meta, an unsupported format version, an
 *   unknown component or a component kind/field mismatch.
 *
 * `defineComponent` field-declaration errors and non-Query input to the query
 * functions throw `TypeError` instead; `aiecsjs/loop` throws `TypeError` /
 * `RangeError` (it exports no error class).
 *
 * Catch this to distinguish an aiecsjs-originated failure from an unrelated
 * runtime error, instead of string-matching on the message. Mirrors the
 * {@link EntityNotAliveError} class style.
 *
 * @example
 * try {
 *   createWorld({ indexBits: 99 })
 * } catch (err) {
 *   if (err instanceof EcsError) {
 *     // an aiecsjs invariant was violated
 *   }
 * }
 */
export class EcsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EcsError'
  }
}
