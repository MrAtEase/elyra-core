# Phase 4 Naming Glossary

## Core terminology
- **M.E.R.L.I.N** – the assistant/orchestrator that sits behind every workspace. When we speak about actions, automations, or the persona that interacts with data, we refer to M.E.R.L.I.N. The Cloudflare Worker APIs and the MERLIN shell (currently `mira-assistant`) should emphasize this name.
- **MIRA OS** – the platform experience that brings together the MERLIN assistant, dashboards, workspace configuration, and orchestrated tooling. The holographic shell (`mira-assistant`) and the emerging `mira-os/` modules all contribute to MIRA OS.
- **Fish Delish** – one workspace/customer inside the platform. `fish-delish-site` and its marketing collateral represent the Fish Delish workspace, not the entire platform. Future workspaces (e.g., `personal`, `mira-os`, etc.) should sit alongside it.

## Naming guidance
- Prefer `merlin-` prefixes when naming assistant components (e.g., `merlin-shell`, `merlin-api`, `merlin-tooling`).
- Keep workspace-specific assets grouped under `workspaces/<name>` or `customers/<name>` so the root remains brand-agnostic.
- Use `mira-os` for platform-level infrastructure, docs, and dashboards; avoid letting customer names leak into the platform namespace.

## Validation command
- `git status -sb docs/phase4/01-names-glossary.md README.md`
