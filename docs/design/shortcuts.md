# Shell V2 Shortcuts

## Overview
- `⌘B` (macOS) / `Ctrl+B` (Windows/Linux) toggles the left navigation rail between icons-only and expanded widths.
- `⌘I` / `Ctrl+I` toggles the inspector column (context) on and off.
- `Esc` closes the inspector if it is visible and focus is not inside an editable field.

## Constraints
- Shortcuts are active only when Shell V2 is enabled (`MIRA_SHELL_V2=1`, `?shell=v2`, or `localStorage.mira.shell === "v2"`).
- Keyboard handlers ignore inputs, textareas, selects, and contenteditable regions to avoid stealing typing focus.

## Verification
1. Enable Shell V2 (set the flag or append `?shell=v2` in the URL) and confirm `⌘B` collapses/expands the rail without breaking layout.
2. Press `⌘I` to open the inspector, then `Esc` to close it; the inspector should slide in/out smoothly and stay off in `classic` mode if no context is present.
3. Trigger the shortcuts while the focus is inside a text input—nothing should happen.
4. Toggle between classic and holo themes (`new theme menu button → Classic · Light / Dark / Holo · Dark`) while the shortcuts are running to ensure there are no extra `JS` errors.
