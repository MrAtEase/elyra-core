import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LEGACY_PREFIX = "/workspace";
const ACTIVE_SLUG = "active";

function mapLegacyPath(pathname: string): string {
  if (pathname === "/workspace" || pathname === "/workspace/") {
    return `/w/${ACTIVE_SLUG}`;
  }
  if (pathname.startsWith("/workspace/work/mail")) {
    return pathname.replace("/workspace/work/mail", `/w/${ACTIVE_SLUG}/mail`);
  }
  if (pathname.startsWith("/workspace/work/calendar")) {
    return pathname.replace("/workspace/work/calendar", `/w/${ACTIVE_SLUG}/calendar`);
  }
  if (pathname.startsWith("/workspace/work/tasks")) {
    return pathname.replace("/workspace/work/tasks", `/w/${ACTIVE_SLUG}/planner`);
  }
  if (pathname.startsWith("/workspace/settings")) {
    return pathname.replace("/workspace/settings", `/w/${ACTIVE_SLUG}/settings`);
  }
  if (pathname.startsWith("/workspace/team")) {
    return pathname.replace("/workspace/team", `/w/${ACTIVE_SLUG}/team`);
  }
  if (pathname.startsWith("/workspace/admin") || pathname.startsWith("/workspace/access")) {
    return pathname.replace(LEGACY_PREFIX, `/w/${ACTIVE_SLUG}`);
  }
  return pathname.replace(LEGACY_PREFIX, `/w/${ACTIVE_SLUG}`);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Forward OAuth ?code= landing on root to /auth/callback
  if (pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    return NextResponse.redirect(callbackUrl, 302);
  }

  if (pathname.startsWith(LEGACY_PREFIX)) {
    const target = mapLegacyPath(pathname);
    return NextResponse.redirect(new URL(`${target}${search}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/workspace/:path*"],
};
