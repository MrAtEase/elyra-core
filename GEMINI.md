# Elyra Core Gemini Coder Contract

This repository is operated by Elyra's coding agent with Gemini as the primary analysis and execution engine.

## Operating Mode

- Work read-first before editing.
- Prefer scoped edits to a small verified allowlist unless the task explicitly requires a repo-wide change.
- For whole-repository review tasks, stay evidence-based and prefer concrete repo findings over generic best-practice complaints.
- Do not report generic security findings just because local tooling uses shell execution or child_process. Only flag security issues when the repo evidence shows an externally reachable, insufficiently guarded, or production-exposed path.

## Repo Topology

- `frontend/` contains the Elyra OS shell, coding surface, and local runtime routes.
- `backend/ai-service/` is the structured Node backend and migration path for newer service logic.
- `worker/` contains the Cloudflare Worker runtime and legacy operational paths still in use.
- `api-gateway/` is legacy and should be treated as technical-debt context unless a task explicitly targets removal or migration.
- `email-io/` and other packages may carry older dependency versions; validate before changing shared tooling.

## Coding Runtime Rules

- Coding runtime routes live under `frontend/app/api/os/code`.
- Playground publishes to `.run/playground/frontend`.
- Do not bypass verification by editing `.run/playground` directly.
- For Next.js production verification, prefer the stable webpack path used by Elyra's gates.
- If verification fails, restore the checkpoint instead of leaving partial edits behind.

## Review Rules

- Whole-repo reviews should identify the highest-impact issues with concrete file evidence.
- Distinguish architecture debt, migration debt, operational risk, and actual exploitable security findings.
- Keep findings prioritized and actionable.
- If a repo-wide task is too large for one pass, reduce scope by package or subsystem and continue instead of forcing a single oversized pass.

## UI Work

- Reuse existing Elyra CSS variables and design tokens before introducing hard-coded values.
- Inspect related shell/layout components before changing a leaf component.
- Preserve accessibility and keyboard behavior for overlays, menus, launchers, dialogs, and window chrome.

## Refactor Rules

- Keep refactors incremental and verifiable.
- Avoid broad rename churn unless the task explicitly requests it.
- For monorepo-wide dependency or architecture work, update one layer at a time and validate each step.
