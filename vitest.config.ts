import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Thresholds reflect the achievable bar on pristine source (no coverage
      // pragmas, no defensive-guard removal). These are a real regression gate —
      // raise them only by adding tests, never by stripping defensive code or
      // scattering `/* v8 ignore */`.
      //
      // WHY THIS REPO'S THRESHOLDS DIFFER FROM THE FAMILY 95/90/100/100 TARGET:
      //
      // branches (81, not 90):
      //   The dominant cause is structural: tsconfig enables both
      //   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (both true),
      //   which generates nullish-fallback branches (`?? 0`, `?.foo`, `storage?.soa`)
      //   on every TypedArray access. These false branches are semantically
      //   unreachable — the array is always allocated before access — but V8 still
      //   counts them. Additional sources:
      //   • bitmask.ts bit-twiddling: `word & -word`, `clz32` edge cases — ~65%
      //     branches, all structural (bit ops on known-nonzero values).
      //   • query.ts buildColumnViews `bit === undefined` and `!storage` are dead
      //     defensive guards — ensureQueryRegistered always registers the bit and
      //     allocates storage before buildColumnViews runs.
      //   • query.ts ensureReactiveBuffer `!buf` is unreachable because
      //     ensureQueryRegistered creates the buffer before pushReactive calls
      //     ensureReactiveBuffer.
      //
      // functions (100): the 0.6.0 pass deleted the unreachable `() => ({})`
      //   fallback factories (component.ts writeInitial, serialize.ts
      //   getComponentHandle), so every function is exercised.
      //
      // lines (99, not 100):
      //   Genuinely unreachable lines in the Node.js test environment:
      //   • loop.ts — `cancelAnimationFrame(handle)` inside cancelRaf; hasRAF
      //     is evaluated once at module load time (false in Node), so the RAF
      //     branch is permanently dead for the lifetime of this test process.
      //   • world.ts — `ensureCapacity` maxEntities throw; createEntity and
      //     ensureEntityAtSlot guard the same condition first, so this defensive
      //     throw (which also stops the doubling loop from spinning) is never
      //     reached.
      //
      // DEFERRED STRICT FLAGS (not enabled this wave):
      //   `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are now ON (0
      //   errors). The four remaining strict-family flags stay off because turning
      //   them on surfaces 30 pre-existing type errors (src 15 / tests 15):
      //   `noUnusedLocals` (28) dominates, `noUnusedParameters` (2);
      //   `noImplicitReturns` and `noFallthroughCasesInSwitch` are already clean (0
      //   each). These are a proper narrowing/cleanup task, deferred to a dedicated
      //   pass rather than smuggled into this review wave.
      thresholds: { statements: 95, branches: 81, functions: 100, lines: 99 },
    },
  },
})
