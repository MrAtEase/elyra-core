import { getAssistantApiBase } from "@/lib/env";

export type BuilderBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: string;
};

export type BuilderPageMeta = {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
};

export type BuilderPage = BuilderPageMeta & {
  blocks: BuilderBlock[];
  props?: Record<string, unknown>;
};

const assistantBase = getAssistantApiBase();
const buildWorkspaceUrl = (workspaceId: string) =>
  `${assistantBase}/assistant/workspaces/${encodeURIComponent(workspaceId)}/builder/pages`;

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const init: RequestInit = {
    credentials: "include",
    headers: {
      "content-type": options.body ? "application/json" : "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  };
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error ?? payload?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function listPages(workspaceId: string): Promise<BuilderPageMeta[]> {
  const url = buildWorkspaceUrl(workspaceId);
  const payload = await requestJson<{ items: BuilderPageMeta[] }>(url, {
    method: "GET",
  });
  return payload.items ?? [];
}

export async function createPage(
  workspaceId: string,
  options: { title: string; slug?: string; props?: Record<string, unknown> }
): Promise<BuilderPage> {
  const url = buildWorkspaceUrl(workspaceId);
  const payload = await requestJson<{ page: BuilderPage }>(url, {
    method: "POST",
    body: JSON.stringify(options),
  });
  return payload.page;
}

export async function getPage(workspaceId: string, pageId: string): Promise<BuilderPage> {
  const url = `${buildWorkspaceUrl(workspaceId)}/${encodeURIComponent(pageId)}`;
  const payload = await requestJson<{ page: BuilderPage }>(url, {
    method: "GET",
  });
  return payload.page;
}

export async function savePage(workspaceId: string, page: BuilderPage): Promise<BuilderPage> {
  const url = `${buildWorkspaceUrl(workspaceId)}/${encodeURIComponent(page.id)}`;
  const payload = await requestJson<{ page: BuilderPage }>(url, {
    method: "PUT",
    body: JSON.stringify({
      title: page.title,
      slug: page.slug,
      blocks: page.blocks,
      props: page.props,
    }),
  });
  return payload.page;
}

export async function deletePage(workspaceId: string, pageId: string): Promise<void> {
  const url = `${buildWorkspaceUrl(workspaceId)}/${encodeURIComponent(pageId)}`;
  await requestJson<{ ok: true }>(url, {
    method: "DELETE",
  });
}
