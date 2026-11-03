# English-Only Enforcement Checklist - mira-stack

This document lists all files containing German text that need to be translated to English. **Do NOT change logic. Only update comments, documentation, and user-facing strings.**

## Documentation Files

### `README.md` (Root)
**Location:** `/Users/paulodak/Projects/mira-stack/README.md`

**German Text Found:**
- Line 43: `stellt ... bereit` → "provides"
- Line 44: `ruft ... auf` → "calls"
- Line 45: `baut ... auf` → "builds"
- Line 48: `speichert` → "saves"
- Line 50: `reicht ... durch` → "passes through"
- Line 52: `rendert` → "renders"
- Line 58: `fällt ... zurück` → "falls back"
- Line 60: `stellt sicher` → "ensures"
- Line 61: `bleibt` → "remains"
- Line 67: `scrollt` → "scrolls"
- Line 69: `scrollen` → "scroll"

**Action Required:**
- Translate Phase 4 Email Intelligence OS section (lines 43-72) to English
- Update all German technical terms to English equivalents

### `docs/integrations-google-backbone.md`
**Location:** `/Users/paulodak/Projects/mira-stack/docs/integrations-google-backbone.md`

**German Text Found:**
- Line 3: `Übersicht` → "Overview"
- Line 5: `Implementierung` → "Implementation"
- Line 11: `Erzeugt` → "Creates"
- Line 11: `Validiert` → "Validates"
- Line 15: `Tauscht` → "Exchanges"
- Line 16: `Speichert` → "Stores"
- Line 16: `Erstellt` → "Creates"
- Line 20: `Storage Key Format` (mixed English/German context)
- Line 22: `prüft` → "checks"
- Line 22: `erneuert automatisch` → "automatically refreshes"
- Line 23: `gebunden` → "bound"
- Line 26: `Gibt ... zurück` → "Returns"
- Line 27: `Startet` → "Starts"
- Line 28: `Löscht` → "Deletes"
- Line 28: `setzt ... auf` → "sets ... to"
- Line 31: `Automatische Erstellung` → "Automatic creation"
- Line 39: `Neue Sektion` → "New section"
- Line 42: `öffnet` → "opens"
- Line 44: `löscht` → "deletes"
- Line 45: `Automatisches Status-Refresh` → "Automatic status refresh"
- Line 52: `z.B.` → "e.g."
- Line 57: `Gehe zu` → "Go to"
- Line 58: `Erstelle` → "Create"
- Line 59: `Füge ... hinzu` → "Add"
- Line 63: `Öffne` → "Open"
- Line 64: `Navigiere zu` → "Navigate to"
- Line 65: `Scrolle zu` → "Scroll to"
- Line 66: `Klicke` → "Click"
- Line 67: `Folge` → "Follow"
- Line 190: `schlägt fehl` → "fails"
- Line 191-207: Multiple `Prüfe` → "Check" instances
- Line 195: `werden nicht gespeichert` → "are not stored"
- Line 196: `ist konfiguriert` → "is configured"
- Line 197: `hat` → "has"
- Line 198: `Zugriff auf` → "access to"
- Line 201: `existieren` → "exist"
- Line 202: `stimmt überein` → "matches"
- Line 206: `wurden ... angefordert` → "were requested"
- Line 213: `Erweiterte` → "Advanced"
- Line 214: `Integration-Test-Funktionen` → "Integration test functions"
- Line 215: `Views` (keep, but context may need translation)
- Line 221: `Neue` → "New"
- Line 223: `Neuer Endpoint` → "New endpoint"
- Line 224: `Erweiterte` → "Extended"
- Line 227: `Neue Sektion` → "New section"
- Line 235: `Scrolle zu` → "Scroll to"
- Line 238: `Klicke` → "Click"
- Line 239: `Prüfe Redirect zu` → "Check redirect to"
- Line 240: `Autorisiere` → "Authorize"
- Line 241: `Prüfe Redirect zurück zu` → "Check redirect back to"
- Line 248: `gibt korrekten Status zurück` → "returns correct status"
- Line 249: `startet OAuth-Flow` → "starts OAuth flow"
- Line 250: `erzeugt korrekte OAuth URL` → "creates correct OAuth URL"
- Line 251: `speichert Tokens korrekt` → "stores tokens correctly"
- Line 252: `löscht Tokens` → "deletes tokens"

**Action Required:**
- Translate entire document from German to English
- Maintain technical accuracy and structure
- Update all code examples and API documentation to English

## Code Files

### No German text found in code files
All code files in `mira-stack` appear to be in English. Only documentation files contain German text.

## Summary

**Total Files Requiring Translation:** 2
- `README.md` (root) - Phase 4 section
- `docs/integrations-google-backbone.md` - Entire document

**Priority:**
1. High: `docs/integrations-google-backbone.md` (technical documentation)
2. Medium: `README.md` (project overview)

**Notes:**
- Do NOT modify code logic
- Only translate comments, documentation, and user-facing strings
- Maintain technical accuracy
- Preserve code examples and API structure

