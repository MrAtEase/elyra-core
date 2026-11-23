const DEFAULT_API_BASE_URL = "http://localhost:3000";
const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, "");
const playgroundApiUrl =
  process.env.PLAYGROUND_API_URL ??
  (process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : DEFAULT_API_BASE_URL);
const HEALTH_ENDPOINT =
  process.env.PLAYGROUND_HEALTH_ENDPOINT?.trim() ?? `${normalizeUrl(playgroundApiUrl)}/health`;

type HealthResponse = {
  status?: string;
  version?: string;
  uptimeSeconds?: number;
  timestamp?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const nextText = await response.text();
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${nextText.slice(0, 500)}`,
    );
  }

  if (!nextText) {
    return null as T;
  }

  try {
    return JSON.parse(nextText) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${String(error)}`);
  }
}

export const testBackendHealth = async (): Promise<void> => {
  try {
    const response = await fetchJson<HealthResponse>(HEALTH_ENDPOINT);
    logHealthStatus(response);
  } catch (error) {
    logHealthError(toError(error));
  }
};

const logHealthStatus = (response: HealthResponse): void => {
  const { status, version, uptimeSeconds, timestamp } = response;
  const metadataParts: string[] = [];
  if (version) {
    metadataParts.push(`version=${version}`);
  }
  if (uptimeSeconds !== undefined) {
    metadataParts.push(`uptime=${uptimeSeconds}s`);
  }
  if (timestamp) {
    metadataParts.push(`timestamp=${timestamp}`);
  }

  console.info(
    "[playground] health check succeeded",
    status ? `status=${status}` : "status=unknown",
    metadataParts.join(" "),
  );
  console.debug("[playground] response payload:", response);
};

const logHealthError = (error: Error): void => {
  console.error("[playground] health check failed:", error.message);
  console.debug(error);
};

const toError = (input: unknown): Error => {
  if (input instanceof Error) {
    return input;
  }

  if (typeof input === "string") {
    return new Error(input);
  }

  try {
    return new Error(JSON.stringify(input));
  } catch {
    return new Error(String(input));
  }
};
