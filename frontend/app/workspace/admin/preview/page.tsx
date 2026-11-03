import type { Metadata } from "next";

import RolePreviewClient from "./RolePreviewClient";

export const metadata: Metadata = {
  title: "Role Preview | Workspace Admin",
};

export default function WorkspaceAdminRolePreviewPage() {
  return <RolePreviewClient />;
}
