import WorkspaceAdminNav from "@/components/workspace/admin/WorkspaceAdminNav";

export const metadata = {
  title: "Workspace Admin | Fish Delish",
};

export default function WorkspaceAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="settings-shell workspace-admin-shell">
      <div className="settings-shell__content">
        <WorkspaceAdminNav />
        <div className="settings-shell__panel">{children}</div>
      </div>
    </section>
  );
}
