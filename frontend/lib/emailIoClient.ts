import { createHmac, randomBytes, randomUUID } from "crypto";

/**
 * Derive a stable internal API key from TOKEN_ENCRYPTION_KEY when no explicit
 * INTERNAL_API_KEY is set (covers Vercel production without extra env vars).
 */
const derivedInternalKey = (): string => {
  const enc = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  return enc.length >= 16 ? enc.slice(0, 32) : "";
};

/**
 * Derive the email-io base URL:
 *  1. Explicit EMAIL_IO_BASE_URL (local dev: http://localhost:3001)
 *  2. NEXT_PUBLIC_APP_ORIGIN + /api/internal/email-io  (Vercel production)
 *  3. VERCEL_URL (deployment-specific fallback)
 */
const derivedEmailIoBaseUrl = (): string | undefined => {
  if (process.env.EMAIL_IO_BASE_URL) return process.env.EMAIL_IO_BASE_URL;
  // Vercel sets VERCEL=1 and VERCEL_URL for all deployments
  if (process.env.VERCEL === "1") {
    const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "";
    if (appOrigin && !appOrigin.includes("localhost")) {
      return `${appOrigin}/api/internal/email-io`;
    }
    // Fallback to deployment URL (e.g. elyra-core-abc123.vercel.app)
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) return `https://${vercelUrl}/api/internal/email-io`;
  }
  return undefined;
};

const getEmailIoEnv = () => {
  const baseUrl = derivedEmailIoBaseUrl();
  const derived = derivedInternalKey();
  const key =
    process.env.EMAIL_IO_INTERNAL_KEY ?? process.env.INTERNAL_API_KEY ?? derived;
  const secret = (
    process.env.EMAIL_IO_INTERNAL_SECRET ?? process.env.INTERNAL_API_SECRET ?? derived
  ).trim();
  return { baseUrl, key, secret };
};

const ensureEmailIoConfig = () => {
  const { baseUrl, key, secret } = getEmailIoEnv();
  if (!key) {
    throw new Error("INTERNAL_API_KEY (or EMAIL_IO_INTERNAL_KEY) is required for email I/O");
  }
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET (or EMAIL_IO_INTERNAL_SECRET) is required for email I/O");
  }
  if (!baseUrl) {
    throw new Error("EMAIL_IO_BASE_URL is required for email I/O operations");
  }
  return { baseUrl, key, secret };
};

const truncateLogValue = (value: string | null | undefined, maxLength = 2048) => {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
};

export const getEmailIoBaseUrl = () => ensureEmailIoConfig().baseUrl;

type EmailIoRequestContext = {
  provider?: string;
  reason?: string;
};

export type EmailIoRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | undefined | null>;
  body?: unknown;
  headers?: HeadersInit;
  context?: EmailIoRequestContext;
  request?: Request;
};

export async function buildEmailIoUrl(
  path: string,
  params?: Record<string, string | number | undefined | null>,
  baseUrl?: string
) {
  const resolvedBase = baseUrl ?? ensureEmailIoConfig().baseUrl;
  // Ensure base ends with "/" so URL constructor appends rather than replaces.
  // e.g. base="https://app.elyra-core.app/api/internal/email-io"  +  path="/icloud/folders"
  //   → new URL("/icloud/folders", base) = "https://app.elyra-core.app/icloud/folders"  ← WRONG
  //   → new URL("icloud/folders",  base + "/") = "…/api/internal/email-io/icloud/folders" ← correct
  const base = resolvedBase.endsWith("/") ? resolvedBase : `${resolvedBase}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  // Add trailing slash so next.config trailingSlash:true doesn't issue a 308 redirect
  // that converts POST → GET.
  const pathWithSlash = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
  const url = new URL(pathWithSlash, base);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url;
};

const generateNonce = () => {
  if (typeof randomUUID === "function") {
    return randomUUID();
  }
  return randomBytes(16).toString("hex");
};

const buildSignatureHeaders = (url: URL, method: string, body: string, secret: string) => {
  const pathWithQuery = `${url.pathname}${url.search}`;
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const canonical = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("base64");
  return { timestamp, nonce, signature };
};

const resolveProviderName = (options: EmailIoRequestOptions) => {
  if (options.context?.provider) {
    return options.context.provider;
  }
  const fromParams = options.params?.provider;
  if (typeof fromParams === "string") {
    return fromParams;
  }
  if (options.body && typeof options.body === "object" && "provider" in options.body) {
    const providerValue = (options.body as Record<string, unknown>).provider;
    if (typeof providerValue === "string") {
      return providerValue;
    }
  }
  return "unknown";
};

const resolveReason = (options: EmailIoRequestOptions, fallback: string) => {
  return options.context?.reason ?? fallback;
};

type EmailIoFailureDetails = {
  url: string;
  provider: string;
  reason: string;
  status?: number;
  error?: unknown;
  responseBody?: string | null;
};

const logEmailIoFailure = (details: EmailIoFailureDetails & { responseBody?: string | null }) => {
  console.error(`[email-io] ${details.reason}`, {
    baseUrl: getEmailIoEnv().baseUrl,
    targetUrl: details.url,
    provider: details.provider,
    status: details.status ?? null,
    responseBody: truncateLogValue(details.responseBody ?? null),
    error: details.error ?? null,
  });
};

export async function requestEmailIo<T>(path: string, options: EmailIoRequestOptions = {}) {
  const { baseUrl, key, secret } = ensureEmailIoConfig();
  const url = await buildEmailIoUrl(path, options.params, baseUrl);
  const method = (options.method ?? "GET").toUpperCase();
  const bodyString = options.body ? JSON.stringify(options.body) : "";
  const provider = resolveProviderName(options);
  const reason = resolveReason(options, path);
  const { timestamp, nonce, signature } = buildSignatureHeaders(url, method, bodyString, secret);
  const headers = new Headers({
    "content-type": "application/json",
    "x-internal-api-key": key,
    "x-internal-timestamp": timestamp,
    "x-internal-nonce": nonce,
    "x-internal-signature": signature,
  });
  if (options.headers) {
    new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  }
  const forwardedCookie =
    options.request?.headers?.get("cookie") ?? options.request?.headers?.get("Cookie");
  if (forwardedCookie && !headers.has("cookie")) {
    headers.set("cookie", forwardedCookie);
  }
  const forwardedAuthorization =
    options.request?.headers?.get("authorization") ?? options.request?.headers?.get("Authorization");
  if (forwardedAuthorization && !headers.has("authorization")) {
    headers.set("authorization", forwardedAuthorization);
  }
  const forwardedWorkspaceId = options.request?.headers?.get("x-workspace-id");
  if (forwardedWorkspaceId && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", forwardedWorkspaceId);
  }

  let response: Response;
  const hasBody = bodyString && method !== "GET" && method !== "HEAD";
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      ...(hasBody ? { body: bodyString } : {}),
    });
  } catch (error) {
    logEmailIoFailure({
      url: url.toString(),
      provider,
      reason,
      status: 503,
      error,
    });
    const message = `EMAIL_IO service unavailable at ${url.toString()}`;
    const networkError = new Error(message);
    (networkError as any).status = 503;
    (networkError as any).upstreamUrl = url.toString();
    (networkError as any).responseBody = null;
    throw networkError;
  }

  const responseText = await response.text();
  let payload: unknown = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const truncated = truncateLogValue(responseText);
    logEmailIoFailure({
      url: url.toString(),
      provider,
      reason,
      status: response.status,
      responseBody: truncated,
    });
    const rawMessage =
      (payload && typeof payload === "object" && "message" in payload && payload.message) ||
      (payload && typeof payload === "object" && "error" in payload && payload.error) ||
      response.statusText ||
      "Email I/O error";
    const message = typeof rawMessage === "string" ? rawMessage : String(rawMessage);
    const error = new Error(message);
    (error as any).status = response.status;
    (error as any).upstreamUrl = url.toString();
    (error as any).responseBody = truncateLogValue(responseText);
    throw error;
  }
  return payload as T;
}
