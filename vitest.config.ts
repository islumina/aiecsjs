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
      // pragmas, no defensive-guard removal). The branch figure honours the
      // `?? 0` / noUncheckedIndexedAccess idiom on TypedArray reads, whose
      // nullish-fallback branches are unreachable by design. These are a real
      // regression gate — raise them only by adding tests, never by stripping
      // defensive code or scattering `/* v8 ignore */`.
      thresholds: { statements: 95, branches: 80, functions: 97, lines: 98 },
    },
  },
})
