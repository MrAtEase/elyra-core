export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const GOOGLE_API_TIMEOUT_MS = 10_000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: unknown }).name === "AbortError"
  );
}

function normalizeGoogleErrorMessage(payload: unknown, fallback: string): {
  message: string;
  code: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { message: fallback, code: null };
  }

  const root = payload as Record<string, unknown>;
  const nested = root.error as
    | { message?: unknown; status?: unknown; code?: unknown }
    | undefined;

  const message =
    (typeof nested?.message === "string" && nested.message) ||
    (typeof root.message === "string" && root.message) ||
    fallback;

  const code =
    (typeof nested?.status === "string" && nested.status) ||
    (typeof root.error === "string" && root.error) ||
    null;

  return { message, code };
}

export async function googleApiFetch<T>(
  url: string | URL,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), GOOGLE_API_TIMEOUT_MS);

  const abortHandler = () => timeoutController.abort();
  if (init?.signal) {
    if (init.signal.aborted) {
      timeoutController.abort();
    } else {
      init.signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...init,
      headers,
      cache: "no-store",
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new GoogleApiError(
        `Google API request timed out after ${GOOGLE_API_TIMEOUT_MS}ms`,
        504,
        "timeout"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (init?.signal) {
      init.signal.removeEventListener("abort", abortHandler);
    }
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const normalized = normalizeGoogleErrorMessage(
      payload,
      `Google API request failed (${response.status})`
    );
    throw new GoogleApiError(normalized.message, response.status, normalized.code);
  }

  return payload as T;
}
