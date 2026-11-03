export default function OsCalendarConnectLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <div className="w-full max-w-[640px] rounded-[28px] border px-6 py-6 backdrop-blur-xl" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
        <div className="h-3 w-32 rounded-full bg-white/10" />
        <div className="mt-3 h-8 w-56 rounded-full bg-white/10" />
        <div className="mt-2 h-4 w-80 max-w-full rounded-full bg-white/5" />
        <div className="mt-8 grid gap-4">
          <div className="h-11 rounded-2xl bg-white/5" />
          <div className="h-11 rounded-2xl bg-white/5" />
          <div className="h-11 rounded-2xl bg-white/5" />
        </div>
      </div>
    </main>
  );
}
