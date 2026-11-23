import SettingsShell from "@/components/elyra/settings/SettingsShell";

export const metadata = {
  title: "Settings | Fish Delish",
};

export default function WorkspaceSettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
