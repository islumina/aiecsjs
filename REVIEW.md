# aiecsjs Review

Current review state after the 2026-06-10 ai*js pass. Historical fixed findings were summarized to keep AI context focused on still-relevant work.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | Reactive query indexing | Open | Structural changes scan the module-level query cache and can register metadata across worlds/components. Consider world-local indexing. |
| P2 | Relation destroy cleanup | Open | Exclusive relation cleanup scans relation capacity per destroy. Large sparse relation tables can make destroy cost visible. |
| P3 | Reactive buffers | Documented | Enter/exit buffers are unbounded until drained; callers must poll/clear them. |
| P3 | Lint noise | Open | Biome reports many `noExplicitAny` warnings. Reducing them would make future AI/code review cleaner. |

## Fixed Summary

- Hostile snapshot capacity restore is clamped.
- Query loops re-read archetype size and current contents instead of relying on stale loop bounds.
- Worker transferable snapshot types now include `SharedArrayBuffer | ArrayBuffer`.
- README no longer promises build-mode-gated validation that the runtime does not provide.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:dist`
- `pnpm verify:llms`
- `pnpm check:size`
- `pnpm lint` exits successfully but emits known warnings.
