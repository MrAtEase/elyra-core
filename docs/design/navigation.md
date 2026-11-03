# Shell V2 Navigation

The new Shell V2 navigation is an OS‑like ecosystem that is gated behind `MIRA_SHELL_V2`, keeps the legacy shell untouched, and introduces the mental models of the **Rail** (app launcher), **Canvas** (focus area), **Inspector** (context), and **Workspace** (business/private context). Navigation always answers: *Where am I? What am I working on? In which workspace?*

## Rail Concept

The rail is now an icon-first launcher with grouped categories, label reveal on hover, and a subtle glow on the active item. Each column is rendered from the shared app registry metadata so the layout is modular and ready for 50+ integrations (Mail, WhatsApp, Slack, Calendar, Notion, Editor, etc.). Rail width is persisted, `⌘B` toggles visibility, and state is stored in `localStorage` via the layout engine so the experience feels like a windowed OS rather than a web panel.

## App Registry

`mira-app/os/appRegistry.js` defines the catalog of Shell V2 entries. Every app carries metadata such as `category`, `order`, and `supports` (inspector/search/commands) so the renderer can group icons visually, show the appropriate tooling, and prioritize future integrations without touching the module layer. The registry hooks into the existing `navRegistry` so legacy modules are still registered, but Shell V2 consumes the enriched entries to build the rail and the `⌘P` app switcher overlay. The overlay is rendered as a frosted glass card in Holo and a crisp panel in Classic, keeping the canvas focused on the user’s input.

## Workspace Awareness

The top of the rail now holds a lightweight workspace switcher with emoji + name, accent color, soft animation, and a context-aware dropdown. Workspaces (Private, Fish-Delish, Mira OS) are persisted in `localStorage`, update `document.body.dataset.workspace`, and close the inspector quietly when changed so the Module/Canvas stays visible while the Inspector resets. Each switch also writes `--workspace-accent` so the rail glow matches the active world.

## Classic vs. Holo Modes

Classic keeps flat icons, crisp typography, and no glow, while Holo layers in depth, icon glow, frosted overlays, and micro-motion on the rail/app switcher. Both modes share the same DOM structure and metadata; the experience differences come from conditional CSS selectors (`:root[data-theme="holo"]`) and ambient drop shadows, preserving scalability without duplicating markup.

## Scalability Notes

- Categorized metadata makes it trivial to add more integrations without touching layout code.
- The app switcher overlay filters the registry and caches focus, ready for future command palettes.
- Workspace awareness sits in a declarative component, so new workspace types can be added by extending the registry plus a row definition.
- The entire experience is flag-gated: Shell V2 initializes only when `MIRA_SHELL_V2` or the `?shell=v2` flag is present, leaving the legacy shell untouched.

## Verification Checklist

- [ ] Legacy Shell remains untouched unless `MIRA_SHELL_V2` is active.
- [ ] Shell V2 rail toggles with `⌘B` and remembers its collapsed state.
- [ ] App switcher opens with `⌘P`/`⌘⇧P`, lists filtered apps, and navigates on Enter.
- [ ] Workspace switcher animates, updates the accent, and closes the inspector on change.
- [ ] No new JavaScript errors appear when `MIRA_SHELL_V2` is enabled.
