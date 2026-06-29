# Changelog

All notable changes to aiecsjs are summarized here. Detailed historical review notes live in Git history; this file keeps current release context compact.

## [Unreleased]

## [0.5.9] - 2026-06-29

- Fixed: `forEachEntity` / `forEachEntityIndexed` no longer cache the archetype's entity array, so an in-loop `createEntity`/`addComponent` that reallocates the iterated archetype can no longer yield `undefined` EntityIds or a bogus index `0`.
- Fixed: `resetWorld` now clears relation storage, so recycled entity slots no longer inherit stale relation edges/data.
- Docs: relation destroy is documented as `O(incoming)` (was stale `O(capacity)`).

## [0.5.8] - 2026-06-14

- Changed: exclusive-relation destroy cleanup now clears incoming edges in O(incoming) via a reverse index instead of scanning the full relation capacity per destroy. Behaviour is unchanged; large sparse relation tables no longer pay a per-destroy capacity scan.
- Changed: reduced `noExplicitAny` lint warnings in source (154 to 140) with no behaviour change.
- Documentation-only slimming pass across README, stability notes, review backlog, and LLM context. Reactive query world-local indexing remains a deferred follow-up (design note in the review backlog).

## [0.5.7] - 2026-06-10

- Hardened serialization restore capacity and hostile snapshot handling.
- Fixed query iteration safety around archetype size changes.
- Clarified worker snapshot buffer types and runtime validation boundaries.
- Regenerated LLM context from the canonical docs.

## Older releases

- `0.5.6` through `0.5.1` focused on release hygiene, docs accuracy, ECS safety fixes, and family SLSA/provenance metadata.
- `0.5.0` aligned the package with the broader ai*js family release line.
- `0.4.x` added relations and declared the 1.0-track stability policy.
- `0.3.x` expanded serialization, worker/SAB helpers, command buffers, observers, and docs.
- `0.2.x` hardened entity/component correctness and security-sensitive registry behavior.
- `0.1.x` introduced the root world/entity/component/query API and TypedArray SoA storage.
