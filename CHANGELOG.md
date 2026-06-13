# Changelog

All notable changes to aiecsjs are summarized here. Detailed historical review notes live in Git history; this file keeps current release context compact.

## [Unreleased]

- Documentation-only slimming pass across README, stability notes, review backlog, and LLM context.
- Known follow-ups: reactive query indexing, relation cleanup cost, and lint warning reduction.

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
