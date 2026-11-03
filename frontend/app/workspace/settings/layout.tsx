import SettingsShell from "@/components/merlin/settings/SettingsShell";

export const metadata = {
  title: "Settings | Fish Delish",
};

export default function WorkspaceSettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
