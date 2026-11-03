const LOCAL_AUTH_MODE = "local";

export function getAuthMode(): string {
  return (process.env.NEXT_PUBLIC_AUTH_MODE || "").trim().toLowerCase();
}

export function isLocalAuthMode(): boolean {
  return getAuthMode() === LOCAL_AUTH_MODE;
}

