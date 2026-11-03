type BuilderBlock = {
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

const PAGES_LIST_KEY = (workspaceId: string) => `builder:${workspaceId}:pages`;
const PAGE_KEY = (workspaceId: string, pageId: string) =>
  `builder:${workspaceId}:page:${pageId}`;

function ensureAssistantKv(env: any) {
  if (!env?.ASSISTANT_KV) {
    throw new Error('ASSISTANT_KV binding not configured');
  }
  return env.ASSISTANT_KV;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string): string {
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64) || 'page';
}

async function readPagesList(env: any, workspaceId: string): Promise<BuilderPageMeta[]> {
  const kv = ensureAssistantKv(env);
  const raw = await kv.get(PAGES_LIST_KEY(workspaceId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => entry && typeof entry === 'object');
    }
  } catch {
    // fall through
  }
  return [];
}

async function writePagesList(
  env: any,
  workspaceId: string,
  pages: BuilderPageMeta[]
): Promise<void> {
  const kv = ensureAssistantKv(env);
  await kv.put(PAGES_LIST_KEY(workspaceId), JSON.stringify(pages));
}

function normalizeTitle(value?: string | null): string {
  const trimmed = (value ?? 'Untitled page').toString().trim();
  return trimmed || 'Untitled page';
}

function normalizeSlug(fallback: string, value?: string | null): string {
  if (value && typeof value === 'string' && value.trim().length > 0) {
    return slugify(value);
  }
  return fallback;
}

async function upsertPageMeta(
  env: any,
  workspaceId: string,
  meta: BuilderPageMeta
): Promise<void> {
  const pages = await readPagesList(env, workspaceId);
  const filtered = pages.filter((entry) => entry.id !== meta.id);
  filtered.push(meta);
  await writePagesList(env, workspaceId, filtered);
}

export async function listPages(env: any, workspaceId: string): Promise<BuilderPageMeta[]> {
  const pages = await readPagesList(env, workspaceId);
  return pages
    .slice()
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0));
}

export async function createPage(
  env: any,
  workspaceId: string,
  options: { title?: string; slug?: string; props?: Record<string, unknown> } = {}
): Promise<BuilderPage> {
  const kv = ensureAssistantKv(env);
  const title = normalizeTitle(options.title);
  const id = generateId();
  const slug = normalizeSlug(slugify(title), options.slug);
  const now = new Date().toISOString();
  const page: BuilderPage = {
    id,
    title,
    slug,
    updatedAt: now,
    props: options.props ?? {},
    blocks: [],
  };
  await kv.put(PAGE_KEY(workspaceId, id), JSON.stringify(page));
  await upsertPageMeta(env, workspaceId, {
    id: page.id,
    title: page.title,
    slug: page.slug,
    updatedAt: page.updatedAt,
  });
  return page;
}

export async function getPage(
  env: any,
  workspaceId: string,
  pageId: string
): Promise<BuilderPage | null> {
  const kv = ensureAssistantKv(env);
  const raw = await kv.get(PAGE_KEY(workspaceId, pageId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: parsed.id || pageId,
      title: parsed.title || 'Untitled page',
      slug: parsed.slug || slugify(parsed.title || 'page'),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      blocks: Array.isArray(parsed.blocks)
        ? parsed.blocks.map((block: any) => ({
            id: block?.id || generateId(),
            type: block?.type || 'content',
            props: block?.props && typeof block.props === 'object' ? block.props : undefined,
            content: typeof block?.content === 'string' ? block.content : undefined,
          }))
        : [],
      props: parsed.props && typeof parsed.props === 'object' ? parsed.props : {},
    };
  } catch {
    return null;
  }
}

export async function putPage(
  env: any,
  workspaceId: string,
  pageId: string,
  payload: Partial<BuilderPage>
): Promise<BuilderPage> {
  const kv = ensureAssistantKv(env);
  const existing = await getPage(env, workspaceId, pageId);
  const title = normalizeTitle(payload.title ?? existing?.title);
  const slug = normalizeSlug(existing?.slug ?? slugify(title), payload.slug);
  const now = new Date().toISOString();
  const page: BuilderPage = {
    id: pageId,
    title,
    slug,
    updatedAt: now,
    blocks: Array.isArray(payload.blocks) ? payload.blocks : existing?.blocks ?? [],
    props: payload.props ?? existing?.props ?? {},
  };
  await kv.put(PAGE_KEY(workspaceId, pageId), JSON.stringify(page));
  await upsertPageMeta(env, workspaceId, {
    id: page.id,
    title: page.title,
    slug: page.slug,
    updatedAt: page.updatedAt,
  });
  return page;
}

export async function deletePage(
  env: any,
  workspaceId: string,
  pageId: string
): Promise<void> {
  const kv = ensureAssistantKv(env);
  await kv.delete(PAGE_KEY(workspaceId, pageId));
  const pages = await readPagesList(env, workspaceId);
  const filtered = pages.filter((entry) => entry.id !== pageId);
  await writePagesList(env, workspaceId, filtered);
}
