# Documentation Index

Single navigation file for project docs.

## 1) Real project state (read first)

- [`capabilities-and-roadmap.md`](capabilities-and-roadmap.md) — current tools, limitations, roadmap.
- [`final-architecture.md`](final-architecture.md) — actual runtime architecture and active execution path.
- [`configuration.md`](configuration.md) — config behavior and runtime options.
- [`secret-handling.md`](secret-handling.md) — secrets policy and key handling.
- [`qa-test-plan.md`](qa-test-plan.md) — current manual smoke checks.
- [`release-checklist.md`](release-checklist.md) — pre-release process.

## 2) Operational support (open if needed)

- [`troubleshooting.md`](troubleshooting.md)
- [`runtime-diagnostics.md`](runtime-diagnostics.md)
- [`runtime-state-schema.md`](runtime-state-schema.md)
- [`repository-validation.md`](repository-validation.md)
- [`host-bridge-notes.md`](host-bridge-notes.md)
- [`prompt-library-architecture.md`](prompt-library-architecture.md)
- [`local-knowledge-base.md`](local-knowledge-base.md)

## 3) Development artifacts (not source of truth)

- `docs/dev-artifacts/` is reserved for temporary planning/research notes.
- Current shipped behavior is documented in `capabilities-and-roadmap.md` and `final-architecture.md`.

## 4) Historical archive (explicit request only)

- [`legacy-archive-on-user-request-only/README.md`](legacy-archive-on-user-request-only/README.md)
- [`legacy-archive-on-user-request-only/meta/removed-active-redirects-2026-04.md`](legacy-archive-on-user-request-only/meta/removed-active-redirects-2026-04.md)

## Rules for new docs

- If the doc describes shipped behavior: place in `docs/`.
- If the doc is planning/research/proposal: place in `docs/dev-artifacts/`.
- If the doc is deprecated history: place in `docs/legacy-archive-on-user-request-only/`.
