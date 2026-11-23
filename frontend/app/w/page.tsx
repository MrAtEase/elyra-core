import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApiOrigin } from "@/lib/env";
import { parseActiveSlug } from "@/lib/workspace/activeWorkspace";

export const dynamic = "force-dynamic";

type BootWhoamiResponse = {
  ok?: boolean;
};

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function WorkspaceBootPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("mf-s")?.value;

  if (!sessionCookie) {
    redirect("/signin");
  }

  const apiOrigin = getApiOrigin();
  const authHeaders = {
    cookie: `mf-s=${sessionCookie}`,
    accept: "application/json",
  };

  // 1) Session prüfen
  const whoamiResponse = await fetch(`${apiOrigin}/assistant/auth/whoami`, {
    method: "GET",
    headers: authHeaders,
    cache: "no-store",
  });
  const whoami = await parseJson<BootWhoamiResponse>(whoamiResponse);

  if (!whoamiResponse.ok || whoami?.ok === false) {
    redirect("/signin");
  }

  // 2) Active Workspace holen/setzen (Worker setzt aktuell Vision-Workspace als aktiv)
  const activeResponse = await fetch(`${apiOrigin}/assistant/workspaces/active`, {
    method: "GET",
    headers: authHeaders,
    cache: "no-store",
  });
  const active = await parseJson<unknown>(activeResponse);
  const activeSlugFromApi = parseActiveSlug(active);

  // 3) Desktop booten or fall back to the OS first-run flow when no workspace exists yet
  if (!activeSlugFromApi) {
    redirect("/os");
  }

  redirect(`/w/${activeSlugFromApi}`);
}
