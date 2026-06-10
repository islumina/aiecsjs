// aiecsjs/internal/errors — named error types for the core.

/**
 * Thrown by core world/entity/component operations for invariant violations and
 * misuse (bad world options, a destroyed/unknown world, exhausted component
 * slots, capacity overflow). Carries the existing `aiecsjs: `-prefixed message.
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
  constructor(message: string) {
    super(message)
    this.name = 'EcsError'
  }
}
