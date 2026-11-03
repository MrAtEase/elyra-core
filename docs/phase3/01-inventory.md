# Phase 3 Inventory & Classification

## Top-level folders with purpose labels

- `.github/` — Platform tooling (CI workflows) that target Pages/Worker build and deployment. **Category**: Platform core. ✅
- `.autopilot-backup/` — Historical snapshots (auto-saves). **Category**: Experimental/dev-only. Legacy name but not actively referenced. Keep.
- `.wrangler/` — Cloudflare tooling state; platform core support. Keep.
- `docs/` — Documentation (note: includes audit docs already referencing migration). Mixed but mostly Platform core + Product-specific notes. Keep under docs/phase3 for this work.
- `email-provider/` — Helper assets shared between Worker and MERLIN. **Category**: Platform core.
- `fish-delish-site/` — Next.js workspace app and marketing shell for the Fish Delish customer. **Category**: Product-specific (Fish Delish). Misleading when platform is `mira.os`. Should eventually be `workspaces/fish-delish` or similar.
- `merlin/` — Core assistant frameworks, likely platform-level (MERLIN). **Category**: Assistant (MERLIN core).
- `merlin-vscode/` — VS Code bridge tooling. **Category**: Experimental/tooling. Product agnostic but coupled to assistant name; rename to `tooling/merlin-vscode`.
- `mira-app/` — Static MIRA shell tied to MERLIN/marketing. **Category**: Assistant (MERLIN UI). Legacy name should be `merlin-shell` or `merlin-ui` under platform core.
- `mira-os/` — Emerging platform modules (clients, infra, docs). **Category**: Platform core. Sits well under mira.os naming.
- `node_modules/`, `fish-delish-site/node_modules/`, `merlin-vscode/node_modules/`, `worker/node_modules/` — Build artifacts; dev-only. Should stay git-ignored.
- `services/` — Shared backend helpers (API gateway); platform core.
- `tests/` — Platform tests (some MERLIN-specific); categorize as Platform core with MERLIN focus.
- `worker/` — Cloudflare Worker backend supporting API and OAuth. **Category**: Platform core.
- `mira-os/` subfolders (clients, infra, core, providers, tests, docs, dashboard, integrations, engines, services) represent platform building blocks; rename to follow `platform/` naming once mira.os brand lands.

## Identifications
- **Platform core**: `worker/`, `services/`, `mira-os/`, `merlin/`, `email-provider/`, `.github/`, `.wrangler/`, `docs/phase3`, `tests/`.
- **Fish Delish customer**: `fish-delish-site/` (workspace + marketing). Currently baked into root level names and ideally lives under `workspaces/` or `customers/fish-delish`.
- **Assistant (MERLIN)**: `mira-app/`, `merlin/`, `merlin-vscode/`, `mira-os/` (many modules reference MERLIN). Need clearer separation so assistant pages and helper apps reuse platform branding.
- **Experimental/dev-only**: `.autopilot-backup/`, `merlin-vscode/` (tooling), `tests/`, `docs/audit/` (analysis), `docs/phase3/` (planning). Node modules and `.next/` directories remain dev artifacts.

## Legacy / misleading names
- `fish-delish-site/` and repeated `fish-delish` strings are product-specific and should move under workspace/customer naming conventions so the repo remains platform-centric.
- `mira-app/` uses the product name “MIRA” for a single domain; rename to `merlin-shell/` or `mira-shell` but decoupled from `fish-delish` branding.
- `merlin-vscode/` sits at root but functions as tooling; consider grouping under `tooling/` or `integrations/` and ensure naming reflects its MERLIN role.
- `worker/` uses the generic “worker” name but powers the API for MERLIN; once M.E.R.L.I.N is the assistant, naming like `merlin-api/` clarifies ownership.
