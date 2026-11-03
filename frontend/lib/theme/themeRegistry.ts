export type ThemeGroup = "light" | "dark";

// Future-ready keys: dark-aurora, light-sand, dark-oled.
export const THEME_KEYS = [
  "light-crisp",
  "light-classic",
  "dark-midnight",
  "dark-graphite",
  "cyber",
  "violet",
  "ocean",
  // ── Orb-matched themes ───────────────────────────────────────────────────
  "orb-cosmos",       // Elli Sphere — deep violet (dark)
  "elli-light",       // Elli Sphere — soft lavender (light)
  "pulse-dark",       // Dot Sphere  — teal-navy (dark)
  "orb-dawn",         // Dot Sphere  — teal-pearl (light)
  "ribbon-dark",      // legacy — kept for TS compat
  "ribbon-light",     // legacy — kept for TS compat
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

export type ThemeDescriptor = {
  key: ThemeKey;
  name: string;
  description: string;
  group: ThemeGroup;
  cssSelector: string;
  preview: {
    bg: string;
    panel: string;
    text: string;
    accentHint: string;
  };
};

export const DEFAULT_LIGHT_THEME_KEY: ThemeKey = "elli-light";
export const DEFAULT_DARK_THEME_KEY: ThemeKey = "orb-cosmos";
export const DEFAULT_THEME_KEY: ThemeKey = DEFAULT_DARK_THEME_KEY;

// DEV: Add a theme in 2 steps.
// 1) Add an entry to THEME_REGISTRY + the worker ALLOWED_THEME_KEYS list.
// 2) Add a matching html[data-theme="new-key"] block in globals.css.
//
// UI only shows THEME_REGISTRY entries. Legacy keys (light-crisp etc.) remain
// in THEME_KEYS for TypeScript compat with old localStorage values / other files.
export const THEME_REGISTRY: ThemeDescriptor[] = [
  // ── Elli (OrganicSphere) ────────────────────────────────────────────────
  {
    key: "orb-cosmos",
    name: "Elli Dark",
    description: "Deep violet with Elli's organic fluid sphere.",
    group: "dark",
    cssSelector: 'html[data-theme="orb-cosmos"]',
    preview: {
      bg: "#0a0b1e",
      panel: "#13142d",
      text: "#e8e6f5",
      accentHint: "#a78bfa",
    },
  },
  {
    key: "elli-light",
    name: "Elli Light",
    description: "Soft lavender with Elli's organic fluid sphere.",
    group: "light",
    cssSelector: 'html[data-theme="elli-light"]',
    preview: {
      bg: "#f5f3ff",
      panel: "#ffffff",
      text: "#2d2840",
      accentHint: "#8b5cf6",
    },
  },
  // ── Pulse (Dot Sphere) ──────────────────────────────────────────────────
  {
    key: "pulse-dark",
    name: "Pulse Dark",
    description: "Deep teal-navy with animated dot sphere.",
    group: "dark",
    cssSelector: 'html[data-theme="pulse-dark"]',
    preview: {
      bg: "#0a1520",
      panel: "#111d2b",
      text: "#e0eef5",
      accentHint: "#22d3ee",
    },
  },
  {
    key: "orb-dawn",
    name: "Pulse Light",
    description: "Teal-pearl light theme with animated dot sphere.",
    group: "light",
    cssSelector: 'html[data-theme="orb-dawn"]',
    preview: {
      bg: "#f0fdfa",
      panel: "#ffffff",
      text: "#1a2f3a",
      accentHint: "#0891b2",
    },
  },
];

const THEME_KEY_SET = new Set(THEME_KEYS);

export const isThemeKey = (value: unknown): value is ThemeKey =>
  typeof value === "string" && THEME_KEY_SET.has(value as ThemeKey);

export const getDefaultThemeForMode = (_mode?: string | null): ThemeKey => DEFAULT_DARK_THEME_KEY;
