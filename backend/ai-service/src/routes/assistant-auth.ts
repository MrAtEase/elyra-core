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
];

// Memberships are owned by the worker; this service only knows the personal default.
function defaultWorkspaceForEmail(_email: string | null | undefined): string {
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
