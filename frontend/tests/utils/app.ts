type WorkspaceUrlOptions = {
  e2e?: boolean;
};

const DEFAULT_APP_BASE_URL = "http://localhost:3000";

function resolveAppBaseUrl() {
  const configured = process.env.FDL_APP_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_APP_BASE_URL;
}

export function getWorkspaceUrl(options?: WorkspaceUrlOptions) {
  const workspaceUrl = new URL("/w/", resolveAppBaseUrl());
  if (options?.e2e) {
    workspaceUrl.searchParams.set("e2e", "1");
  }
  return workspaceUrl.toString();
}
