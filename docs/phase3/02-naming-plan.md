# Phase 3 Naming Normalization Plan

| Old | Proposed New | Reasoning |
| --- | --- | --- |
| `fishdelish-stack-main` (repo) | `mira-stack` | Reflects mira.os platform; keeps history but removes customer-specific language. |
| `worker/` | `merlin-api/` | Explicitly names the Cloudflare Worker that powers MERLIN; avoids generic "worker" term. |
| `services/api-gateway/` | `platform-gateway/` | Highlights that shared services route cross-workspace assistant data, not just Fish Delish. |
| `mira-app/` | `merlin-shell/` | Clarifies that this folder hosts the MERLIN UI shell; decouples from legacy MIRA branding while still hinting at the holographic environment. |
| `fish-delish-site/` | `workspaces/fish-delish-site/` | Nested under `workspaces/` to signal customer scope; keeps marketing assets co-located. |
| `merlin-vscode/` | `tooling/merlin-vscode` or `integrations/vscode-bridge` | Groups dev tooling; makes it easier to add other MERLIN integrations later. |
| `mira-os/` | `platform-core/` (or keep `mira-os` once brand finalised) | Central platform components should sit under a brand-agnostic namespace such as `platform-core/` until `mira.os` is official. |
| `.autopilot-backup/` | `tooling/backups/autopilot` | Organizes autosaves as tooling artifacts, not root clutter. |
| DNS `elyra-core.app` | `mira.os` (primary domain) with `fish-delish.mira.os` for that workspace | Establishes mira.os as the brand; fish-delish becomes a workspace subdomain. |
| `mira-assistant.elyra-core.app` | `merlin.mira.os` (M.E.R.L.I.N shell) | Aligns assistant domain with new brand and explicit assistant name. |
| `app.elyra-core.app` | `workspaces/fish-delish.mira.os` | Maps workspace entry point to the workspace scoped subdomain. |
| `api.elyra-core.app` | `api.mira.os` (backend) | Keeps Worker origin platform-level with workspace-specific access controls. |

**Status / current mapping:** After the Phase 5 rename, the repo now hosts the shell in `mira-app/`, so every file, workflow, and build step today points at that directory even though Phase 3 still references the future `merlin-shell/` name. Treat the `merlin-shell/` references above as aspirational and keep documentation/automation aligned with the real `mira-app/` path until the next rename is ready to roll through Cloudflare and the broader stack.

The goal is to keep descriptive names while avoiding product-tied language at the root so that future workspaces (e.g., `mira-os`, `personal`, etc.) slot into the same structure without conflicts.
