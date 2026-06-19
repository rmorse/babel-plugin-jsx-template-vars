# Agent Plans Index

This folder contains active plans, completed planning history, and reviewer
notes. Use this index to avoid treating superseded material as current
implementation direction.

## Current Source Of Truth

- [store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md)
  - Active implementation plan for the next store-selector experiment stream.
  - Current direction: harden unsafe ambiguity, spike descriptor composition,
    prove same-file relative object-root path-polymorphism, then expand
    deliberately.
  - Component specialization is a conditional fallback, not the first
    implementation path.

## Current Research Background

- [store-selector-callsite-specialization-research.md](./store-selector-callsite-specialization-research.md)
  - Research background for multi-source path handling.
  - Revised after review to evaluate relative object-root context before
    specialization.

## Superseded Or Historical Review Notes

- [store-selector-callsite-specialization-research-review.md](./store-selector-callsite-specialization-research-review.md)
  - Superseded review of an earlier specialization-first version of the
    research document.
  - Kept for audit history only.
  - Do not use its specialization-first verdict as current direction.

- [store-selector-data-contract-review.md](./store-selector-data-contract-review.md)
  - Historical review notes for the store-selector data contract experiment.

- [store-selector-hierarchy-tracing-review.md](./store-selector-hierarchy-tracing-review.md)
  - Historical review notes for hierarchy tracing.

- [flat-template-vars-and-autodetection-review.md](./flat-template-vars-and-autodetection-review.md)
  - Historical review notes for flat template vars and autodetection.

## Completed Or Background Plans

- [flat-template-vars-and-autodetection.md](./flat-template-vars-and-autodetection.md)
  - Historical plan for the flat `templateVars` API and autodetection work.

- [store-selector-data-contract-experiment.md](./store-selector-data-contract-experiment.md)
  - Background research for the store-selector experiment.

- [store-selector-data-contract-implementation.md](./store-selector-data-contract-implementation.md)
  - Earlier implementation breakdown for the selector experiment.
  - Useful context, but not the source of truth for the multi-source path work.

- [store-selector-hierarchy-tracing.md](./store-selector-hierarchy-tracing.md)
  - Historical hierarchy-tracing plan.
  - Still useful for background and terminology, but newer multi-source path
    work should follow the current source-of-truth plan above.

## Maintenance Rule

When a new plan supersedes an older direction, add a status note to the older
document or update this index. Avoid deleting historical plans unless the file is
actively misleading and all useful context has been preserved elsewhere.
