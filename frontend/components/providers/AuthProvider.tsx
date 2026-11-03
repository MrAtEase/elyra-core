"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export type AuthSnapshot = {
  sessionCookiePresent: boolean;
};

const AuthContext = createContext<AuthSnapshot>({ sessionCookiePresent: false });

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.cookie.split(";").some((entry) => entry.trim().startsWith("mf-s="));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthSnapshot>(() => ({ sessionCookiePresent: hasSessionCookie() }), []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSnapshot() {
  return useContext(AuthContext);
}
