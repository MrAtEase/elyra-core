# Phase 7 — Marketplace Foundations

## Ziel
- Marketplace-Readiness ohne UI Rewrite.
- UI bleibt manifest-driven.

## Contract Erweiterung
- `app_manifest.marketplace` ist optional und enthält:
  - `app_version`
  - `install_flow` (`none|oauth|api_key|manual`)
  - `pricing` (`free|subscription|usage`)
  - `permissions`
  - `docs_url`, `changelog_url`
  - `rating`, `review_count` (optional)

## Implementierung
- Zod Contract: `lib/orb-os/contracts/types.ts`
- JSON Schema: `lib/orb-os/contracts/schemas.ts`
- Beispielwerte: `lib/orb-os/contracts/examples.ts`

## Install Flow
- Installiert/Enabled bleibt über `installed_apps`.
- Permission/Scopes über `auth_requirements` + `integration_status`.
- Pricing-Metadaten rein deklarativ in Manifest; runtime billing separat.
