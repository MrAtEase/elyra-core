# Elli Shell Gate Decisions (Locked)

Date: 2026-02-08

## Gate 0.1 Domain model
Decision: same-domain app routing under a canonical `/w` namespace.
Canonical base URL env key: `NEXT_PUBLIC_APP_ORIGIN`.
Rule: public routes are `/`, `/product`, `/how-it-works`, `/pricing`, `/legal/privacy`, `/legal/terms`; authenticated shell routes are under `/w`.
Legacy `/workspace/*` is redirect-only.

## Gate 0.2 AISurface dimming
Decision: no page-wide dimming backdrop for AISurface.
Reason: preserve tool context visibility and avoid marketing visual side effects.
Rule: shell panel can use local panel chrome only; no full-viewport dim overlay.

## Gate 0.3 Theme preference
Decision: dark-only now; theme preference is future placeholder.
Rule: no light surfaces, no UI light toggle, no active light theme path.

## Gate 0.4 Confirmation input semantics
Decision: structured confirmation event only.
Accepted confirmation sources:
- Action card confirm button click.
- Explicit text confirmation parsed as `yes`/`ja` in confirmed pending-action context.
All mutation endpoints require a stored confirmation event id.
