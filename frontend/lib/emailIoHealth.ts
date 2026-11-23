import { getEmailIoBaseUrl } from "@/lib/emailIoClient";

export type EmailIoHealthStatus = {
  ok: boolean;
  status?: number | null;
  detail: string;
  timestamp: number;
  url: string | null;
};

let healthCheckPromise: Promise<void> | null = null;
let lastHealthStatus: EmailIoHealthStatus | null = null;

function canRunHealthCheck(): boolean {
  const baseUrl = (process.env.EMAIL_IO_BASE_URL ?? "").trim();
  const key = (process.env.EMAIL_IO_INTERNAL_KEY ?? process.env.INTERNAL_API_KEY ?? "").trim();
  const secret = (process.env.EMAIL_IO_INTERNAL_SECRET ?? process.env.INTERNAL_API_SECRET ?? "").trim();
  return Boolean(baseUrl && key && secret);
}

const safeGetBaseUrl = (): string | null => {
  try {
    return getEmailIoBaseUrl();
  } catch {
    return null;
  }
};

const buildHealthUrl = (): string => {
  const base = getEmailIoBaseUrl();
  const normalized = base.replace(/\/+$/, "");
  return new URL("/health", normalized).toString();
};

async function performHealthRequest(signal?: AbortSignal): Promise<EmailIoHealthStatus> {
  const healthUrl = buildHealthUrl();
  const requestInit: RequestInit = {
    method: "HEAD",
    cache: "no-store",
  };
  if (signal) {
    requestInit.signal = signal;
  }
  const response = await fetch(healthUrl, requestInit);
  return {
    ok: response.ok,
    status: response.status,
    detail: response.statusText || "",
    timestamp: Date.now(),
    url: healthUrl,
  };
}

function startHealthCheck(signal?: AbortSignal) {
  healthCheckPromise = (async () => {
    if (!canRunHealthCheck()) {
      lastHealthStatus = {
        ok: false,
        status: null,
        detail: "Skipped: email-io health check disabled (missing EMAIL_IO_BASE_URL/INTERNAL_API_KEY/INTERNAL_API_SECRET).",
        timestamp: Date.now(),
        url: safeGetBaseUrl(),
      };
      return;
    }

    try {
      lastHealthStatus = await performHealthRequest(signal);
      console.info("[email-io] health check", lastHealthStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      lastHealthStatus = {
        ok: false,
        status: null,
        detail: message,
        timestamp: Date.now(),
        url: safeGetBaseUrl(),
      };
      console.error("[email-io] health check failed", lastHealthStatus);
    }
  })();
  return healthCheckPromise;
}

export function getEmailIoHealthStatus(): EmailIoHealthStatus | null {
  return lastHealthStatus;
}

export function ensureEmailIoHealthLogged(signal?: AbortSignal) {
  if (healthCheckPromise) {
    return healthCheckPromise;
  }
  return startHealthCheck(signal);
}

export async function runEmailIoHealthCheck(options?: {
  force?: boolean;
  signal?: AbortSignal;
}) {
  if (options?.force || !healthCheckPromise) {
    startHealthCheck(options?.signal);
  }
  await healthCheckPromise;
  return lastHealthStatus;
}
