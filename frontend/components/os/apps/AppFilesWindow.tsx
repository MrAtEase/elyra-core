"use client";

export default function AppFilesWindow() {
  return (
    <section className="ec-panel ec-panel-scroll" style={{ padding: 14 }}>
      <p className="ec-overline">Files</p>
      <article className="ec-card">
        <strong>Artifacts</strong>
        <p>Run artifacts are listed in Runs detail as tool outputs and hashes.</p>
      </article>
      <article className="ec-card">
        <strong>Storage</strong>
        <p>Workspace: Elyra Core</p>
      </article>
    </section>
  );
}
