# ADR 0014 — Deterministic diff before AI interpretation

**Status:** Accepted

## Context

The daily summary is the product's most trust-sensitive feature. An LLM reconstructing a day from current state will invent, omit and misattribute work. The source conversation explicitly warns against this but does not define the contract.

## Decision

- Compute a `DailyDiff` deterministically from `activity_events` for the user's local date.
- Persist the diff. Display it regardless of AI availability.
- Send the LLM **only** the diff JSON (plus project names and current date) with strict rules.
- Store the summary with the exact diff, model and prompt version; detect staleness via `source_event_seq`.
- Archive previous summaries on regeneration.

## Consequences

- The factual layer is testable with golden files and cannot hallucinate.
- The AI layer is optional and auditable ("which events did it see?").
- The diff's classification rules (created/updated/completed/removed precedence) become product semantics and must be documented.
- Events must be complete and well-formed; the event log becomes critical infrastructure.

## Alternatives rejected

- **LLM reads the database/state:** unbounded context, invented history, no audit trail.
- **LLM reads raw activity events:** noisy, token-expensive, harder to validate.
- **No AI summary:** safe but loses the reflection feature the user wants.
