# UI Smoke Checklist

1. **Overlay stack closure** – Open the Orb, App Launcher, Identity Menu, keyboard shortcuts, and Settings panels; click the desktop canvas and hit Esc to confirm only the topmost layer closes and nothing stays stuck. Backdrops should only close via their own buttons/links.
2. **Intent router guardrails** – Ask "Wie wird das Wetter morgen?" and verify the assistant prompts for a location (no Files window opens) and a backend run uses the Weather tool when configured; the fallback message about enabling the Weather/Web tool should appear if the tool is disabled.
3. **Settings persistence** – In Settings > System choose a theme/language, then switch workspaces or refresh. The choices and AI settings (fast/deep model, graph memory, budget) should survive reloads thanks to `localStorage` per workspace.
4. **Integrations & billing** – Navigate to Integrations and Billing; verify the Google status badge, connect/disconnect flows, and that billing management is disabled with its tooltip during this phase.
5. **Workspace controls** – Visit Workspace Profile, Members & Roles, and Platform Admin sections to confirm placeholder data renders, the invite button is visibly disabled, and Identity Menu quick links navigate to the correct sections before closing the menu.
