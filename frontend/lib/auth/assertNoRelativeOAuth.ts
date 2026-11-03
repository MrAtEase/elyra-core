export function assertNoRelativeOAuth(url: string) {
  if (!url) return;
  if (url.startsWith("/assistant/oauth")) {
    throw new Error("[SECURITY] Relative OAuth start detected. Use NEXT_PUBLIC_ASSISTANT_API_BASE!");
  }
}
