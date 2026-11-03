# Phase 4 — Edge Rail (Hover Task Switcher)

## Ziel
- Linke Edge Rail erscheint nur bei Hover am linken Bildschirmrand.
- Zeigt ausschließlich offene Surfaces/Apps (keine statischen Menüs).
- Unterstützt Switch, Reorder, Close, Badge-Status, Persistenz je Workspace.

## Open-Surface Model
- Source of truth: `windowsByWorkspace[workspace_id]`.
- Jedes offene Window ist ein Rail-Item.
- Rail enthält keine installierten/manifest Apps ohne geöffnetes Window.

## Interaktionen
- Hover left edge -> Rail sichtbar.
- Click Item -> fokusiert Window.
- Drag & Drop -> Reihenfolge ändern.
- Close Icon -> Window schließen.
- Reihenfolge wird in `localStorage` je `workspace_id` persistiert.

## Badge Regeln
- `run`: aktiver Run (`thinking` / `running`)
- `approval`: offene Approval Steps
- `error`: Run failed oder Session-Fehler
- `auth`: auth-abhängige App offen und Integration nicht connected

## Persistenz
- Key: `elyra:edge-rail-order:<workspace_id>`
- Inhalt: `string[]` mit Window-IDs

## Implementierte Dateien
- `components/os/shell/WindowDock.tsx`
- `lib/os/edgeRail.ts`
- `components/os/shell/WorkspaceOS.tsx`
