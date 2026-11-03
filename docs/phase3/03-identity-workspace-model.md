# Phase 3 Identity & Workspace Model

## Conceptual diagram (textual)

```
Paul (human identity)
├── Workspace: personal ⟶ owns personal calendar, email, tasks
├── Workspace: fish-delish ⟶ owns workspace calendar, shared docs, drive assets scoped to the Fish Delish customer
└── Workspace: mira-os (platform) ⟶ owns shared infrastructure, documentation, tooling insights

MERLIN (assistant) ↔ orchestrates across all workspaces
```

## Identity → Workspace → Task ownership rules

1. **Paul** is the single identity with credentials, OAuth tokens, and identity graph.
2. **Workspace: personal** serves private life data; MERLIN only surfaces personal insights when explicitly tied to the `personal` workspace context.
3. **Workspace: fish-delish** is the customer workspace; any action labeled with `workspaceId=ws-default` stays bounded within marketing/demo data unless the workspace owner explicitly grants cross-workspace view.
4. **Workspace: mira-os** contains platform-level artifacts (shared docs, onboarding materials, operational data). MERLIN uses this context to inform support engineers and cross-customer diagnostics.
5. When MERLIN executes a task, it attaches a workspace tag; tasks default to the workspace that triggered the interaction unless Paul cross-links them manually.
6. Identity boundary enforcement: MERLIN must not surface `personal` workspace artifacts (emails, docs) unless the current workspace is `personal`. Similarly, Fish Delish artifacts remain within `fish-delish` unless promoted via explicit sharing.

## What MERLIN sees vs workspace-specific views

- **MERLIN** has visibility into all three workspaces by default but filters outputs based on the active workspace context; e.g., when in `fish-delish` mode, MERLIN uses workspace-specific API keys and presents that workspace first.
- **Personal workspace** sees only personal calendar/email data, plus the ability to ask MERLIN for cross-workspace summaries when permitted.
- **Fish Delish workspace** sees customer-branded dashboards, files, and marketing assets; MERLIN surfaces workspace-specific prompts and keeps audits scoped to this workspace.
- **Mira.os platform workspace** is used for tooling, architecture docs, and the workspace management console; MERLIN can surface platform-level alerts here without leaking customer data.
