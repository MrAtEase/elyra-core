export default function OsMailConnectLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <div className="rounded-[28px] border px-6 py-6 text-sm text-[color:var(--text-secondary)]" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
        Loading iCloud Mail connector…
      </div>
    </main>
  );
}
