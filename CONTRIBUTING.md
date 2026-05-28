# Contributing to aiecsjs

Thanks for taking the time to look. aiecsjs is a deliberately small ECS core;
contributions that keep the surface narrow and the iteration path hot are
easier to accept than ones that expand it.

## Quick start

```bash
npm install
npm run test            # vitest, ~150 behaviour tests + multi-world isolation
npm run typecheck       # tsc --noEmit on strict mode
npm run lint            # biome check (added in 0.2.0)
npm run build           # tsup; dual ESM/CJS + .d.ts
npm run verify:exports  # ensures package.json#exports matches dist/ (added in 0.2.0)
npm run size            # size-limit per-subpath gzip budget
```

The full pre-publish gate is `npm run prepublishOnly`, which runs typecheck,
tests, build, and the size budget check — in that order. Once 0.2.0 lands,
`lint` and `verify:exports` should also be wired into the gate (see
`package.json`).

## What gets in easily

- Bug fixes with a failing test added first.
- README / typing corrections — especially in `STABILITY.md` or `api.json`
  when an export's stability label drifts from reality.
- Tests that lock down existing behaviour (multi-world isolation, archetype
  migration boundaries, observer fan-out on destroy, etc).
- New `aiecsjs/<subpath>` opt-in modules that follow the same shape as
  `loop`, `commands`, `observers`, `serialize`, `worker`, `relations`:
  independent, named exports only, no side effects, single responsibility,
  tree-shakable.

## What needs discussion first

- Anything that changes the storage layout (archetype tables, TypedArray
  columns, bitmask layout). The Caesar-III-style growth invariants matter.
- New required fields on `World`, `Component`, or `Snapshot`.
- A change that would push any subpath past its `size-limit` budget.
- Reactive value-predicate queries (see "What aiecsjs does NOT do" in the
  README — open an issue with the use case first).

## Design principles

aiecsjs follows the core priority order:

> Security > Correctness > Simplicity > YAGNI > Performance

In particular, the public API stays **functional and tree-shakable** — no
class constructors on the public surface, factory functions only.
`destroyWorld` is the original 0.1.x export and is now **deprecated** since
0.2.0 — see `STABILITY.md`. New code should use `disposeWorld`, which is the
same function under the ai*js ecosystem `dispose()` convention.
`destroyWorld` is scheduled for removal in 1.0.

## Commit & PR style

- Commit messages: imperative subject under 70 chars; body explains *why*.
- PRs: keep scope to one topic. Link the issue if any.
- Tests required for any behaviour change. Property-based tests welcome for
  invariants (`tests/multi-world.test.ts` is the reference shape).

## Reporting issues

- Minimal reproduction welcome: paste the smallest
  `createWorld + addComponent + runQuery` triple that shows the bug.
- For security issues (e.g. snapshot/SAB validation bypass), please email
  the maintainer rather than filing publicly.

## Release flow

Releases are tag-triggered via the GitHub Actions workflow
(`.github/workflows/publish.yml`). From a clean tree on `main`:

```bash
npm version patch       # or `minor` / `major`
git push --follow-tags
```

The workflow triggers on `v*` tag push and runs the full gate before
publishing:

1. typecheck / tests / build
2. size budget gate
3. `npm publish --provenance --access public`

A failed gate stops the publish; the tag stays on the repo but nothing
ships.

## License

By contributing, you agree your changes will be licensed under the MIT
license that covers this project.
