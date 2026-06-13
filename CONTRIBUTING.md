# Contributing to aiecsjs

Keep ECS changes explicit, benchmarkable, and compatible with the public subpath contracts.

## Local workflow

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm verify:docs
pnpm build:llms
pnpm verify:llms
pnpm verify:exports
pnpm verify:dist
pnpm check:size
```

Run `pnpm lint` before PRs; existing `noExplicitAny` warnings are known backlog, not an excuse to add more.

## Rules

- Do not expose `internal/*` as public API.
- Use command buffers in examples that mutate structure during iteration.
- Add regression tests for entity lifetime, archetype moves, relation cleanup, serialization, and worker transport changes.
- Keep docs short and update `llms-full.txt` after docs edits.
- Discuss storage layout or entity id compatibility changes before implementation.

## License

MIT
