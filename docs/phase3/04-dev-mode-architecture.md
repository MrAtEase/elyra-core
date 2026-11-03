# Phase 3 Dev Mode Architecture (Concept Only)

## Option A: MERLIN controls local filesystem via a secure bridge
- **Flow**: MERLIN runs as a local agent (Node process) that exposes a controlled filesystem API; developer actions (open file, edit fragment) are gated through signed intents.
- **Pros**: Single-entrypoint for automation; MERLIN can orchestrate across workspaces without needing external editors; easier to log/undo operations.
- **Cons**: Harder to integrate with existing editors; requires strict sandboxing (no arbitrary `rm`) and explicit opt-in per workspace.
- **Security**: Only allow read/write to workspace root via ACLs; operations require short-lived tokens minted by VS Code or CLI; every operation is audited and reversible. For paid gating, limit per-file operations until account is validated.
- **Feasibility**: Short-term we can expose a readonly bridge for data discovery; full edit control should wait until we have secure auth (maybe after MVP). Paid gating can be enforced via a feature flag that denies write-access until unlocked.

## Option B: VS Code integration (MERLIN orchestrates, VS Code stays editor)
- **Flow**: VS Code extension (currently `merlin-vscode`) mediates between MERLIN intents and editor actions via commands/webview.
- **Pros**: Leverages existing editor controls; user retains full session; easier to integrate with VS Code APIs; better for asynchronous approvals.
- **Cons**: Extension lifecycle (install/update) adds friction; bridging to other editors requires additional adapters.
- **Security**: Extension prompts for confirmation before executing MERLIN instructions; workspace trust must be established; instrumentation logs operations to `tooling/merlin-vscode` telemetry.
- **Feasibility**: Already partially implemented (`merlin-vscode/`); short-term we can enhance the extension with opt-in gating and permission dialogs; long-term we can extend to JetBrains or other editors.

## Permissions model & paid feature gating
- **Explicit opt-in**: Every MAJOR capability (filesystem write, workspace creation, cross-workspace sync) triggers a consent modal; tokens expire after a short TTL and require user-replay.
- **Paid gating readiness**: Track usage via `MERLIN_FEATURE_*` flags in worker config; until paid tier is subscribed, disable Option A write controls and limit Option B commands to read-only or guidance-only operations.
- **Security implications**: Always sign requests with workspace-private keys; ensure MERLIN does not leak credentials by sanitizing logs and requiring `MERLIN_ACTION_APPROVED` headers for privileged operations.
- **Short-term vs later**: Immediate focus on Option B enhancements (VS Code bridging) because the extension already exists; postpone Option A full control until after establishing a secure local agent (maybe leveraging `autopilot` snapshots for rollback).
