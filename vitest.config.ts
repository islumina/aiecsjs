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
      //   • bitmask.ts bit-twiddling: `word & -word`, `clz32` edge cases — 67.18%
      //     branches, all structural (bit ops on known-nonzero values).
      //   • query.ts:327-329 (buildColumnViews `bit === undefined`) and :332-334
      //     (`!storage`) are dead defensive guards — ensureQueryRegistered always
      //     registers the bit and allocates storage before buildColumnViews runs.
      //   • query.ts:415-417 (ensureReactiveBuffer `!buf`) is unreachable because
      //     ensureQueryRegistered creates the buffer before pushReactive calls
      //     ensureReactiveBuffer.
      //
      // functions (98, not 100):
      //   Three module-level initialisation stubs that are replaced before any
      //   call reaches them:
      //   • component.ts:386 `let _maskChange = () => {}` — replaced at index.ts
      //     module init; the stub is never invoked in a fully-imported environment.
      //   • component.ts:269 `() => ({})` — fallback factory in writeInitial; only
      //     fires when info.factory is null for an AoS component, which is
      //     structurally impossible (defineObjectComponent always sets factory).
      //   • serialize.ts:150 `() => ({})` — same as above inside getComponentHandle.
      //
      // lines (99, not 100):
      //   Genuinely unreachable lines in the Node.js test environment:
      //   • worker.ts:27-29 — SAB-unsupported fallback; SAB is always available
      //     in Node.js, so this branch can never be taken in the test runner.
      //   • loop.ts:24 — `cancelAnimationFrame(handle)` inside cancelRaf; hasRAF
      //     is evaluated once at module load time (false in Node), so the RAF
      //     branch is permanently dead for the lifetime of this test process.
      //   • world.ts:221 — `ensureCapacity` maxEntities throw; entity.ts:42 guards
      //     the same condition first, so this defensive throw is never reached.
      //   • serialize.ts:209 — "truncated before verLen" throw; the `bytes.length
      //     < 12` check at line 184 fires first for all short inputs, making this
      //     guard permanently unreachable.
      //
      // DEFERRED STRICT FLAGS (not enabled this wave):
      //   `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are now ON (0
      //   errors). The four remaining strict-family flags stay off because turning
      //   them on surfaces 30 pre-existing type errors (src 15 / tests 15):
      //   `noUnusedLocals` (28) dominates, `noUnusedParameters` (2);
      //   `noImplicitReturns` and `noFallthroughCasesInSwitch` are already clean (0
      //   each). These are a proper narrowing/cleanup task, deferred to a dedicated
      //   pass rather than smuggled into this review wave.
      thresholds: { statements: 95, branches: 81, functions: 98, lines: 99 },
    },
  },
})
