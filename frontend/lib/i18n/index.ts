import { LANGUAGE_NATIVE_NAMES, TRANSLATIONS, type AppLanguageCode } from "./translations";

export { LANGUAGE_NATIVE_NAMES, TRANSLATIONS };
export type { AppLanguageCode };

export type AppLanguage = AppLanguageCode | "auto";

export const SUPPORTED_LANGUAGE_CODES: AppLanguageCode[] = Object.keys(TRANSLATIONS) as AppLanguageCode[];
export const DEFAULT_LANGUAGE_CODE: AppLanguageCode = "en";

const normalizeLanguageCode = (value?: string | null): AppLanguageCode | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const code = normalized.split(/[-_]/)[0];
  return SUPPORTED_LANGUAGE_CODES.includes(code as AppLanguageCode) ? (code as AppLanguageCode) : null;
};

export const resolveAppLanguageFromString = (value?: string | null): AppLanguage => {
  if (!value) return "auto";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "auto";
  if (normalized === "auto") {
    return "auto";
  }
  return normalizeLanguageCode(normalized) ?? "auto";
};

export const detectBrowserLanguageCode = (): AppLanguageCode => {
  if (typeof navigator === "undefined") {
    return DEFAULT_LANGUAGE_CODE;
  }
  const candidates = Array.from(
    new Set([...(navigator.languages ?? []), navigator.language])
  );
  for (const candidate of candidates) {
    const code = normalizeLanguageCode(candidate);
    if (code) {
      return code;
    }
  }
  return DEFAULT_LANGUAGE_CODE;
};

export const resolveAppLanguage = (selection: AppLanguage): AppLanguageCode =>
  selection === "auto" ? detectBrowserLanguageCode() : selection;
