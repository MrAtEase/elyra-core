import { signInternalRequest } from "./internalSigner";

const truncate = (s: string, n = 2048) => (s.length <= n ? s : `${s.slice(0, n)}…`);

export async function fetchEmailIo(
  env: any,
  init: {
    path: string; // "/imap/threads" etc
    method: string;
    query?: Record<string, string | undefined>;
    body?: any;
  }
): Promise<{ status: number; text: string; contentType: string }> {
  const base = (env.EMAIL_IO_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("EMAIL_IO_BASE_URL missing in worker env");

  const url = new URL(init.path.startsWith("/") ? init.path : `/${init.path}`, base);
  Object.entries(init.query ?? {}).forEach(([k, v]) => {
    if (v === undefined) return;
    url.searchParams.set(k, v);
  });

  const method = init.method.toUpperCase();
  const bodyString = method === "GET" || method === "HEAD" ? "" : JSON.stringify(init.body ?? {});
  const pathWithQuery = `${url.pathname}${url.search}`;

  const signed = await signInternalRequest({
    env: { INTERNAL_API_KEY: env.INTERNAL_API_KEY, INTERNAL_API_SECRET: env.INTERNAL_API_SECRET },
    method,
    pathWithQuery,
    bodyString,
  });

  const headers = new Headers({
    "content-type": "application/json",
    ...signed,
  });

  const res = await fetch(url.toString(), { method, headers, body: bodyString ? bodyString : undefined });

  const text = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type") ?? "application/json";

  if (!res.ok) {
    console.error("[email-io] upstream failed", {
      status: res.status,
      pathWithQuery,
      body: truncate(text),
    });
  }

  return { status: res.status, text, contentType };
}
