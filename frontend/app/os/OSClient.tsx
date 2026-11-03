"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
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
      <main className="relative z-10 px-6 pb-36 pt-6">
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="min-h-[320px] rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="h-4 w-28 rounded-full bg-white/10" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="h-28 rounded-3xl bg-white/[0.05]" />
              <div className="h-28 rounded-3xl bg-white/[0.05]" />
            </div>
          </div>
          <div className="min-h-[320px] rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="h-4 w-32 rounded-full bg-white/10" />
            <div className="mt-4 space-y-3">
              <div className="h-12 rounded-2xl bg-white/[0.05]" />
              <div className="h-12 rounded-2xl bg-white/[0.05]" />
              <div className="h-12 rounded-2xl bg-white/[0.05]" />
            </div>
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-[96px] z-[112] px-4 sm:px-6">
        <div className="mx-auto flex w-fit items-center gap-2 rounded-[9999px] border border-white/10 bg-white/[0.06] px-3 py-2 backdrop-blur-xl">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-10 w-20 rounded-[9999px] bg-white/[0.06]" />
          ))}
        </div>
      </div>
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 px-4 pb-[max(env(safe-area-inset-bottom),18px)] sm:px-6">
        <div className="mx-auto h-[54px] w-full max-w-[960px] rounded-[28px] border border-white/10 bg-white/[0.06] backdrop-blur-xl" />
      </div>
    </div>
  );
}

export default function OSClient() {
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

  if (loading || authState === "checking") {
    return <ShellLoadingState />;
  }

  if (authState === "unauthenticated" && !e2eBypassAuth) {
    return null;
  }

  if ((data?.workspaces?.length ?? 0) === 0) {
    return <WorkspaceFirstRun refreshWorkspaceData={refresh} />;
  }

  return <WorkspaceOS whoami={data ?? null} />;
}
