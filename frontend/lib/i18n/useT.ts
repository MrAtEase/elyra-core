"use client";

import { useCallback } from "react";

import { TRANSLATIONS, DEFAULT_LANGUAGE_CODE } from "./index";
import { useLocale } from "@/components/providers/LocaleProvider";

const ENGLISH_DICTIONARY = TRANSLATIONS["en"];
const missingKeys = new Set<string>();

const prettifyKey = (key: string) => {
  const lastSegment = key.split(".").pop() ?? key;
  const words = lastSegment
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ");
  if (!words) {
    return "—";
  }
  const normalized = words.split(" ").map((word, index) => {
    if (!word) return "";
    if (index === 0) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  });
  return normalized.join(" ").trim() || "—";
};

const logMissingKey = (key: string, language: string) => {
  if (process.env.NODE_ENV === "production" || missingKeys.has(key)) {
    return;
  }
  missingKeys.add(key);
  console.warn(`[i18n] missing translation for "${key}" (${language})`);
};

export function useT() {
  const { resolvedLanguage } = useLocale();

  return useCallback(
    (key: string) => {
      const dictionary =
        TRANSLATIONS[resolvedLanguage] ??
        TRANSLATIONS[DEFAULT_LANGUAGE_CODE] ??
        ENGLISH_DICTIONARY;
      if (dictionary && key in dictionary) {
        return dictionary[key as keyof typeof dictionary] as string;
      }
      logMissingKey(key, resolvedLanguage);
      const englishFallback = ENGLISH_DICTIONARY[key as keyof typeof ENGLISH_DICTIONARY];
      if (englishFallback) {
        return englishFallback;
      }
      return prettifyKey(key);
    },
    [resolvedLanguage]
  );
}
