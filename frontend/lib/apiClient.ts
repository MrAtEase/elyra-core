import { buildAssistantEndpoint } from "@/utils/auth-guard";

type FetchJsonOptions = RequestInit;

export type AssistantFetchContext = {
  workspaceId?: string | null;
  route?: string;
};

const MAX_ASSISTANT_LOG_BODY = 2048;

const truncateAssistantLogValue = (value: string | null | undefined, maxLength = MAX_ASSISTANT_LOG_BODY) => {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
};

const logAssistantFetchFailure = (
  url: string,
  status: number,
  context?: AssistantFetchContext,
  responseBody?: string | null
) => {
  const route = context?.route ?? new URL(url).pathname;
  console.error(`[assistant] ${route} fetch failed`, {
    status,
    workspaceId: context?.workspaceId ?? null,
    responseBody: truncateAssistantLogValue(responseBody),
  });
};

const DEFAULT_HEADERS: HeadersInit = {
  "content-type": "application/json",
};

function buildRequestInit(options: FetchJsonOptions = {}): RequestInit {
  const { headers, ...rest } = options;
  return {
    ...rest,
    headers: {
      ...DEFAULT_HEADERS,
      ...(headers ?? {}),
    },
  };
}

function assertSuccessfulResponse(response: Response): void {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
}

function resolveAssistantRequestUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return buildAssistantEndpoint(path);
}

export async function fetchAssistant(
  path: string,
  options: RequestInit = {},
  context?: AssistantFetchContext
): Promise<Response> {
  const url = resolveAssistantRequestUrl(path);
  const requestInit: RequestInit = {
    ...options,
    credentials: "include",
  };
  const response = await fetch(url, requestInit);
  if (!response.ok) {
    const clone = response.clone();
    const text = await clone.text().catch(() => null);
    logAssistantFetchFailure(url, response.status, context, text);
  }
  return response;
}

export async function fetchJson<TResponse = unknown>(
  url: string,
  options: FetchJsonOptions = {}
): Promise<TResponse> {
  const requestInit = buildRequestInit(options);
  const response = await fetch(url, requestInit);

  assertSuccessfulResponse(response);

  const data: TResponse = await response.json();

  return data;
}

export async function fetchAssistantJson<TResponse = unknown>(
  path: string,
  options: FetchJsonOptions = {},
  context?: AssistantFetchContext
): Promise<TResponse> {
  const requestInit = buildRequestInit({
    credentials: "include",
    ...options,
  });
  const response = await fetchAssistant(path, requestInit, context);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error ?? payload?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as TResponse;
}
