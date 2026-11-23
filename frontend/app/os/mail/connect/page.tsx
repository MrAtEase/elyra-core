"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import IcloudMailConnect from "@/components/workspace/mail/IcloudMailConnect";

function ShellCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className="w-full max-w-[760px] rounded-[28px] border px-6 py-6 shadow-[0_24px_64px_rgba(5,9,18,0.42)] backdrop-blur-xl"
      style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}
    >
      {children}
    </div>
  );
}

export default function OsMailConnectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <ShellCard>
        {!workspaceId ? (
          <div className="rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(127,29,29,0.18)", color: "rgb(254,226,226)" }}>
            Missing `workspaceId` in the URL. Open this flow from the Connectors panel so the workspace context is preserved.
          </div>
        ) : (
          <IcloudMailConnect
            workspaceId={workspaceId}
            connected={false}
            identityEmail={null}
            onSuccess={async () => {
              router.replace(`/os/mail?mail_connect=icloud_success`);
            }}
            onClose={() => {
              router.push("/os/mail");
            }}
          />
        )}

        <div className="mt-4">
          <Link
            href={workspaceId ? `/os/mail?workspaceId=${encodeURIComponent(workspaceId)}` : "/os/mail"}
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
          >
            Back to Mail
          </Link>
        </div>
      </ShellCard>
    </main>
  );
}
