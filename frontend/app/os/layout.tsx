"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import WorkspaceOS from "@/components/os/shell/WorkspaceOS";
import WorkspaceFirstRun from "@/components/workspace/WorkspaceFirstRun";
import { useWhoamiLoader } from "@/lib/auth/useWhoamiLoader";

function ShellLoadingState() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-canvas,#0a0e14)] text-[color:var(--text-primary,#fff)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(88,210,255,0.14),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(162,141,255,0.14),transparent_32%),linear-gradient(180deg,#060912_0%,#0b1220_100%)]" />
      <header className="relative z-10 flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="space-y-2">
          <div className="h-2.5 w-24 rounded-full bg-white/10" />
          <div className="h-3 w-40 rounded-full bg-white/15" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-16 rounded-full bg-white/10" />
          <div className="h-8 w-24 rounded-full bg-white/10" />
          <div className="h-8 w-36 rounded-full bg-white/15" />
        </div>
      </header>
    </div>
  );
}

function OsLayoutShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, authState, loginUrl, data, refresh } = useWhoamiLoader();

  const localPreviewBypassAuth =
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port === "3100";

  const e2eBypassAuth =
    process.env.NODE_ENV !== "production" &&
    (searchParams.get("os_e2e") === "1" || localPreviewBypassAuth);

  useEffect(() => {
    if (loading) return;
    if (authState === "unauthenticated" && !e2eBypassAuth) {
      const target = loginUrl || "/signin";
      if (target.startsWith("http://") || target.startsWith("https://")) {
        window.location.assign(target);
        return;
      }
      router.replace(target);
    }
  }, [authState, e2eBypassAuth, loading, loginUrl, router]);

  if (loading || authState === "checking") return <ShellLoadingState />;
  if (authState === "unauthenticated" && !e2eBypassAuth) return null;
  // if ((data?.workspaces?.length ?? 0) === 0) {
  //   return <WorkspaceFirstRun refreshWorkspaceData={refresh} />;
  // }

  return <WorkspaceOS whoami={data ?? null}>{children}</WorkspaceOS>;
}

export default function OsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.includes("/connect")) {
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<ShellLoadingState />}>
      <OsLayoutShell>{children}</OsLayoutShell>
    </Suspense>
  );
}
