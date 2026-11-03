import { z } from "zod";

const WorkspaceRefSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string(),
  })
  .passthrough();

const ActiveWorkspaceSchema = z
  .union([
    z.object({ workspace: WorkspaceRefSchema }).passthrough(),
    z.object({ activeWorkspace: WorkspaceRefSchema }).passthrough(),
    WorkspaceRefSchema,
  ]);

export function parseActiveSlug(data: unknown): string | null {
  const parsed = ActiveWorkspaceSchema.safeParse(data);
  if (!parsed.success) return null;

  const value = parsed.data as {
    workspace?: { slug?: string };
    activeWorkspace?: { slug?: string };
    slug?: string;
  };

  return value.workspace?.slug ?? value.activeWorkspace?.slug ?? value.slug ?? null;
}
