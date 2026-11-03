import SettingsPane from "@/components/merlin/settings/SettingsPane";

export default function WorkspaceBehaviorAdminPage() {
  return (
    <SettingsPane
      eyebrow="Workspace · Behavior"
      title="Behavior"
      description="Placeholder for future automation settings."
      scope="WORKSPACE"
    >
      <div className="settings-placeholder">
        <p>Automation and behavior tuning will appear here once scoped for this workspace.</p>
      </div>
    </SettingsPane>
  );
}
