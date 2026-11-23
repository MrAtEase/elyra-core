import { getApiOrigin } from "@/lib/env";
import { createHash, createHmac, randomUUID } from "crypto";

export class WorkerProxyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "WorkerProxyError";
  }
}

function workerOsUrl(path: string): string {
  const base = getApiOrigin().replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

function resolveProxySecret(): string {
  return (process.env.ASSISTANT_OS_PROXY_SECRET ?? process.env.INTERNAL_API_SECRET ?? "").trim();
}

function requiresProxySigning(): boolean {
  return process.env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE === "1";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function attachProxySignature(
  headers: Headers,
  method: "GET" | "POST",
  path: string,
  bodyString: string,
): void {
  const secret = resolveProxySecret();
  if (!secret) {
    if (requiresProxySigning()) {
      throw new WorkerProxyError(
        "Worker proxy signing required but ASSISTANT_OS_PROXY_SECRET is missing",
        500,
        { ok: false, error_code: "PROXY_SIGNING_MISCONFIGURED", degraded_mode: true, local_execution_allowed: false },
      );
    }
    return;
  }

  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const bodyHash = sha256Hex(bodyString);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("base64");

  headers.set("x-elyra-proxy-ts", timestamp);
  headers.set("x-elyra-proxy-nonce", nonce);
  headers.set("x-elyra-proxy-signature", signature);
}

export async function forwardToWorkerOs(input: {
  path: string;
  method: "GET" | "POST";
  cookieHeader?: string | null;
  authorizationHeader?: string | null;
  body?: Record<string, unknown>;
}) {
  const headers = new Headers();
  if (input.cookieHeader) headers.set("cookie", input.cookieHeader);
  if (input.authorizationHeader) headers.set("authorization", input.authorizationHeader);
  const bodyString = input.body ? JSON.stringify(input.body) : "";
  if (bodyString) headers.set("content-type", "application/json");
  attachProxySignature(headers, input.method, input.path, bodyString);

  let response: Response;
  try {
    const requestInit: RequestInit = {
      method: input.method,
      headers,
      cache: "no-store",
    };
    if (input.body) {
      requestInit.body = bodyString;
    }

    response = await fetch(workerOsUrl(input.path), requestInit);
  } catch {
    throw new WorkerProxyError("Worker backbone unavailable", 503, {
      ok: false,
      error_code: "BACKBONE_UNAVAILABLE",
      message: "Degraded mode active. Worker backbone unavailable.",
      degraded_mode: true,
      local_execution_allowed: false,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WorkerProxyError("Worker backbone request failed", response.status, payload);
  }

  return payload;
}

export function isWorkerBackboneMode(): boolean {
  return process.env.ELYRA_USE_WORKER_BACKBONE === "1";
}
