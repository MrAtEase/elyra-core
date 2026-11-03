import {
  DEFAULT_DARK_THEME_KEY,
  DEFAULT_LIGHT_THEME_KEY,
  DEFAULT_THEME_KEY,
  THEME_REGISTRY,
  getDefaultThemeForMode,
  isThemeKey,
  type ThemeDescriptor,
  type ThemeGroup,
  type ThemeKey,
} from "@/lib/theme/themeRegistry";

export {
  DEFAULT_DARK_THEME_KEY,
  DEFAULT_LIGHT_THEME_KEY,
  DEFAULT_THEME_KEY,
  THEME_REGISTRY,
  getDefaultThemeForMode,
  isThemeKey,
  type ThemeDescriptor,
  type ThemeGroup,
  type ThemeKey,
};

const THEME_LOOKUP = new Map(THEME_REGISTRY.map((theme) => [theme.key, theme]));
const THEME_ALIASES: Record<string, ThemeKey> = {
  light: "light-crisp",
  dark: "cyber",
  "cyber-dream": "cyber",
  "ethereal-violet": "violet",
  "ocean-depths": "ocean",
};

export function normalizeThemeKey(value: unknown): ThemeKey {
  if (typeof value !== "string") {
    return DEFAULT_THEME_KEY;
  }
  const normalized = value.trim().toLowerCase();
  const resolved = THEME_ALIASES[normalized] ?? normalized;
  if (isThemeKey(resolved)) {
    return resolved;
  }
  return DEFAULT_THEME_KEY;
}

export function getThemeGroup(theme: ThemeKey): ThemeGroup {
  return THEME_LOOKUP.get(theme)?.group ?? "dark";
}

export function getThemeName(theme: ThemeKey): string {
  return THEME_LOOKUP.get(theme)?.name ?? "Classic";
}
