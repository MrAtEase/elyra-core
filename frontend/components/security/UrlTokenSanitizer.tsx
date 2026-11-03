"use client";

import { useEffect } from "react";

const SENSITIVE_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "token_type",
  "expires_in",
  "expires_at",
];

export default function UrlTokenSanitizer() {
  useEffect(() => {
    const current = new URL(window.location.href);
    const hashRaw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(hashRaw);
    let changed = false;

    for (const key of SENSITIVE_KEYS) {
      if (current.searchParams.has(key)) {
        current.searchParams.delete(key);
        changed = true;
      }
      if (hashParams.has(key)) {
        hashParams.delete(key);
        changed = true;
      }
    }

    if (!changed) return;
    const cleanedHash = hashParams.toString();
    const nextUrl = `${current.pathname}${current.search}${cleanedHash ? `#${cleanedHash}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  return null;
}
