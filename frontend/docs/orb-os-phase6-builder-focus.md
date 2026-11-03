# Phase 6 — Builder (Cursor/VSCode Focus)

## Zielbild
- Builder Surface mit Focus Mode:
  - Monaco Editor
  - File Tree
  - Tabs
  - Diff Viewer
  - Elli Panel (Plan / Toolcalls / Artifacts)

## Tooling Contract
- Definiert in `lib/orb-os/tools/schemas.ts`:
  - `builder.readFile`
  - `builder.searchInFiles`
  - `builder.applyPatch`
  - `builder.writeFile`
  - `builder.createFile`

## Approval
- Destructive/Writes via Policy-Engine gatebar.
- `applyPatch` und `writeFile` können approval-required sein.

## Minimal Project Model
- Project: id, workspace_id, root_path, repo_url(optional), created_at.
- Builder Session: id, workspace_id, project_id, active_branch, opened_files[], active_file.
- Builder Artifact: patch_set, diff preview, rollback ref.
