# Google Integration State Machine

This document defines the canonical UI state machine for Google integration in Elyra Core.

## Source of Truth
- State is read from `GET /api/google/status`.
- URL flags (for example `google_connected=1`) are never treated as truth values.
- UI components (header badge, dashboard cards, app actions) must use the same backend state.

## States
- `connected`
- `needs_auth`
- `needs_scope`
- `degraded`
- `policy_blocked`
- `error`

## Transition Rules
- `connected`
- Conditions: token exists and required scopes are present.
- UI: Connected badge, actions enabled.

- `needs_auth`
- Conditions: missing/expired token, token refresh failure, or no integration for required provider.
- UI: Reconnect CTA, write/read actions requiring Google disabled.

- `needs_scope`
- Conditions: token exists but required scopes are incomplete.
- UI: Reconnect CTA with required scope list.

- `degraded`
- Conditions: provider/API is partially unavailable but auth is still valid.
- UI: read-only fallback where possible, retry affordance.

- `policy_blocked`
- Conditions: workspace policy denies the integration or specific tool execution.
- UI: blocked badge and no execution CTA.

- `error`
- Conditions: unexpected backend failure.
- UI: non-destructive error banner and retry.

## OAuth Callback Behavior
- Callback success redirects to app without forcing display state.
- Client triggers status refetch and invalidates cached integration queries.
- Callback errors are surfaced via `google_error` only.
