# Elyra Frontend Coder Contract

This repository is operated by Elyra's coding agent and the embedded Code-OSS surface.

## Primary Rules

- Work read-first before editing.
- Prefer scoped edits to one file or a small verified allowlist.
- Keep visual changes aligned with existing Elyra UI tokens and component patterns.
- Do not change unrelated files to satisfy linting or formatting unless explicitly required by the task.
- Treat `.run/playground` as the publish target for playground runs; source changes should not bypass verification.

## Verification

- Run the smallest relevant verification step after edits.
- For Next.js production verification, prefer the stable webpack build path used by Elyra's gates.
- If verification fails, restore the checkpoint instead of leaving partial edits behind.

## UI Work

- Reuse existing CSS variables and design tokens before introducing hard-coded colors.
- Inspect related shell/layout components before changing a leaf component.
- Preserve accessibility and keyboard behavior when editing overlays, menus, launchers, or dialogs.

## Repo Context

- Main product shell lives under `components/os/shell`.
- Coding runtime routes live under `app/api/os/code`.
- Playground publish state is mirrored under `.run/playground/frontend`.
