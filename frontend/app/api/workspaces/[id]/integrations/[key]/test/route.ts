import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";

function mapIntegrationKey(value: string): "google_workspace" | "imap_smtp" | "figma" | "banana2" | "google_stitch" | "twentyfirst" | "unknown" {
  const key = value.toLowerCase();
  if (key === "google_workspace" || key === "google") return "google_workspace";
  if (key === "imap_smtp" || key === "imap" || key === "icloud_imap") return "imap_smtp";
  if (key === "figma") return "figma";
  if (key === "banana2" || key === "banana") return "banana2";
  if (key === "google_stitch" || key === "stitch") return "google_stitch";
  if (key === "twentyfirst" || key === "21st" || key === "21st_dev" || key === "21st.dev") return "twentyfirst";
  return "unknown";
}

function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const integration = mapIntegrationKey(key);
  if (integration === "google_workspace") {
    const upstream = await fetch(
      new URL(`/api/google/status?workspaceId=${encodeURIComponent(auth.workspaceId)}&refresh=1`, request.nextUrl.origin),
      {
        method: "GET",
        headers: { cookie: request.headers.get("cookie") ?? "" },
        cache: "no-store",
      },
    );
    const result = await upstream.json().catch(() => null);
    return NextResponse.json(result ?? { ok: upstream.ok }, { status: upstream.status });
  }

  if (integration === "imap_smtp") {
    const payload = (await request.json().catch(() => null)) as
      | {
          credentials?: {
            username?: string;
            appPassword?: string;
            imapHost?: string;
            imapPort?: number | null;
          };
        }
      | null;
    if (!payload?.credentials?.username || !payload.credentials.appPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_credentials",
          hint: "Provide credentials.username and credentials.appPassword for IMAP test.",
        },
        { status: 400 },
      );
    }
    const upstream = await fetch(new URL("/api/mail/imap/test", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        workspaceId: auth.workspaceId,
        credentials: {
          username: payload.credentials.username,
          appPassword: payload.credentials.appPassword,
          imapHost: payload.credentials.imapHost,
          imapPort: payload.credentials.imapPort,
        },
      }),
      cache: "no-store",
    });
    const result = await upstream.json().catch(() => null);
    return NextResponse.json(result ?? { ok: upstream.ok }, { status: upstream.status });
  }

  if (integration === "figma") {
    const configured = hasEnv("FIGMA_ACCESS_TOKEN", "FIGMA_CONNECT_URL", "NEXT_PUBLIC_FIGMA_CONNECT_URL");
    return NextResponse.json({
      ok: configured,
      integrationKey: "figma",
      configured,
      hint: configured ? "Figma connector appears configured." : "Set FIGMA_ACCESS_TOKEN or FIGMA_CONNECT_URL.",
    }, { status: configured ? 200 : 400 });
  }

  if (integration === "banana2") {
    const configured = hasEnv("BANANA2_API_KEY", "BANANA_API_KEY", "BANANA2_CONNECT_URL", "NEXT_PUBLIC_BANANA2_CONNECT_URL");
    return NextResponse.json({
      ok: configured,
      integrationKey: "banana2",
      configured,
      hint: configured ? "Banana2 connector appears configured." : "Set BANANA2_API_KEY or BANANA2_CONNECT_URL.",
    }, { status: configured ? 200 : 400 });
  }

  if (integration === "google_stitch") {
    const configured = hasEnv("STITCH_API_KEY", "GOOGLE_STITCH_API_KEY", "GOOGLE_STITCH_CONNECT_URL", "NEXT_PUBLIC_GOOGLE_STITCH_CONNECT_URL");
    return NextResponse.json({
      ok: configured,
      integrationKey: "google_stitch",
      configured,
      hint: configured ? "Google Stitch connector appears configured." : "Set STITCH_API_KEY or GOOGLE_STITCH_CONNECT_URL.",
    }, { status: configured ? 200 : 400 });
  }

  if (integration === "twentyfirst") {
    const configured = hasEnv("TWENTYFIRST_API_KEY", "TWENTYFIRST_CONNECT_URL", "NEXT_PUBLIC_TWENTYFIRST_CONNECT_URL");
    return NextResponse.json({
      ok: configured,
      integrationKey: "twentyfirst",
      configured,
      hint: configured ? "21st.dev connector appears configured." : "Set TWENTYFIRST_API_KEY or TWENTYFIRST_CONNECT_URL.",
    }, { status: configured ? 200 : 400 });
  }

  return NextResponse.json(
    { ok: false, error: "unsupported_integration_key", hint: `Unsupported integration key: ${key}` },
    { status: 400 },
  );
}
