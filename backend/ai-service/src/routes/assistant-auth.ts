import type { FastifyInstance } from "fastify";
import type { AuthenticatedRequest } from "../middleware/auth.js";

type WhoamiWorkspace = {
  id: string;
  slug: string;
  type: "individual" | "organization" | "platform";
  name: string;
  brand: {
    productName: string;
    assistantName: string;
    workspaceLabel: string;
  };
};

const DEFAULT_WORKSPACES: WhoamiWorkspace[] = [
  {
    id: "ws-personal",
    slug: "personal",
    type: "individual",
    name: "Personal",
    brand: { productName: "Elyra Core", assistantName: "Elyra", workspaceLabel: "Personal" },
  },
  {
    id: "ws-fish-delish",
    slug: "fish-delish",
    type: "organization",
    name: "Fish-Delish",
    brand: { productName: "Fish-Delish", assistantName: "Elyra", workspaceLabel: "Fish-Delish" },
  },
  {
    id: "ws-elyra-core",
    slug: "elyra-core",
    type: "platform",
    name: "Elyra Core",
    brand: { productName: "Elyra Core", assistantName: "Elyra", workspaceLabel: "Elyra Core" },
  },
];

function defaultWorkspaceForEmail(email: string | null | undefined): string {
  const normalized = (email ?? "").trim().toLowerCase();
  if (normalized === "paul.odak@icloud.com") return "ws-personal";
  if (normalized === "paul.odak@fish-delish.pt") return "ws-fish-delish";
  if (normalized === "paul@elyra-core.app") return "ws-elyra-core";
  return "ws-personal";
}

export async function assistantAuthRoutes(app: FastifyInstance) {
  app.get("/assistant/auth/whoami", async (request) => {
    const authRequest = request as AuthenticatedRequest;
    const userEmail = authRequest.userEmail ?? null;
    const requestedWorkspaceId = authRequest.workspaceId || "";
    const workspaceId =
      DEFAULT_WORKSPACES.some((workspace) => workspace.id === requestedWorkspaceId)
        ? requestedWorkspaceId
        : defaultWorkspaceForEmail(userEmail);
    const activeWorkspace = DEFAULT_WORKSPACES.find((workspace) => workspace.id === workspaceId) ?? DEFAULT_WORKSPACES[0];

    return {
      ok: true,
      user: {
        id: authRequest.userId,
        email: userEmail,
      },
      userId: authRequest.userId,
      userKey: userEmail?.split("@")[0] ?? authRequest.userId,
      workspaceId,
      workspaces: DEFAULT_WORKSPACES,
      activeWorkspace,
      membership: {
        role: "owner",
        title: null,
        workspaceId,
      },
      userSettings: {
        locale: "de-DE",
        language: "de",
        orbVariant: "default",
        theme: null,
        defaultWorkspaceId: defaultWorkspaceForEmail(userEmail),
        alwaysPersonalOnLogin: false,
      },
    };
  });
}
