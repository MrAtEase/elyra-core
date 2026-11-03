export function createWhoamiFetchOptions(): RequestInit {
  return {
    credentials: "include",
    cache: "no-store",
  };
}
